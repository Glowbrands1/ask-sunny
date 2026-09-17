import { NextResponse } from "next/server";

import { answerQuestion } from "@/lib/ai/server-ask";
import {
  assertLiveMode,
  assertNoConfigurationProblems,
  assertWithinRateLimit,
  errorResponse,
} from "@/lib/api/respond";
import {
  LIMITS,
  optionalEnum,
  optionalString,
  parseHistory,
  parseJsonBody,
  requireString,
} from "@/lib/api/validation";
import { authorizeRequest } from "@/lib/auth/server";
import { closeTurn, openTurn } from "@/lib/analytics/record";
import { logTurnEvent } from "@/lib/analytics/telemetry";
import {
  classifyChatTurn,
  classifyTurnKind,
  isActivitySurface,
} from "@/lib/analytics/taxonomy";
import { activeKnowledgeCorpus } from "@/lib/knowledge/corpus";
import { CONTINUATION_KEY_MAX } from "@/lib/forms/proposal-continuation";
import { parseChatReportContext } from "@/lib/reporting/read/chat-report-context";
import { businessToday } from "@/lib/business-date";
import type { AskRequest } from "@/lib/ai/types";
import type { AnswerMode, ChatMessage } from "@/types";

/**
 * POST /api/chat
 *
 * The only place Claude is ever called. The browser sends a question; this
 * handler retrieves company knowledge, builds the grounding context, calls
 * Claude and maps the result back to an AskResponse with real citations.
 *
 * ANTHROPIC_API_KEY and the Supabase keys are read here, on the server, and never
 * cross the boundary in either direction.
 *
 * Guard order: mode, then configuration, then authorization, then rate limit,
 * then validation. Authorization comes before the rate limit so an unauthorized
 * caller cannot consume another caller's budget, and both come before any work
 * that spends money at an external vendor.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MODES: AnswerMode[] = ["quick", "standard", "detailed"];

export async function POST(request: Request) {
  try {
    assertLiveMode();
    assertNoConfigurationProblems();
    const context = await authorizeRequest(request, "ask_questions");
    assertWithinRateLimit(request, "chat");

    const body = await parseJsonBody<AskRequest>(request);

    const askedAt = Date.now();

    /*
     * =====================================================================
     * THE TURN IS OPENED BEFORE THE MODEL IS CALLED
     * =====================================================================
     *
     * IT USED TO BE RECORDED AFTERWARDS, bounded at 1500ms so a slow write
     * could never delay an answer. That produced the defect this ordering
     * exists to remove: on a cold serverless instance the first Supabase call
     * pays client construction, DNS and TLS before its insert, lost the race,
     * and the route answered with no turn on it — so the feedback control had
     * nothing to attach to and the gate released. A fully working, entirely
     * untracked conversation, on the first question of a session only.
     *
     * Opening first inverts every part of that:
     *
     *   the write's latency lands in the "thinking" phase, ahead of a
     *   multi-second model call, where one cold round trip is invisible
     *
     *   a write that cannot happen refuses the request BEFORE any money is
     *   spent at Anthropic, so nothing is lost — no answer was made
     *
     *   once an answer exists its turn already exists, which turns "a
     *   successful answer with no rateable turn" from a state the code tries
     *   to avoid into one it cannot reach
     *
     * THE CATEGORY HERE IS PROVISIONAL, and honestly so: three of the four
     * rungs of the evidence ladder are facts about the ANSWER, which does not
     * exist yet. What the request already knows — that a report was attached,
     * and the question itself, read transiently — is passed now, and
     * `closeTurn` replaces it once the answer can speak for itself. A turn
     * whose close is lost therefore still carries a reasonable topic rather
     * than `unclassified`.
     *
     * NO TEXT IS PERSISTED, on exactly the terms it was before. The question
     * goes to two classifiers as an argument, is matched against fixed tables
     * in memory, and is discarded when this handler returns. What is written
     * is enum values.
     */
    const surface = isActivitySurface(body.surface) ? body.surface : null;

    const turnId = await openTurn({
      feature: "chat",
      category: classifyChatTurn({
        /* Unknowable before the answer — see above. */
        proposedTemplateKey: null,
        offeredFormChoices: false,
        hadReportContext: body.reportContext !== undefined && body.reportContext !== null,
        citedCategories: [],
        question: body.question ?? null,
      }),
      turnKind: classifyTurnKind(body.question ?? null),
      surface,
      actorId: context.identity.subject,
      actorRole: context.identity.role,
      scope: context.identity.scope,
    });

    /*
     * THE ACTOR TRAVELS SEPARATELY FROM THE BODY, AND THAT SEPARATION IS THE
     * POINT.
     *
     * A form proposal has to know two things a caller must never be able to
     * assert about itself: which role is asking, and which salons they are
     * assigned to. Both come from `authorizeRequest` — a validated session and
     * `app_users` — and neither is read from `body`, which is why they are a
     * second argument rather than two more fields on `AskRequest`.
     */
    let answer;
    try {
      answer = await answerQuestion(parseAskRequest(body), {
        role: context.identity.role,
        scope: context.identity.scope,
      });
    } catch (error) {
      /*
       * A FAILED ANSWER IS STILL A RECORDED TURN, closed as a failure. The row
       * is already open, and leaving it reading "succeeded" would make the
       * answer rate on the dashboard flattering rather than honest.
       */
      await closeTurn(turnId, {
        category: "unclassified",
        succeeded: false,
        latencyMs: Date.now() - askedAt,
      });
      throw error;
    }

    /*
     * THE EVIDENCE LADDER, now that the answer can speak, strongest first —
     * see `classifyChatTurn`:
     *   1. the template the answer proposed          (a fact about the answer)
     *   2. an attached report                        (a fact about the request)
     *   3. the knowledge categories it cited         (authoritative metadata on
     *                                                 the documents themselves)
     *   4. the question, read transiently            (only when 1-3 found none)
     */
    await closeTurn(turnId, {
      category: classifyChatTurn({
        proposedTemplateKey: answer.formProposal?.templateKey ?? null,
        offeredFormChoices: answer.formSelection !== undefined,
        hadReportContext: body.reportContext !== undefined && body.reportContext !== null,
        citedCategories: answer.citations.map((citation) => citation.category),
        question: body.question ?? null,
      }),
      succeeded: true,
      latencyMs: Date.now() - askedAt,
    });

    /*
     * `turnId` is always present here — `openTurn` throws rather than returning
     * nothing — so the answer is unconditionally rateable. The event below is
     * unreachable under this lifecycle and is kept as a tripwire: if a later
     * change ever reintroduces the gap, it is one log search rather than one
     * reproduction.
     */
    if (!turnId) {
      logTurnEvent("turn.answer.missing_turn", { surface, where: "api/chat" });
    }

    return NextResponse.json({ ...answer, turnId });
  } catch (error) {
    return errorResponse(error, "POST /api/chat");
  }
}

/** Validates and bounds everything that arrived from the browser. */
function parseAskRequest(body: Partial<AskRequest>): AskRequest {
  const context = body.context;

  return {
    question: requireString(body.question, "A question", LIMITS.question),
    mode: optionalEnum<AnswerMode>(body.mode, MODES, "standard"),
    history: parseHistory(body.history) as ChatMessage[],
    questionMessageId: optionalString(body.questionMessageId, LIMITS.messageId) || undefined,
    /*
     * A TEMPLATE KEY, BOUNDED, AND NOTHING ELSE. It says which kind of form the
     * last assistant turn offered, so answering "Sarah Test" to "who is this
     * for?" continues that proposal instead of becoming a knowledge query. Every
     * fact on the resulting proposal is still re-derived from the manager's own
     * turns, and the key is revalidated against the published library and the
     * actor's permission.
     */
    continueProposalTemplateKey:
      optionalString(body.continueProposalTemplateKey, CONTINUATION_KEY_MAX) || undefined,
    /*
     * THE MOST IMPORTANT OF THE SIX. Chat retrieves knowledge without the
     * caller naming a document, so a caller-chosen corpus here turns a question
     * into a search of another company's policies — with the answer quoting
     * them back. Answer mode, history, context and RAG semantics are unchanged;
     * only the corpus authority moved.
     */
    scopeId: activeKnowledgeCorpus(),
    /*
     * THE REPORT THE MANAGER WAS LOOKING AT, AS POINTERS.
     *
     * `parseChatReportContext` bounds and trims every field and returns null
     * unless the family is one of the five, so a malformed link selects nothing
     * rather than briefing on a guessed report. There is no field in the shape
     * through which a FIGURE could travel — the server re-reads the report — so
     * unlike the corpus above this one is safe to take from the body: the worst
     * a forged context can do is name rows the reader could already open the
     * dashboard to see, and `view_reports` is not what gates this route.
     *
     * Which is worth saying out loud, because it IS a real limitation and it is
     * the reporting read layer's rather than this route's: reads are not
     * narrowed per person's area, so everyone who reaches Chat sees the same
     * delivery the dashboards show them. That gap is recorded at length in
     * `api/reporting/sales-totals/analyze/route.ts` and is unchanged here.
     */
    reportContext: parseChatReportContext(body.reportContext),
    /*
     * REPORTING ONLY. It reaches the analytics row and nothing else — see the
     * field's own note on `AskRequest`. Validated here so a bad value becomes
     * null rather than travelling further as a string.
     */
    surface: isActivitySurface(body.surface) ? body.surface : null,
    attachedDocumentIds: Array.isArray(body.attachedDocumentIds)
      ? body.attachedDocumentIds
          .filter((id): id is string => typeof id === "string")
          .slice(0, LIMITS.documentIds)
      : undefined,
    context: {
      userName: optionalString(context?.userName, LIMITS.personName, "Manager"),
      locationName: optionalString(
        context?.locationName,
        LIMITS.personName,
        "your salon",
      ),
      /*
       * WHAT DAY IT IS COMES FROM THE SERVER, IN THE BUSINESS TIMEZONE.
       *
       * Two corrections live in this one line.
       *
       * IT USED TO PREFER THE CALLER'S `todayIso`, and the browser sent
       * `DEMO_ANCHOR.slice(0, 10)` — a frozen prototype date. So the prompt
       * opened with "Today is 2026-08-26" for as long as that constant stood,
       * and every freshness judgement Sunny could have made was made against a
       * day that had already passed. What day it is is a fact the server knows
       * and a client can only assert: the same argument as the corpus above,
       * one field down.
       *
       * AND IT USED TO BE UTC, which is the wrong ruler for "today" in a
       * business that operates in US zones. At 8pm Eastern the UTC date has
       * already rolled over, so a report covering yesterday would be described
       * as two days behind for the whole evening — every evening. `businessToday`
       * is the app's one answer to this, already used by follow-up dates and the
       * Overview, and reusing it is what keeps the product from holding two
       * opinions about what day it is.
       *
       * THE STORED PERIOD IS STILL AUTHORITATIVE. This decides only what
       * "today" means for the freshness comparison; which period a figure comes
       * from is read from the report, and no clock can move it.
       */
      todayIso: businessToday(),
    },
  };
}
