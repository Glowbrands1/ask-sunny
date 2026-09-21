import { NextResponse } from "next/server";

import {
  assertLiveMode,
  assertNoConfigurationProblems,
  assertWithinRateLimit,
  errorResponse,
} from "@/lib/api/respond";
import { authorizeRequest } from "@/lib/auth/server";
import { deleteOwnConversation, getOwnConversation } from "@/lib/chat/store";

/**
 * GET    /api/chat/conversations/[id] — open one of your own conversations.
 * DELETE /api/chat/conversations/[id] — delete one of your own conversations.
 *
 * ============================================================================
 * THIS IS THE ROUTE AN ATTACKER WOULD REACH FOR, SO SAY WHAT IT DOES
 * ============================================================================
 *
 * `[id]` is the browser's own `conv_*`, and it is the obvious thing to change
 * in a URL. Changing it buys nothing:
 *
 *   The lookup is `where user_id = <the session's subject> and
 *   client_conversation_id = <the id>`. Ownership is not checked after the row
 *   is found — it is part of finding it. A conversation belonging to somebody
 *   else is not a row this query considers.
 *
 *   A conversation that does not exist, one that belongs to somebody else, and
 *   an id that is not the shape this application mints all produce the SAME 403
 *   with the same sentence. There is no difference to read, so the endpoint
 *   cannot be used to learn which ids are real — the property `assertOwnTurn`
 *   established for turns, applied here to conversations.
 *
 *   A malformed id never reaches Postgres. `isClientConversationId` refuses it
 *   in the store, so a crafted value cannot become a query error whose text
 *   would say more than the refusal does.
 *
 * THERE IS NO ROUTE THAT TAKES A BARE MESSAGE ID. Messages are only ever
 * reached through the conversation that owns them, which is itself reached only
 * through its owner — so there is no `msg_*` a caller could substitute to pull
 * one turn out of somebody else's thread.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    assertLiveMode();
    assertNoConfigurationProblems();
    const context = await authorizeRequest(request, "ask_questions");
    assertWithinRateLimit(request, "search");

    const { id } = await params;
    const conversation = await getOwnConversation(context.identity.subject, id);

    return NextResponse.json({ conversation });
  } catch (error) {
    return errorResponse(error, "GET /api/chat/conversations/[id]");
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    assertLiveMode();
    assertNoConfigurationProblems();
    const context = await authorizeRequest(request, "ask_questions");
    assertWithinRateLimit(request, "mutate");

    const { id } = await params;
    await deleteOwnConversation(context.identity.subject, id);

    return NextResponse.json({ deleted: true });
  } catch (error) {
    return errorResponse(error, "DELETE /api/chat/conversations/[id]");
  }
}
