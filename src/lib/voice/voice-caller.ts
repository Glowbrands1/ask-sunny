import "server-only";

import { authorizeRequest } from "@/lib/auth/server";
import { AuthError } from "@/lib/auth/types";
import { l10Viewer, listMyMeetings } from "@/features/l10/data.server";
import { voiceInputEnabledFor } from "./voice-config";
import type { VoiceSurface } from "./voice-usage";
import type { AccessScope, Role } from "@/types";

/**
 * WHO IS ASKING FOR VOICE, CHECKED AGAIN ON THE SERVER (VOICE_INPUT_ENABLED).
 *
 * The one check both voice routes make (POST /api/chat/voice, the recording; POST /api/chat/voice/stream, live
 * dictation): the box's own access, then voice on for that verified email. The browser's word is never trusted.
 *
 *   "chat", "overview", "report": `authorizeRequest(request, "ask_questions")`, as /api/chat does;
 *   "l10": a verified viewer (`l10Viewer()`) and a meeting the Hub lists for them (`listMyMeetings()`), else 404;
 *   then `voiceInputEnabledFor` on the verified email, else the same 404 as an unknown route.
 */

export interface VoiceCaller {
  readonly userId: string;
  readonly email: string;
  readonly role: Role;
  readonly scope: AccessScope;
}

export type VoiceCallerCheck =
  | { readonly ok: true; readonly caller: VoiceCaller }
  | { readonly ok: false; readonly status: 401 | 403 | 404; readonly code: "unauthenticated" | "forbidden" | "not_found"; readonly message: string };

const NOT_FOUND = { ok: false, status: 404, code: "not_found", message: "Not found." } as const;

export async function checkVoiceCaller(request: Request, surface: VoiceSurface, meetingKey: string | null | undefined): Promise<VoiceCallerCheck> {
  let caller: VoiceCaller;
  if (surface === "l10") {
    const viewer = await l10Viewer();
    if (!viewer) return NOT_FOUND;
    const meetings = await listMyMeetings().catch(() => []);
    if (!meetings.some((meeting) => meeting.key === meetingKey)) return NOT_FOUND;
    caller = { userId: viewer.userId, email: viewer.email, role: viewer.role, scope: viewer.scope };
  } else {
    try {
      const context = await authorizeRequest(request, "ask_questions");
      caller = { userId: context.identity.subject, email: context.identity.email, role: context.identity.role, scope: context.identity.scope };
    } catch (error) {
      if (error instanceof AuthError) {
        return error.status === 401
          ? { ok: false, status: 401, code: "unauthenticated", message: error.message }
          : { ok: false, status: 403, code: "forbidden", message: error.message };
      }
      throw error;
    }
  }
  if (!voiceInputEnabledFor({ email: caller.email })) return NOT_FOUND;
  return { ok: true, caller };
}
