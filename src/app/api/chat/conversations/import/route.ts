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
  MESSAGES_PER_REQUEST_MAX,
  partitionConversations,
} from "@/lib/chat/payload";
import { ownHistoryState, saveOwnConversation } from "@/lib/chat/store";

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
     * IDS, COUNTS AND ONE TIMESTAMP. No titles, no turns, no content — this
     * answers "what is already there, what did I delete, and when did I clear
     * everything", and anything more would make it a second way to read a
     * conversation. Every part of it is only ever this person's own.
     *
     * THE DELETIONS ARE THE POINT OF THIS ENDPOINT NOW. A browser that was not
     * open when somebody deleted a conversation on another device has no way to
     * know; without this it would show the stale copy, offer to import it, and
     * undo the delete.
     */
    const state = await ownHistoryState(context.identity.subject);
    return NextResponse.json(state);
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
    /*
     * BOUNDED ON TURNS AS WELL AS ON CONVERSATIONS, because ten conversations
     * is a bound on the wrong axis: one of them may hold five hundred turns.
     * The client packs requests by bytes and turns and splits anything too
     * large, and this is the server refusing to be talked out of that by a
     * client that did not.
     */
    const totalMessages = body.conversations.reduce((sum, entry) => {
      const messages = (entry as { messages?: unknown }).messages;
      return sum + (Array.isArray(messages) ? messages.length : 0);
    }, 0);
    if (totalMessages > MESSAGES_PER_REQUEST_MAX) {
      throw new AiError(
        "bad_request",
        `Import sends at most ${MESSAGES_PER_REQUEST_MAX} messages at a time.`,
        400,
      );
    }

    const { eligible, declined } = partitionConversations(body.conversations);

    const imported: string[] = [];
    for (const payload of eligible) {
      /*
       * ONE AT A TIME, AND A DATABASE FAILURE STOPS THE BATCH RATHER THAN
       * SKIPPING IT. The conversations already written stay written — they are
       * complete, and the constraints mean the next attempt adopts rather than
       * duplicates them. Carrying on past a failure would report a partial
       * import as a whole one, which is the version a person cannot detect.
       */
      const outcome = await saveOwnConversation(context.identity.subject, payload, {
        imported: true,
      });

      /*
       * A CONVERSATION THE PERSON DELETED IS DECLINED, NOT WRITTEN AND NOT AN
       * ERROR. A browser that has not hydrated since the delete will offer it,
       * and the honest answer is the same one a seeded demo thread gets: it is
       * reported back with a reason, and the rest of the batch goes through.
       */
      if (outcome === "suppressed") {
        declined.push({ id: payload.clientConversationId, reason: "deleted" });
        continue;
      }

      imported.push(payload.clientConversationId);
    }

    return NextResponse.json({ imported, declined });
  } catch (error) {
    return errorResponse(error, "POST /api/chat/conversations/import");
  }
}
