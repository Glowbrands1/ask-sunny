import { NextResponse } from "next/server";

import {
  assertLiveMode,
  assertNoConfigurationProblems,
  assertWithinRateLimit,
  errorResponse,
} from "@/lib/api/respond";
import { parseJsonBody } from "@/lib/api/validation";
import { authorizeRequest } from "@/lib/auth/server";
import { AuthError } from "@/lib/auth/types";
import { AiError } from "@/lib/ai/errors";
import { CONVERSATION_REFUSED } from "@/lib/chat/errors";
import { parseConversation } from "@/lib/chat/payload";
import {
  deleteAllOwnConversations,
  listOwnConversations,
  saveOwnConversation,
} from "@/lib/chat/store";

/**
 * GET    /api/chat/conversations — your own history.
 * POST   /api/chat/conversations — save one of your own conversations.
 * DELETE /api/chat/conversations — clear your own history.
 *
 * ============================================================================
 * "YOUR OWN" IS NOT A FILTER APPLIED AFTERWARDS. IT IS THE ONLY QUERY THERE IS.
 * ============================================================================
 *
 * Every one of these passes `context.identity.subject` — the subject a
 * validated Supabase session resolved to a profile row in `app_users` — into a
 * store function that scopes its statement by it. There is no parameter, body
 * field or header on any of these methods through which another person's id
 * could travel, and no code path that returns a conversation the caller does
 * not own. That is the whole authorization model for Phase 2A, and it is
 * deliberately the narrowest one that makes the feature work.
 *
 * THE GATE IS `ask_questions`, for the reason `/api/chat/feedback` uses the
 * same one: the permission to have had a conversation is the permission to
 * have its history. Anything narrower would create a class of user who can use
 * Ask Sunny and cannot find what they asked yesterday — and the frontline
 * Employee holding `ask_questions` is exactly who a second device serves.
 *
 * Guard order matches every other route here: mode, configuration,
 * authorization, rate limit, validation. Authorization before the rate limit so
 * an unauthorized caller cannot spend an authorized colleague's budget.
 *
 * ============================================================================
 * WHAT A BODY MAY NOT CARRY
 * ============================================================================
 *
 * NOT THE IDENTITY. No `userId`, no email, no role, no salon. `ConversationPayload`
 * has no field for any of them, so there is nothing here to read even by
 * mistake — the same separation `/api/chat` makes for the form proposal, and
 * for the same reason: the two facts a caller must never assert about itself
 * are who it is and what it may see.
 *
 * The `conv_*` and `msg_*` ids it does carry are CORRELATION KEYS. They decide
 * which of THIS PERSON'S rows a save converges on, and they confer nothing —
 * the uniqueness in Postgres is per user, so presenting somebody else's id
 * creates or updates a row of your own and never touches theirs.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    assertLiveMode();
    assertNoConfigurationProblems();
    const context = await authorizeRequest(request, "ask_questions");
    assertWithinRateLimit(request, "search");

    const conversations = await listOwnConversations(context.identity.subject);
    return NextResponse.json({ conversations });
  } catch (error) {
    return errorResponse(error, "GET /api/chat/conversations");
  }
}

export async function POST(request: Request) {
  try {
    assertLiveMode();
    assertNoConfigurationProblems();
    const context = await authorizeRequest(request, "ask_questions");
    assertWithinRateLimit(request, "mutate");

    const body = await parseJsonBody<{ conversation?: unknown }>(request);

    /*
     * PARSED SERVER-SIDE, with the same function the browser used to decide
     * what to offer. The client's copy chooses what to SEND; this one chooses
     * what to STORE, and it does not trust the client for having run it.
     *
     * A seeded demo thread is refused here as well as filtered there — every
     * production browser holds six of them, and "the client would not send one"
     * is not a guarantee, it is a hope about a build that may be older than
     * this deployment.
     */
    const parsed = parseConversation(body.conversation);
    if (!parsed.ok) {
      throw new AiError(
        "bad_request",
        "That conversation could not be saved: it is not a conversation Ask Sunny recorded.",
        400,
      );
    }

    const outcome = await saveOwnConversation(context.identity.subject, parsed.payload);

    /*
     * A CONVERSATION THE PERSON DELETED IS NOT REOPENED BY WRITING TO IT.
     *
     * This is the stale-browser case: a second device that was not open when
     * the delete happened still holds the thread and would otherwise push it
     * straight back up. It is refused with the same sentence a conversation
     * that is not yours gets — from this side both mean "that is not yours to
     * write", and distinguishing them would say which ids were once real.
     */
    if (outcome === "suppressed") {
      throw new AuthError("forbidden", CONVERSATION_REFUSED);
    }

    return NextResponse.json({ saved: parsed.payload.clientConversationId });
  } catch (error) {
    return errorResponse(error, "POST /api/chat/conversations");
  }
}

/**
 * Clear history — every conversation on THIS ACCOUNT, on every device.
 *
 * The History panel's wording says exactly that now, because the old sentence
 * ("Removes every conversation stored in this browser") stopped being true the
 * moment history existed server-side. A control that promises less than it does
 * is the kind of thing somebody discovers by losing something.
 *
 * SCOPED BY THE SESSION'S OWN SUBJECT. There is no argument to this method at
 * all, which is the strongest form the guarantee can take: a delete here cannot
 * name anybody, so it cannot name anybody else.
 */
export async function DELETE(request: Request) {
  try {
    assertLiveMode();
    assertNoConfigurationProblems();
    const context = await authorizeRequest(request, "ask_questions");
    assertWithinRateLimit(request, "mutate");

    await deleteAllOwnConversations(context.identity.subject);

    return NextResponse.json({ cleared: true });
  } catch (error) {
    return errorResponse(error, "DELETE /api/chat/conversations");
  }
}
