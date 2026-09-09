import "server-only";

import { CLAUDE_MAX_TOKENS, RETRIEVAL } from "@/lib/config/models";
import { MissingConfigurationError, liveReadiness } from "@/lib/config/server-env";
import { ACTIVE_BRAND } from "@/lib/brand";
import { proposeFormForTurn, type ChatActor } from "./form-proposal";
import { SupabaseKnowledgeProvider } from "@/lib/knowledge/providers/supabase";
import { EMPLOYEE_PERFORMANCE_FRAMEWORK } from "@/lib/knowledge/document-roles";
import {
  FRAMEWORK_UNAVAILABLE_MESSAGE,
  type RoleGroundingResult,
} from "@/lib/knowledge/role-grounding";
import { rowToCitation, type MatchedChunkRow } from "@/lib/knowledge/mappers";
import { loadEmployeeFacts } from "@/lib/reporting/read/employee-facts";
import { assembleGrounding } from "./grounding-assembly";
import { classifyEmployeePerformanceIntent } from "./employee-performance-gate";
import { loadBedSpaBriefing } from "@/lib/reporting/read/bed-spa/briefing-source";
import { isReportingQuestion } from "@/lib/reporting/read/bed-spa/question-gate";
import type { SourceCitation } from "@/types";
import { callClaude } from "./call-claude";
import { AiError } from "./errors";
import {
  buildGroundingBlock,
  buildSystemPrompt,
  extractUsedMarkers,
  stripMarkers,
  type GroundingChunk,
} from "./prompts";
import type { AskRequest, AskResponse } from "./types";

/**
 * THE GROUNDED ANSWER PATH — server-side, and only server-side.
 *
 *   question
 *     -> embed the question            (SupabaseEmbeddingProvider)
 *     -> retrieve top-k chunks         (match_knowledge_chunks / pgvector)
 *     -> pin mandatory role sections   (fetchRoleGrounding, when relevant)
 *     -> REFUSE if a required role is unhealthy      <- no model call at all
 *     -> merge into one ordered set    (assembleGrounding)
 *     -> build grounding context       (buildGroundingBlock)
 *     -> attach report figures         (loadBedSpaBriefing, when relevant)
 *     -> attach employee figures       (loadEmployeeFacts, when relevant)
 *     -> Claude                        (Anthropic SDK, server-side)
 *     -> AskResponse + SourceCitation[]
 *
 * TWO KINDS OF GROUNDING ON ONE PIPELINE. Retrieved documents answer "what is
 * the policy"; the ingested Bed Usage and Spa reports answer "what happened
 * last month". They are different sources with different rules — a document is
 * cited by marker, a figure is cited by reporting period — so they arrive as
 * two blocks and the system prompt states the rules for each. There is
 * deliberately no second model call, no second retrieval step and no separate
 * "analytics assistant": one question, one answer, one place where the rules
 * about what Sunny may assert are written down.
 *
 * THE REPORT BLOCK IS ATTACHED ONLY WHEN THE QUESTION ASKS FOR IT, by a
 * keyword gate rather than a classifier — see `question-gate.ts` for why, and
 * for which way it is biased.
 *
 * SOME DOCUMENTS ARE REASONING RATHER THAN EVIDENCE, and those are not left to
 * similarity. An employee-performance question pins the Employee Performance
 * Framework's operating rules and escalation limits into the SAME company
 * knowledge block, with real markers and real citations — so Sunny can cite it
 * and a manager can open it, while inclusion no longer depends on whether one
 * of its eighty chunks happened to rank. See `knowledge/document-roles.ts` for
 * how the document is identified and `grounding-assembly.ts` for the budgets.
 *
 * A MANDATORY SOURCE THAT CANNOT BE GUARANTEED STOPS THE TURN. If the framework
 * is missing, ambiguous, unreadable or has lost one of its required rule groups,
 * this returns the refusal in `FRAMEWORK_UNAVAILABLE_MESSAGE` and never calls
 * the model — because an employee-performance answer without the escalation
 * limits is exactly the answer nobody wants, and it would be indistinguishable
 * from a good one.
 *
 * Two properties this function is written to guarantee:
 *
 *   1. Citations are built from RETRIEVED ROWS, never from model output. The
 *      model chooses which of the numbered sources it used; the server decides
 *      what those numbers mean. A fabricated title or page number has no path
 *      into a SourceCitation.
 *
 *   2. Nothing here falls back to MockAIProvider. If configuration is missing
 *      or a service fails, this throws AiError and the route says so.
 *
 * @param actor The AUTHORIZED caller — role and scope, from the route's
 *   `authorizeRequest` context. A separate parameter from `request`, which is
 *   parsed from the request body: a caller must never be able to assert its own
 *   role or its own salon assignment.
 */
export async function answerQuestion(
  request: AskRequest,
  actor: ChatActor,
): Promise<AskResponse> {
  const readiness = liveReadiness();

  // Missing variables first: that is the ordinary "not set up yet" case, and it
  // is checked on `missing` rather than on `ready`, because `ready` is also
  // false when a value is present but wrong — which needs the other message.
  if (readiness.missing.length > 0) {
    throw new AiError(
      "not_configured",
      `Ask Sunny is running in live mode but is not fully configured. Missing: ${readiness.missing.join(", ")}.`,
      503,
      readiness.missing,
    );
  }

  // Then misconfigurations, which would otherwise let the app start and
  // misbehave: a privileged key in a NEXT_PUBLIC_ variable, a publishable key
  // where the secret key belongs, or an embedding width the column cannot hold.
  if (readiness.problems.length > 0) {
    throw new AiError("not_configured", readiness.problems.join(" "), 503);
  }

  /* ------------------------------------------------------- form request -- */
  /*
   * WHICH FORM, WHO IT IS ABOUT AND WHICH SALON ARE NEVER CLAUDE'S TO DECIDE.
   *
   * This branch used to draft an employment document: it read half-filled
   * values back out of the previous assistant turn, defaulted the employee to
   * "Jane Kowalski" and the reason to repeated tardiness when the manager had
   * supplied neither, and handed the result to Create a Form pre-filled. Every
   * one of those defaults was a fact on somebody's record that nobody had
   * stated.
   *
   * It now PROPOSES: a validated template, whatever the manager actually said,
   * and a plain list of what is still missing. Nothing is written, and no value
   * is invented to fill a gap. See `lib/ai/form-proposal.ts`.
   */
  const proposal = await proposeFormForTurn({
    history: request.history,
    question: request.question,
    questionMessageId: request.questionMessageId,
    actor,
    continueTemplateKey: request.continueProposalTemplateKey,
  });
  if (proposal) return proposal;

  /* ------------------------------------------------------------ retrieve -- */
  const knowledge = new SupabaseKnowledgeProvider();

  /*
   * THE TWO RETRIEVALS RUN TOGETHER. Neither depends on the other and the
   * briefing is four queries of its own, so serialising them would add its
   * whole latency to every reporting question for no benefit.
   *
   * THE COMPANY IS NOT A PARAMETER HERE. `loadBedSpaBriefing` defaults to the
   * authorized company and takes nothing from `request`, so no question,
   * history entry or scope id can widen which company's figures are read.
   * That is the same posture the dashboards have, one layer up.
   */
  const briefingPromise = isReportingQuestion(request.question)
    ? loadBedSpaBriefing()
    : Promise.resolve(null);

  /*
   * MANDATORY GROUNDING, DECIDED BEFORE RETRIEVAL RUNS.
   *
   * An employee-performance question must be answered with the Employee
   * Performance Framework present, whether or not similarity would have chosen
   * it — measured against the live corpus, a coaching question phrased in the
   * Salon Coaching Guide's vocabulary retrieves ZERO framework chunks in its
   * top 14. See `knowledge/document-roles.ts`.
   *
   * Runs alongside retrieval and the briefing: three independent reads, so
   * serialising them would add each one's latency to the others for no reason.
   *
   * IT FAILS CLOSED, AND THAT IS THE POINT. This used to end in
   * `.catch(() => null)`, which made "the framework could not be read"
   * indistinguishable from "no framework was wanted" — so a coaching question
   * whose framework was missing, ambiguous or unreadable carried on to Claude
   * as an ORDINARY question, with the escalation guard absent and nothing
   * saying so. `fetchRoleGrounding` now returns a reason for every outcome and
   * there is no catch here to swallow it.
   */
  const intent = classifyEmployeePerformanceIntent({
    question: request.question,
    history: request.history,
  });
  const rolePromise: Promise<RoleGroundingResult | null> = intent.active
    ? knowledge.fetchRoleGrounding(EMPLOYEE_PERFORMANCE_FRAMEWORK, request.scopeId)
    : Promise.resolve(null);

  /*
   * The employee-level facts the framework is meant to reason OVER. Today no
   * such dataset exists — the reporting layer is salon-level — so this reports
   * "no ingested dataset", which is NOT the same as "no facts": the manager may
   * have stated figures in the question itself. See `employee-facts.ts`.
   */
  const employeeFactsPromise = intent.active
    ? loadEmployeeFacts()
    : Promise.resolve(null);

  let rows: MatchedChunkRow[];
  try {
    rows = await knowledge.match({
      query: request.question,
      scopeId: request.scopeId,
      /*
       * A DEEPER FETCH WHEN A ROLE IS IN PLAY. The framework out-competes every
       * manual in the corpus on its own topics, and `assembleGrounding` drops
       * it from the retrieved half once it is pinned; at the ordinary `topK`
       * that would leave no evidence at all for policy to outrank it with.
       */
      limit: intent.active ? RETRIEVAL.roleAugmentedTopK : RETRIEVAL.topK,
    });
  } catch (error) {
    if (error instanceof MissingConfigurationError) {
      throw new AiError("not_configured", error.message, 503, error.missing);
    }
    throw new AiError(
      "retrieval_failed",
      "The company knowledge base could not be searched, so no answer was produced. Nothing was answered from memory.",
      502,
    );
  }

  const roleResult = await rolePromise;
  const employeeFacts = await employeeFactsPromise;

  /*
   * THE REFUSAL. An employee-performance turn whose mandatory framework is not
   * healthy does not reach the model at all.
   *
   * Returned as an answer rather than thrown as an error, deliberately: this is
   * not a fault the manager caused or can retry past, and a red error toast
   * would say less than a sentence explaining what is missing and what Sunny is
   * declining to do. `coverage: "insufficient"` keeps the UI honest about the
   * knowledge base not having covered the question.
   *
   * The failure's `detail` — which names documents and rule groups — is for the
   * operator, and stays out of the response.
   */
  if (roleResult && !roleResult.ok) {
    return {
      content: FRAMEWORK_UNAVAILABLE_MESSAGE,
      citations: [],
      coverage: "insufficient",
      recommendedVideoIds: [],
    };
  }

  const role = roleResult?.ok ? roleResult.grounding : null;

  /*
   * One ordered set of rows: the mandatory sections first, then the evidence.
   * Markers and citations both derive from it, so a pinned chunk is cited
   * exactly like a retrieved one — same document id, same title, same locator,
   * and a source card that opens the real Knowledge Base document.
   */
  const assembled = assembleGrounding({
    mandatory: role?.rows ?? [],
    retrieved: rows,
    roleDocumentId: role?.documentId ?? null,
    evidenceBudget: RETRIEVAL.contextChunks,
  });

  const used = assembled.rows;

  const grounding: GroundingChunk[] = used.map((row, index) => ({
    marker: index + 1,
    documentTitle: row.document_title,
    locator: row.locator,
    content: row.content,
  }));

  /* --------------------------------------------------------------- model -- */
  // Null whenever the gate declined, nothing has been ingested, or the read
  // failed. `loadBedSpaBriefing` never rejects, so this cannot fail the answer.
  const briefing = await briefingPromise;

  const system = buildSystemPrompt({
    assistantName: ACTIVE_BRAND.assistantName,
    brandName: ACTIVE_BRAND.brandName,
    salonNoun: ACTIVE_BRAND.vocabulary.salonNoun,
    context: request.context,
    mode: request.mode,
    hasContext: grounding.length > 0,
    hasReportData: briefing !== null,
    hasFrameworkGrounding: assembled.roleIncluded,
    hasEmployeeFactsBlock: Boolean(employeeFacts?.block),
  });

  const answer = await callClaude({
    system,
    grounding: buildGroundingBlock(grounding),
    reportData: briefing,
    /*
     * THE EMPLOYEE FACTS BLOCK, WIRED THROUGH RATHER THAN COUNTED.
     *
     * `employeeFacts.available` used to be read as a boolean and the block
     * itself was never passed anywhere — so the day a real dataset landed, its
     * figures would have flipped a prompt flag and then been dropped on the
     * floor. The block travels to the model as its own section now.
     */
    employeeData: employeeFacts?.block ?? null,
    history: request.history,
    question: request.question,
    maxTokens: CLAUDE_MAX_TOKENS[request.mode],
  });

  /* ----------------------------------------------------------- citations -- */
  // Only the markers the model actually used become source cards, and each one
  // resolves to the row at that position — retrieved data, not model output.
  const markers = extractUsedMarkers(answer, grounding.map((chunk) => chunk.marker));
  const citations: SourceCitation[] = markers
    .map((marker) => used[marker - 1])
    .filter((row): row is MatchedChunkRow => Boolean(row))
    .map(rowToCitation);

  return {
    content: stripMarkers(answer),
    citations,
    /*
     * Coverage is decided by what retrieval returned, not by reading the
     * answer: the server knows whether any chunk cleared the relevance
     * threshold, and that is the only trustworthy source for this signal.
     *
     * A REPORT BRIEFING COUNTS AS COVERAGE. "Which salons have the lowest spa
     * conversion?" is fully answered from the reports and matches no policy
     * document, and reporting that as `insufficient` would put a "the
     * knowledge base does not cover this" banner over a correct, grounded
     * answer. It carries no citations because report figures have no document
     * to cite — which is why coverage is a field of its own rather than
     * inferred from the citation list.
     */
    coverage: grounding.length === 0 && briefing === null ? "insufficient" : "grounded",
    // Video matching is a separate concern and still runs on the client's
    // seeded catalogue; it is not part of the grounded answer path.
    recommendedVideoIds: [],
  };
}
