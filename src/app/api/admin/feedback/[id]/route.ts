import { NextResponse } from "next/server";

import {
  assertLiveMode,
  assertNoConfigurationProblems,
  errorResponse,
} from "@/lib/api/respond";
import { parseJsonBody } from "@/lib/api/validation";
import { authorizeRequest } from "@/lib/auth/server";
import { AiError } from "@/lib/ai/errors";
import { moderateFeedback } from "@/lib/feedback/store";
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
 * NO DELETE VERB EXISTS ON THIS ROUTE, and that is the point of `hidden`.
 * Removing a comment from the dashboard is a moderation act; erasing the record
 * that somebody complained is not one this product offers. The row stays, the
 * rating leaves the averages, and "what was hidden, by whom, when" stays a
 * question with an answer.
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
