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
    const answer = await answerQuestion(parseAskRequest(body), {
      role: context.identity.role,
      scope: context.identity.scope,
    });

    return NextResponse.json(answer);
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
