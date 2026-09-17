import { NextResponse } from "next/server";

import {
  assertLiveMode,
  assertNoConfigurationProblems,
  errorResponse,
} from "@/lib/api/respond";
import { parseJsonBody } from "@/lib/api/validation";
import { authorizeRequest } from "@/lib/auth/server";
import { AiError } from "@/lib/ai/errors";
import { deleteFeedback, moderateFeedback } from "@/lib/feedback/store";
import {
  isFeedbackStatus,
  RESOLUTION_NOTE_MAX_LENGTH,
} from "@/lib/feedback/types";

/**
 * PATCH /api/admin/feedback/[id] — act on one piece of feedback.
 *
 * ============================================================================
 * THE GATE IS `view_analytics`, WHICH IS ADMINISTRATION-ONLY
 * ============================================================================
 *
 * It is held by `admin`, `owner` and `developer` and by nobody else — a Salon
 * Director or District Manager reaching this route is refused with 403 by
 * `authorizeRequest` before the id is even read. That is the same permission
 * the analytics screen is gated by, deliberately: the queue and the page that
 * shows it are one capability, and splitting them would create a role that can
 * see complaints and not act on them, or act on them without seeing them.
 *
 * `authorizeRequest` RUNS BEFORE THE PRIVILEGED CLIENT IS TOUCHED, which is the
 * ordering every admin route here keeps: `moderateFeedback` holds a client that
 * bypasses row level security, so nothing may reach it that has not already
 * been authorized against a verified identity and the server's own matrix.
 *
 * THE ADMINISTRATOR IS TAKEN FROM THE SESSION, NEVER FROM THE BODY. There is no
 * field here through which a caller could attribute a resolution to somebody
 * else, which is the only thing that makes "resolved by" worth reading.
 *
 * ============================================================================
 * PATCH, NOT PUT, AND NOT DELETE
 * ============================================================================
 *
 * PATCH because the three things an administrator can change are independent:
 * a comment may be hidden without being resolved, resolved without being
 * hidden, and annotated without either. A body naming one leaves the other two
 * alone, so two administrators working the queue cannot clobber each other by
 * sending back a whole object.
 *
 * DELETE IS A SEPARATE VERB FROM HIDE, and the separation is deliberate.
 *
 * PATCH's `hidden` is moderation: it takes a comment off the dashboard, is
 * attributed and reversible, and leaves the record that somebody complained
 * intact. That is what an administrator reaches for when a real complaint
 * arrives in unusable words, and it is unchanged.
 *
 * DELETE is for the other case: a rating that was never feedback. A five-star
 * left while QA'ing the feature is not a complaint being buried — it is noise
 * that would move a production average forever, and hiding does not remove it
 * from the record of what leaders said. So it is a different verb, gated the
 * same way, confirmed in the UI, and drawn as destructive rather than routine.
 *
 * IT DOES NOT TOUCH THE TURN. The rating goes; the record that a question was
 * asked and answered stays, because it was.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    assertLiveMode();
    assertNoConfigurationProblems();
    const context = await authorizeRequest(request, "view_analytics");

    const { id } = await params;
    /*
     * SHAPE-CHECKED BEFORE IT REACHES A QUERY. An unparsed string passed to
     * Postgres as a uuid is an error page rather than a 400, and the caller
     * learns more from the former than they should.
     */
    if (!UUID.test(id)) {
      throw new AiError("bad_request", "That is not a feedback id.", 400);
    }

    const body = await parseJsonBody<{
      status?: unknown;
      resolutionNote?: unknown;
      hidden?: unknown;
    }>(request);

    /*
     * EACH FIELD IS OPTIONAL AND `undefined` MEANS "LEAVE IT". The distinction
     * between an absent key and an explicit null matters on both of the ones
     * that can be cleared: `resolutionNote: null` erases the note,
     * `resolutionNote` absent keeps it, and collapsing the two would make every
     * status change quietly wipe somebody's working notes.
     */
    const status = body.status;
    if (status !== undefined && !isFeedbackStatus(status)) {
      throw new AiError(
        "bad_request",
        "Status must be pending, in_review, resolved or dismissed.",
        400,
      );
    }

    let resolutionNote: string | null | undefined;
    if (body.resolutionNote !== undefined) {
      if (body.resolutionNote === null) {
        resolutionNote = null;
      } else if (typeof body.resolutionNote === "string") {
        if (body.resolutionNote.length > RESOLUTION_NOTE_MAX_LENGTH) {
          throw new AiError(
            "bad_request",
            `A resolution note may be at most ${RESOLUTION_NOTE_MAX_LENGTH} characters.`,
            400,
          );
        }
        resolutionNote = body.resolutionNote;
      } else {
        throw new AiError("bad_request", "A resolution note must be text.", 400);
      }
    }

    const hidden =
      typeof body.hidden === "boolean" ? body.hidden : undefined;

    if (status === undefined && resolutionNote === undefined && hidden === undefined) {
      throw new AiError(
        "bad_request",
        "Nothing to change. Send a status, a resolution note or a hidden flag.",
        400,
      );
    }

    await moderateFeedback({
      feedbackId: id,
      adminUserId: context.identity.subject,
      status,
      resolutionNote,
      hidden,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error, "PATCH /api/admin/feedback/[id]");
  }
}

/**
 * Permanently remove one piece of feedback.
 *
 * SAME GATE AS PATCH — `view_analytics`, which is administration-only — and the
 * same ordering: authorization clears before the privileged client is touched.
 * A Salon Director or District Manager reaching this is refused with 403
 * before the id is read.
 *
 * NO BODY, so there is nothing to validate and nothing a caller could assert.
 * The only input is the id in the path, and the only authority is the session.
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    assertLiveMode();
    assertNoConfigurationProblems();
    await authorizeRequest(request, "view_analytics");

    const { id } = await params;
    if (!UUID.test(id)) {
      throw new AiError("bad_request", "That is not a feedback id.", 400);
    }

    await deleteFeedback(id);

    return NextResponse.json({ ok: true, deleted: id });
  } catch (error) {
    return errorResponse(error, "DELETE /api/admin/feedback/[id]");
  }
}
