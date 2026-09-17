import { NextResponse } from "next/server";

import {
  assertLiveMode,
  assertNoConfigurationProblems,
  assertWithinRateLimit,
  errorResponse,
} from "@/lib/api/respond";
import { LIMITS, parseJsonBody, requireString } from "@/lib/api/validation";
import { authorizeRequest } from "@/lib/auth/server";
import { AiError } from "@/lib/ai/errors";
import { ownFeedbackForTurns, saveFeedback } from "@/lib/feedback/store";
import {
  COMMENT_MAX_LENGTH,
  isFeedbackOutcome,
  isFeedbackRating,
} from "@/lib/feedback/types";

/**
 * POST /api/chat/feedback — rate one Ask Sunny answer.
 * GET  /api/chat/feedback?turn=<id>&turn=<id> — what you already said about them.
 *
 * ============================================================================
 * THE GATE IS `ask_questions`, AND THAT IS THE RIGHT ONE
 * ============================================================================
 *
 * Feedback is about an answer, so the permission to have received an answer is
 * the permission to rate one. Anything narrower would create a class of user
 * who can use Ask Sunny and cannot say it was wrong, which is precisely
 * backwards — the frontline Employee holding `ask_questions` is the population
 * whose complaints this feature exists to collect.
 *
 * IT IS NOT THE CHECK THAT MATTERS, THOUGH. `ask_questions` says this person
 * may rate SOMETHING. `assertOwnTurn`, inside the store, says which thing: the
 * turn named must be one this person is the recorded actor of. A caller holding
 * the permission and somebody else's turn id is refused with 403 before
 * anything is written — see `lib/feedback/store.ts`, where the reasoning lives.
 *
 * Guard order matches every other route here: mode, configuration,
 * authorization, rate limit, validation. Authorization before the rate limit so
 * an unauthorized caller cannot spend an authorized colleague's budget.
 *
 * ============================================================================
 * WHAT A FEEDBACK BODY MAY AND MAY NOT CARRY
 * ============================================================================
 *
 * IT MAY NOT CARRY THE IDENTITY. No `userId`, no role, no salon — every one of
 * those comes from `authorizeRequest`, and there is no field here a caller
 * could put one in. This is the same separation `/api/chat` makes for the form
 * proposal, for the same reason: the two facts a caller must never assert about
 * itself are who it is and what it may see.
 *
 * IT NEED NOT CARRY WORDS. A rating alone is a complete submission: the stars
 * are the required field and the outcome and the comment are both offered
 * rather than demanded, because the control that collects them is now a passive
 * "Rate this conversation" action and nothing in the product waits on it. What
 * arrives is still validated — a malformed outcome is refused, a 2001-character
 * comment is refused — and what is absent is stored as absent.
 *
 * IT MAY NOT CARRY THE STATUS. Moderation is an administrator's verb and lives
 * on its own route. A body arriving here with `status: "resolved"` is ignored
 * rather than rejected — it changes nothing, because nothing reads it.
 *
 * IT MAY CARRY THE BROWSER'S OWN IDS, and they are stored as opaque text for
 * tracing a complaint back to the thread somebody was reading. Never joined,
 * never unique, never consulted for access.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Browser-local conversation and message ids, matching the column bound. */
const CLIENT_ID_LIMIT = 128;

/** Turns whose feedback one GET may ask about. A thread, not a history. */
const MAX_TURNS_PER_READ = 50;

export async function POST(request: Request) {
  try {
    assertLiveMode();
    assertNoConfigurationProblems();
    const context = await authorizeRequest(request, "ask_questions");
    assertWithinRateLimit(request, "chat");

    const body = await parseJsonBody<{
      turnId?: unknown;
      rating?: unknown;
      gotWhatNeeded?: unknown;
      comment?: unknown;
      conversationId?: unknown;
      messageId?: unknown;
    }>(request);

    const turnId = requireString(body.turnId, "The answer being rated", LIMITS.messageId);

    /*
     * VALIDATED AGAINST THE SAME PREDICATES THE BROWSER USED.
     *
     * `isFeedbackRating` and `isFeedbackOutcome` are the functions the panel's
     * own save button is enabled by, imported rather than restated. A route
     * that re-expresses the rule in its own words is a route that will
     * eventually disagree with the form in front of the user — and the failure
     * mode is a person who filled everything in being told they did not.
     */
    if (!isFeedbackRating(body.rating)) {
      throw new AiError("bad_request", "A star rating from 1 to 5 is required.", 400);
    }
    /*
     * THE OUTCOME AND THE COMMENT ARE OPTIONAL, AND ABSENT IS NOT MALFORMED.
     *
     * Both were required, which was defensible while every answer demanded a
     * rating and indefensible now that rating is something a person chooses to
     * do: a voluntary form that refuses the thing somebody wanted to say
     * collects nothing at all. A VALUE THAT IS PRESENT IS STILL VALIDATED —
     * "maybe" is a bad outcome and is refused — so the distinction the route
     * draws is between "said nothing" and "said something wrong".
     */
    const gotWhatNeeded =
      body.gotWhatNeeded === undefined || body.gotWhatNeeded === null
        ? null
        : body.gotWhatNeeded;
    if (gotWhatNeeded !== null && !isFeedbackOutcome(gotWhatNeeded)) {
      throw new AiError(
        "bad_request",
        "Tell us whether you got what you needed: yes, partially or no.",
        400,
      );
    }

    const comment =
      typeof body.comment === "string" ? body.comment.trim() : "";
    if (comment.length > COMMENT_MAX_LENGTH) {
      throw new AiError(
        "bad_request",
        `A comment may be at most ${COMMENT_MAX_LENGTH} characters.`,
        400,
      );
    }

    const saved = await saveFeedback({
      turnId,
      /*
       * FROM THE VALIDATED SESSION, NEVER FROM THE BODY. `subject` is what
       * `activity_events.actor_user_id` was written from when the answer was
       * given, which is what makes the ownership comparison meaningful.
       */
      userId: context.identity.subject,
      rating: body.rating,
      gotWhatNeeded,
      comment,
      clientConversationId: optionalClientId(body.conversationId),
      clientMessageId: optionalClientId(body.messageId),
    });

    return NextResponse.json({ feedback: saved });
  } catch (error) {
    return errorResponse(error, "POST /api/chat/feedback");
  }
}

export async function GET(request: Request) {
  try {
    assertLiveMode();
    assertNoConfigurationProblems();
    const context = await authorizeRequest(request, "ask_questions");

    const turnIds = new URL(request.url).searchParams
      .getAll("turn")
      .map((value) => value.trim())
      .filter((value) => value.length > 0 && value.length <= LIMITS.messageId)
      .slice(0, MAX_TURNS_PER_READ);

    /*
     * SCOPED TO THE CALLER INSIDE THE QUERY. Passing the subject rather than
     * filtering afterwards is what makes "you cannot read somebody else's
     * feedback" a property of the statement instead of a step somebody can
     * forget — and an administrator gets nothing extra here, because
     * moderation is a different route with a different gate.
     */
    const feedback = await ownFeedbackForTurns(context.identity.subject, turnIds);
    return NextResponse.json({ feedback });
  } catch (error) {
    return errorResponse(error, "GET /api/chat/feedback");
  }
}

function optionalClientId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > CLIENT_ID_LIMIT) return null;
  return trimmed;
}
