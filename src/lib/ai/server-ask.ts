import "server-only";

import { CLAUDE_MAX_TOKENS, RETRIEVAL } from "@/lib/config/models";
import { MissingConfigurationError, liveReadiness } from "@/lib/config/server-env";
import { ACTIVE_BRAND } from "@/lib/brand";
import { proposeFormForTurn, type ChatActor } from "./form-proposal";
import {
  SupabaseKnowledgeProvider,
  type RoleGrounding,
} from "@/lib/knowledge/providers/supabase";
import {
  DAILY_STATS_INTERPRETATION_FRAMEWORK,
  EMPLOYEE_PERFORMANCE_FRAMEWORK,
} from "@/lib/knowledge/document-roles";
import { rowToCitation, type MatchedChunkRow } from "@/lib/knowledge/mappers";
import { loadEmployeeFacts } from "@/lib/reporting/read/employee-facts";
import { assembleGrounding } from "./grounding-assembly";
import { isEmployeePerformanceQuestion } from "./employee-performance-gate";
import { isDailyStatsQuestion } from "./daily-stats-gate";
import { loadReportBriefing } from "@/lib/reporting/read/report-briefing";
import { routeReportFamilies } from "@/lib/reporting/read/family-routing";
import type { ReportFamilyId } from "@/lib/reporting/read/report-families";
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
 *     -> merge into one ordered set    (assembleGrounding)
 *     -> build grounding context       (buildGroundingBlock)
 *     -> route to report families      (routeReportFamilies)
 *     -> attach report figures         (loadReportBriefing, when relevant)
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
 * THE REPORT BLOCK IS ATTACHED ONLY WHEN THE QUESTION ASKS FOR IT, and it
 * carries only the FAMILIES the question needs — Sales Totals for a daily
 * question, the traffic report as well when somebody asks why Spa is weak. That
 * routing is a keyword gate rather than a classifier; `read/family-routing.ts`
 * says why, and which way it is biased.
 *
 * A FAMILY THAT WAS ASKED FOR AND HAS NO DELIVERY IS NAMED IN THE BLOCK. That
 * is not a nicety: an answer assembled from the two reports that did load,
 * silent about the one that did not, is the most confident wrong answer this
 * pipeline can produce.
 *
 * SOME DOCUMENTS ARE REASONING RATHER THAN EVIDENCE, and those are not left to
 * similarity. Two of them, and either or both can apply to one question:
 *
 *   EMPLOYEE PERFORMANCE FRAMEWORK   pinned for a question about an individual's
 *                                    performance. Carries the escalation limits.
 *
 *   DAILY STATS INTERPRETATION       pinned for a daily operational or
 *   FRAMEWORK                        manager-performance question. Carries the
 *                                    prioritisation contract and the answer
 *                                    shape.
 *
 * Both arrive in the SAME company knowledge block with real markers and real
 * citations — so Sunny can cite them and a manager can open them, while
 * inclusion no longer depends on whether one of a document's many chunks
 * happened to rank. "What should I coach today?" is both classes of question at
 * once and pins both. See `knowledge/document-roles.ts` for how a document is
 * identified and `grounding-assembly.ts` for the budgets.
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
  /*
   * WHICH REPORTS THIS QUESTION NEEDS.
   *
   * The question's own words route to families. A report context — set when the
   * manager pressed "Ask Sunny about this report", and carried forward on every
   * follow-up in that conversation — ALWAYS adds its own family, because that is
   * what makes "why is #1 the biggest problem?" work: the follow-up names no
   * report and the routing reads the question only.
   */
  const routedFamilies = routeReportFamilies(request.question);
  const contextFamily = request.reportContext?.family ?? null;
  const families: ReportFamilyId[] = contextFamily
    ? [...new Set<ReportFamilyId>([contextFamily, ...routedFamilies])]
    : routedFamilies;

  const briefingPromise =
    families.length > 0
      ? loadReportBriefing({ families, context: request.reportContext ?? null })
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
   * NEVER FAILS THE ANSWER. A corpus with no framework in it is a normal state
   * — a fresh environment, or a second brand — and so is a transient read
   * error. Either way the question still deserves an answer from whatever
   * grounding did arrive, so this resolves to null rather than rejecting.
   */
  const wantsFramework = isEmployeePerformanceQuestion(request.question);
  const wantsDailyStats = isDailyStatsQuestion(request.question);
  const wantsAnyRole = wantsFramework || wantsDailyStats;

  const rolePromise: Promise<RoleGrounding | null> = wantsFramework
    ? knowledge
        .fetchRoleGrounding(EMPLOYEE_PERFORMANCE_FRAMEWORK, request.scopeId)
        .catch(() => null)
    : Promise.resolve(null);

  /*
   * The Daily Stats Interpretation Framework, on the same terms and for the
   * same reasons. A separate read rather than one call for both roles, so a
   * corpus missing one of them still gets the other: `fetchRoleGrounding`
   * resolves one document, and merging the two reads into one would mean a
   * failure on either losing both.
   */
  const dailyStatsPromise: Promise<RoleGrounding | null> = wantsDailyStats
    ? knowledge
        .fetchRoleGrounding(DAILY_STATS_INTERPRETATION_FRAMEWORK, request.scopeId)
        .catch(() => null)
    : Promise.resolve(null);

  /*
   * The employee-level facts the framework is meant to reason OVER. Today there
   * is no such dataset — the reporting layer is salon-level — so this reports
   * "none available" and the prompt says so out loud rather than letting a
   * model full of `[Employee]` placeholders fill in a roster.
   */
  const employeeFactsPromise = wantsFramework
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
      limit: wantsAnyRole ? RETRIEVAL.roleAugmentedTopK : RETRIEVAL.topK,
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

  const role = await rolePromise;
  const dailyStats = await dailyStatsPromise;
  const employeeFacts = await employeeFactsPromise;

  /*
   * One ordered set of rows: the mandatory sections first, then the evidence.
   * Markers and citations both derive from it, so a pinned chunk is cited
   * exactly like a retrieved one — same document id, same title, same locator,
   * and a source card that opens the real Knowledge Base document.
   */
  const assembled = assembleGrounding({
    /*
     * DAILY STATS FIRST WHEN BOTH APPLY. It is the outer reasoning model — how
     * to read the day and choose the top three — and the Employee Performance
     * Framework's escalation limits apply once a person is named inside that.
     * Reading the frame before the constraint is the order a manager would be
     * briefed in.
     */
    mandatory: [...(dailyStats?.rows ?? []), ...(role?.rows ?? [])],
    retrieved: rows,
    roleDocumentIds: [dailyStats?.documentId, role?.documentId].filter(
      (id): id is string => typeof id === "string",
    ),
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
  // Null whenever routing wanted no report at all. NOT null merely because
  // nothing was ingested: a block naming the absent families is exactly what
  // should reach the prompt then. `loadReportBriefing` never rejects, so this
  // cannot fail the answer.
  const briefing = await briefingPromise;

  /*
   * WHICH ROLE ACTUALLY CONTRIBUTED, decided from the assembled rows rather
   * than from the gate.
   *
   * The gate says the question wants a framework; only this says one arrived. A
   * corpus with no Daily Stats document, or one whose headings stopped
   * resolving, must not produce a prompt that describes rules for a source that
   * is not in it — a model told "one of the numbered sources is the framework"
   * when none is will pick one and follow it.
   */
  const pinned = new Set(assembled.pinnedDocumentIds);
  const dailyStatsIncluded = Boolean(dailyStats && pinned.has(dailyStats.documentId));
  const employeeFrameworkIncluded = Boolean(role && pinned.has(role.documentId));

  const system = buildSystemPrompt({
    assistantName: ACTIVE_BRAND.assistantName,
    brandName: ACTIVE_BRAND.brandName,
    salonNoun: ACTIVE_BRAND.vocabulary.salonNoun,
    context: request.context,
    mode: request.mode,
    hasContext: grounding.length > 0,
    hasReportData: (briefing?.present.length ?? 0) > 0,
    hasFrameworkGrounding: employeeFrameworkIncluded,
    hasEmployeeFacts: employeeFacts?.available ?? false,
    hasDailyStatsFramework: dailyStatsIncluded,
    hasMissingReports: (briefing?.missing.length ?? 0) > 0,
  });

  const answer = await callClaude({
    system,
    grounding: buildGroundingBlock(grounding),
    reportData: briefing?.text ?? null,
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
    coverage:
      grounding.length === 0 && (briefing?.present.length ?? 0) === 0
        ? "insufficient"
        : "grounded",
    // Video matching is a separate concern and still runs on the client's
    // seeded catalogue; it is not part of the grounded answer path.
    recommendedVideoIds: [],
  };
}
