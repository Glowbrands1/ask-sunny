// Copied from the Leadership Hub (src/lib/meetings/autosave.ts); keep in step with it. See src/features/l10/README.md.
import { buildRecap } from "./doc";
import { readTimer } from "./timer";
import type { Attendee, MeetingDoc, RecapInput, RecapRow } from "./types";

/**
 * Auto-saved recaps: a meeting that was started but never ended still gets a recap.
 *
 * The database does this on a schedule (l10.auto_save_unended_meetings, migration
 * 20261125120000_l10_auto_save_recaps.sql); this module is the same rule in TypeScript, used by the
 * synthetic fixture mode and by the unit tests, so both sides can be checked against one description:
 *
 *   - only a meeting whose clock was started, is not ended, and has a session id;
 *   - only once it has gone quiet (no save for IDLE_MS) AND is past its planned length plus GRACE_MS;
 *   - only if it actually ran: at least MIN_RUN_SECONDS of clock time up to its last save. A clock that was
 *     started by accident and left alone never produces an empty recap;
 *   - one recap per (meeting, session): an existing recap (ended on purpose) is never touched, and a later
 *     manual End replaces an auto-saved one (see mergeEnd).
 */
export const IDLE_MS = 60 * 60 * 1000;
export const GRACE_MS = 2 * 60 * 60 * 1000;
export const MIN_RUN_SECONDS = 10 * 60;
export const DEFAULT_MEETING_MINUTES = 90;

/** "Mondays · 90 min" -> 90. The same parse the SQL does on l10.meetings.cadence. */
export function plannedMinutes(cadence: string | null | undefined): number {
  const m = /(\d+)\s*min/i.exec(cadence ?? "");
  return m ? Number(m[1]) : DEFAULT_MEETING_MINUTES;
}

/** Clock time up to the meeting's last save: a clock left running after everyone left does not count. */
export function activeSeconds(doc: Record<string, unknown>, lastSavedAt: number): number {
  const t = readTimer(doc);
  const running = t.running && t.startedAt ? Math.max(0, lastSavedAt - t.startedAt) : 0;
  return Math.min(86400, Math.floor((t.accum + running) / 1000));
}

export type AutoDecision =
  | { save: false; reason: "not-started" | "ended" | "no-session" | "still-active" | "within-length" | "never-ran" }
  | { save: true; recap: RecapInput; heldAt: string };

/** Should this saved meeting get an auto-saved recap now, and what would it say? */
export function autoRecapDecision(
  doc: Record<string, unknown>,
  lastSavedAt: number,
  now: number,
  cadence: string | null | undefined,
): AutoDecision {
  const t = readTimer(doc);
  if (!t.started) return { save: false, reason: "not-started" };
  if (t.ended) return { save: false, reason: "ended" };
  if (!t.sessionId) return { save: false, reason: "no-session" };
  if (now - lastSavedAt < IDLE_MS) return { save: false, reason: "still-active" };
  const start = Date.parse(t.sessionId);
  const startMs = Number.isNaN(start) ? lastSavedAt : start;
  if (startMs + plannedMinutes(cadence) * 60_000 + GRACE_MS > now) return { save: false, reason: "within-length" };
  const seconds = activeSeconds(doc, lastSavedAt);
  if (seconds < MIN_RUN_SECONDS) return { save: false, reason: "never-ran" };
  const d = doc as Partial<MeetingDoc>;
  const full: MeetingDoc = {
    scorecard: [],
    weekEndings: [],
    rocks: [],
    headlines: [],
    vto: {} as MeetingDoc["vto"],
    seats: [],
    ...d,
    todos: Array.isArray(d.todos) ? d.todos : [],
    issues: Array.isArray(d.issues) ? d.issues : [],
    attendees: Array.isArray(d.attendees) ? d.attendees : [],
    cascade: typeof d.cascade === "string" ? d.cascade : "",
  };
  return { save: true, heldAt: new Date(startMs).toISOString(), recap: buildRecap(full, full.attendees as Attendee[], t.sessionId, t.sessionId, seconds) };
}

/** The meeting document after an auto-save: the clock stops, the meeting is over, and it says why. */
export function autoEndedDoc(doc: Record<string, unknown>, seconds: number): Record<string, unknown> {
  const t = readTimer(doc);
  return { ...doc, timer: { ...t, running: false, startedAt: null, accum: seconds * 1000, ended: true, autoSaved: true } };
}

/** True when this meeting was closed by the auto-save rather than by someone pressing End. */
export const wasAutoSaved = (doc: Record<string, unknown>) => (doc as { timer?: { autoSaved?: unknown } }).timer?.autoSaved === true;

export type MergeOutcome = { kind: "created" } | { kind: "replaced"; index: number } | { kind: "exists" };

/**
 * One recap per (meeting, session). A recap that exists already wins, unless it was auto-saved and this is a
 * person ending the meeting: then the person's recap replaces it (same row, no longer marked auto-saved).
 * An auto-save never replaces anything.
 */
export function mergeEnd(recaps: Pick<RecapRow, "meeting_key" | "session_id" | "auto_saved">[], key: string, sessionId: string, auto: boolean): MergeOutcome {
  const index = recaps.findIndex((r) => r.meeting_key === key && r.session_id === sessionId);
  if (index < 0) return { kind: "created" };
  if (!auto && recaps[index].auto_saved) return { kind: "replaced", index };
  return { kind: "exists" };
}

export const AUTO_SAVED_LABEL = "Auto-saved: meeting was not ended";
