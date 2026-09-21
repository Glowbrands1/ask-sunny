import { NextResponse } from "next/server";

import {
  assertLiveMode,
  assertNoConfigurationProblems,
  assertWithinRateLimit,
  errorResponse,
} from "@/lib/api/respond";
import { parseJsonBody } from "@/lib/api/validation";
import { authorizeRequest } from "@/lib/auth/server";
import { AiError } from "@/lib/ai/errors";
import {
  CONVERSATIONS_PER_REQUEST_MAX,
  partitionConversations,
} from "@/lib/chat/payload";
import { ownClientConversationIds, saveOwnConversation } from "@/lib/chat/store";

/**
 * GET  /api/chat/conversations/import — which of your local ids are already stored.
 * POST /api/chat/conversations/import — bring a batch of them over, under YOUR id.
 *
 * ============================================================================
 * NOTHING HERE HAPPENS WITHOUT SOMEBODY CHOOSING IT
 * ============================================================================
 *
 * A person's browser may hold conversations from before history was kept on
 * their account. Those are theirs, they are private to them, and uploading them
 * because a page loaded would be taking a copy of somebody's chat history
 * without asking — which is not a migration, it is an exfiltration with a
 * friendly changelog entry.
 *
 * So the POST is reached from one place: the Import button on a prompt that
 * says what would happen. "Not now" sends nothing at all — no probe, no
 * fingerprint, no count. The GET carries no conversation content in either
 * direction and exists so the prompt can offer what is genuinely missing rather
 * than everything, every time.
 *
 * ============================================================================
 * UNDER *HER* AUTHENTICATED USER ID, AND NOTHING ELSE DECIDES THAT
 * ============================================================================
 *
 * The owner of every row this route writes is `context.identity.subject` — the
 * subject of a Supabase session that `getUser()` validated, resolved to an
 * ACTIVE profile in `app_users`. Not an email in the body, not an id in the
 * local record, not the address of the request. There is no field on the
 * payload type through which ownership could be suggested, so there is nothing
 * to ignore.
 *
 * ============================================================================
 * THE SIX FABRICATED THREADS NEVER ENTER SUPABASE
 * ============================================================================
 *
 * `conv-seed-1 … conv-seed-6` were written into every production browser by the
 * store's own seed, and a manager never asked a word of them. They are declined
 * here, by structural validation and by name, as well as being filtered before
 * the prompt ever counts them — see `lib/chat/client-ids.ts`. Refusing in both
 * places is the point: the client decides what to offer, the server decides
 * what to store, and neither defers to the other.
 *
 * ============================================================================
 * IDEMPOTENT, RESUMABLE, AND HONEST ABOUT WHAT IT DECLINED
 * ============================================================================
 *
 * A batch is saved conversation by conversation through the same
 * `saveOwnConversation` a live chat uses, whose uniqueness constraints make a
 * repeat a no-op. A double-clicked Import, a refresh mid-run, a browser crash
 * and a retry after a 503 all converge on one conversation with one copy of
 * each turn.
 *
 * What could not be brought over is RETURNED WITH A REASON rather than dropped,
 * so a person is told "four of these were the demo threads" instead of quietly
 * getting a shorter history than they were shown.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    assertLiveMode();
    assertNoConfigurationProblems();
    const context = await authorizeRequest(request, "ask_questions");
    assertWithinRateLimit(request, "search");

    /*
     * IDS ONLY. No titles, no timestamps, no content — this answers "is it
     * already there", and anything more would make it a second way to read a
     * conversation. They are also only ever this person's own ids.
     */
    const stored = await ownClientConversationIds(context.identity.subject);
    return NextResponse.json({ stored });
  } catch (error) {
    return errorResponse(error, "GET /api/chat/conversations/import");
  }
}

export async function POST(request: Request) {
  try {
    assertLiveMode();
    assertNoConfigurationProblems();
    const context = await authorizeRequest(request, "ask_questions");
    assertWithinRateLimit(request, "mutate");

    const body = await parseJsonBody<{ conversations?: unknown }>(request);

    if (!Array.isArray(body.conversations)) {
      throw new AiError("bad_request", "No conversations were sent to import.", 400);
    }
    if (body.conversations.length === 0) {
      return NextResponse.json({ imported: [], declined: [] });
    }
    /*
     * BATCHED RATHER THAN BOUNDLESS. A whole history in one body is one request
     * to lose to a timeout; ten at a time means an interruption costs the batch
     * in flight and the next Import resumes from where the last one stopped.
     */
    if (body.conversations.length > CONVERSATIONS_PER_REQUEST_MAX) {
      throw new AiError(
        "bad_request",
        `Import sends at most ${CONVERSATIONS_PER_REQUEST_MAX} conversations at a time.`,
        400,
      );
    }

    const { eligible, declined } = partitionConversations(body.conversations);

    const imported: string[] = [];
    for (const payload of eligible) {
      /*
       * ONE AT A TIME, AND A FAILURE STOPS THE BATCH RATHER THAN SKIPPING IT.
       * The conversations already written stay written — they are complete, and
       * the constraints mean the next attempt adopts rather than duplicates
       * them. Carrying on past a database failure would report a partial import
       * as a whole one, which is the version of this a person cannot detect.
       */
      await saveOwnConversation(context.identity.subject, payload, { imported: true });
      imported.push(payload.clientConversationId);
    }

    return NextResponse.json({ imported, declined });
  } catch (error) {
    return errorResponse(error, "POST /api/chat/conversations/import");
  }
}
