// Copied from the Leadership Hub (src/lib/meetings/timer.ts); keep in step with it. See src/features/l10/README.md.
import { agendaFor, type AgendaKey } from "./config";
import { keepHiddenAttendees } from "./doc";
import type { Attendee, Issue, MeetingDoc, Todo } from "./types";

/**
 * The shared meeting clock, kept inside the meeting document under `timer` as Lovable did.
 * It stores a start time, not a running count, so it costs one save per start, pause or
 * section change, not one per second; every screen works out the elapsed time itself.
 */
export type View = AgendaKey | "business-plan" | "accountability";

/** Reference items sit beside the agenda: they have no planned time and no clock. */
export const isReferenceView = (v: View): v is "business-plan" | "accountability" => v === "business-plan" || v === "accountability";

export interface Timer {
  /** Epoch ms the clock last started running, or null when paused or stopped. */
  startedAt: number | null;
  /** Milliseconds banked from earlier running stretches. */
  accum: number;
  running: boolean;
  started: boolean;
  /** Set when the meeting is ended: everyone sees it is over. */
  ended: boolean;
  /** Identifies this meeting so only one recap is saved for it. */
  sessionId: string | null;
  /** Who started the meeting and drives the agenda: a stable id and a name to show. */
  leader: string | null;
  leaderLabel: string | null;
  /** The section the leader is on; other screens follow it. */
  leaderView: View | null;
}

export const emptyTimer = (): Timer => ({ startedAt: null, accum: 0, running: false, started: false, ended: false, sessionId: null, leader: null, leaderLabel: null, leaderView: null });

export function readTimer(doc: Pick<MeetingDoc, "timer"> | Record<string, unknown>): Timer {
  const t = (doc as { timer?: Partial<Timer> }).timer;
  return t && typeof t === "object" ? { ...emptyTimer(), ...t } : emptyTimer();
}

export function elapsedSeconds(t: Timer, now: number): number {
  return Math.max(0, Math.floor((t.accum + (t.running && t.startedAt ? now - t.startedAt : 0)) / 1000));
}

export function formatClock(sec: number): string {
  return `${String(Math.floor(sec / 60)).padStart(2, "0")}:${String(sec % 60).padStart(2, "0")}`;
}

export function pausedTimer(t: Timer, now: number): Timer {
  return { ...t, running: false, startedAt: null, accum: t.accum + (t.startedAt ? now - t.startedAt : 0) };
}
export const resumedTimer = (t: Timer, now: number): Timer => ({ ...t, started: true, running: true, startedAt: now });
export const endedTimer = (t: Timer, now: number): Timer => ({ ...pausedTimer(t, now), ended: true });

/**
 * Starting a meeting: a clean slate for ratings and Business Best, to-dos roll over (done ones drop off, open ones
 * carry forward, and a to-do that has survived two meetings drops down to the issues list), and the starter leads.
 */
export function startMeeting(doc: MeetingDoc, now: number, viewer: { id: string; label: string }, attendees: Attendee[]): MeetingDoc {
  const carried: Todo[] = doc.todos.filter((t) => !t.done).map((t) => ({ ...t, carryCount: (t.carryCount ?? 0) + 1 }));
  const escalating = carried.filter((t) => (t.carryCount ?? 0) >= 2 && !t.escalated);
  const ids = new Set(escalating.map((t) => t.id));
  const todos = carried.map((t) => (ids.has(t.id) ? { ...t, escalated: true } : t));
  const issues: Issue[] = [
    ...doc.issues.map((i) => (i.resolvedSession === "pending" ? { ...i, resolvedSession: "prior" } : i)),
    ...escalating.map((t, n) => ({
      id: `rollover-${now.toString(36)}-${n}`,
      title: `Overdue to-do: ${t.text}`,
      notes: `Owned by ${t.owner}. Open for ${t.carryCount} weeks, dropped down from the To-Do list.`,
      resolved: false,
      addedBy: t.owner,
    })),
  ];
  return {
    ...doc,
    todos,
    issues,
    // A clean slate for the people shown; rows of people the page no longer shows are kept as they were.
    attendees: keepHiddenAttendees(doc.attendees ?? [], attendees.map((a) => ({ ...a, shared: false, rating: null }))),
    timer: { ...emptyTimer(), started: true, running: true, startedAt: now, sessionId: new Date(now).toISOString(), leader: viewer.id, leaderLabel: viewer.label, leaderView: agendaFor("x")[0].key },
  };
}

/** Where a section's planned time runs out, in seconds, including any extra time. */
export const plannedSeconds = (minutes: number, extraMinutes: number) => (minutes + extraMinutes) * 60;
