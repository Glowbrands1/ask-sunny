"use server";

import { isMeetingKey } from "@/features/l10/lib/config";
import { endMeeting, loadMeeting, saveMeeting, type EndOutcome, type SaveOutcome } from "@/features/l10/data.server";
import type { LoadedMeeting, RecapInput } from "@/features/l10/lib/types";

/**
 * The meeting page's Server Functions: the same names, inputs and checks as the Leadership Hub's
 * src/app/meetings/actions.ts. Server Functions can be called directly, so the inputs are checked here; the person is
 * always the verified session's (data.server.ts), and the Hub's database re-checks their role and the allowlist.
 */

/** Every save and refresh also says what time the server thinks it is, so screens can correct for a wrong laptop clock. */
export type Timed<T> = T & { serverTime?: number };

export async function saveMeetingAction(key: string, expectedVersion: number, doc: Record<string, unknown>): Promise<Timed<SaveOutcome>> {
  return { ...(await saveChecked(key, expectedVersion, doc)), serverTime: Date.now() };
}

async function saveChecked(key: string, expectedVersion: number, doc: Record<string, unknown>): Promise<SaveOutcome> {
  if (typeof key !== "string" || !isMeetingKey(key)) return { ok: false, kind: "invalid", message: "Unknown meeting." };
  if (!Number.isInteger(expectedVersion) || expectedVersion < 0) return { ok: false, kind: "invalid", message: "Invalid version." };
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) return { ok: false, kind: "invalid", message: "Invalid meeting data." };
  return saveMeeting(key, expectedVersion, doc);
}

const isList = (v: unknown) => Array.isArray(v);

/** Ends a meeting: saves its recap once per session. */
export async function endMeetingAction(key: string, input: RecapInput): Promise<EndOutcome> {
  if (typeof key !== "string" || !isMeetingKey(key)) return { ok: false, kind: "invalid", message: "Unknown meeting." };
  if (!input || typeof input.sessionId !== "string" || !input.sessionId || input.sessionId.length > 64) return { ok: false, kind: "invalid", message: "Invalid recap." };
  if (typeof input.cascade !== "string" || !isList(input.attendees) || !isList(input.openTodos) || !isList(input.resolvedIssues)) return { ok: false, kind: "invalid", message: "Invalid recap." };
  if (input.ratingAvg !== null && (typeof input.ratingAvg !== "number" || input.ratingAvg < 1 || input.ratingAvg > 10)) return { ok: false, kind: "invalid", message: "Invalid rating." };
  if (typeof input.durationSeconds !== "number" || input.durationSeconds < 0) return { ok: false, kind: "invalid", message: "Invalid duration." };
  return endMeeting(key, input);
}

/** The latest saved version, for keeping a screen in step with the rest of the meeting. Read only. */
export async function loadMeetingAction(key: string): Promise<Timed<{ ok: true; loaded: LoadedMeeting } | { ok: false }>> {
  if (typeof key !== "string" || !isMeetingKey(key)) return { ok: false, serverTime: Date.now() };
  const res = await loadMeeting(key);
  return { ...(res.ok ? { ok: true as const, loaded: res.loaded } : { ok: false as const }), serverTime: Date.now() };
}
