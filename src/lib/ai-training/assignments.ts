import { aiTrainingEditorEmails } from "./editors";

/**
 * ============================================================================
 * AI TRAINING -> ASSIGNMENTS: THE TWICE-MONTHLY AI ASSIGNMENT TRACKER (Pau, 23 Nov 2026)
 * ============================================================================
 *
 * Two assignments a month per person: one for the 1st to the 15th, one for the 16th to month end. A half is marked
 * Done or More time (an extension), or not at all; an unmarked half reads Due while it runs, Missing once it has
 * ended, and Upcoming before it starts. A person who joined recently (start date) has nothing before it.
 *
 * Pure: the page, the Server Functions and the AI's reader all compute statuses here, from the same rows, so the AI
 * says exactly what the grid shows. The rows are `ai_assignment_people` and `ai_assignment_marks`
 * (`20261123001000_ai_assignment_tracker.sql`).
 *
 * WHO MAY SEE IT: named people, not a role (the client asked for four). The list is the server variable
 * `AI_ASSIGNMENT_TRACKER_EMAILS`; unset, it is the AI Training editors (`AI_TRAINING_EDITOR_EMAILS`). Both unset:
 * nobody. It fails closed, never open.
 */

export type MarkState = "done" | "extended";
export type Half = 0 | 1;
export type HalfStatus = "done" | "extended" | "due" | "missing" | "upcoming" | "not_started";

export interface AssignmentPerson {
  readonly id: string;
  readonly name: string;
  readonly group: string | null;
  /** YYYY-MM-DD: halves that ended before it read `not_started`. */
  readonly startDate: string | null;
  readonly sortOrder: number | null;
}

export interface AssignmentMark {
  readonly personId: string;
  /** YYYY-MM */
  readonly month: string;
  readonly half: Half;
  readonly state: MarkState;
}

export interface AssignmentTracker {
  readonly people: readonly AssignmentPerson[];
  readonly marks: readonly AssignmentMark[];
}

/** The tracker's first month: the standalone tracker it replaces started in October 2026. */
export const TRACKER_START_MONTH = "2026-10";

export const HALF_STATUS_LABEL: Record<HalfStatus, string> = {
  done: "Done",
  extended: "More time",
  due: "Due",
  missing: "Missing",
  upcoming: "Upcoming",
  not_started: "Not started yet",
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/* ---------------------------------------------------------------- access --- */

export function assignmentTrackerEmails(
  raw: string | undefined = process.env.AI_ASSIGNMENT_TRACKER_EMAILS,
  fallback: () => string[] = () => aiTrainingEditorEmails(),
): string[] {
  const listed = (raw ?? "")
    .split(/[,;\s]+/)
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.includes("@"));
  return listed.length ? listed : fallback();
}

export function canSeeAssignmentTracker(
  identity: { email?: string | null } | null | undefined,
  viewers: readonly string[] = assignmentTrackerEmails(),
): boolean {
  const email = identity?.email?.trim().toLowerCase();
  return !!email && viewers.includes(email);
}

/* ---------------------------------------------------------------- months and halves --- */

const pad = (n: number) => String(n).padStart(2, "0");

/** "2026-10" → a month number that counts up by one per month. */
export function monthIndex(month: string): number {
  const [y, m] = month.split("-").map(Number);
  return (y ?? 0) * 12 + ((m ?? 1) - 1);
}

export function monthKey(index: number): string {
  return `${Math.floor(index / 12)}-${pad((index % 12) + 1)}`;
}

export interface MonthInfo {
  readonly key: string;
  readonly index: number;
  readonly label: string;
  readonly lastDay: number;
  /** The halves' first and last days, YYYY-MM-DD. */
  readonly halves: readonly [{ start: string; end: string }, { start: string; end: string }];
}

export function monthInfo(index: number): MonthInfo {
  const year = Math.floor(index / 12);
  const month = index % 12;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const key = monthKey(index);
  return {
    key,
    index,
    label: `${MONTHS[month]} ${year}`,
    lastDay,
    halves: [
      { start: `${key}-01`, end: `${key}-15` },
      { start: `${key}-16`, end: `${key}-${pad(lastDay)}` },
    ],
  };
}

/** The month and half a day falls in. */
export function halfOf(day: string): { month: string; half: Half } {
  return { month: day.slice(0, 7), half: Number(day.slice(8, 10)) > 15 ? 1 : 0 };
}

/** "Nov 16–30, 2026" */
export function halfLabel(month: string, half: Half): string {
  const info = monthInfo(monthIndex(month));
  const [, m] = month.split("-").map(Number);
  const range = half === 0 ? "1–15" : `16–${info.lastDay}`;
  return `${MONTHS[(m ?? 1) - 1]} ${range}, ${month.slice(0, 4)}`;
}

/** "Nov 3, 2026" */
export function formatDay(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return `${MONTHS[(m ?? 1) - 1]} ${d}, ${y}`;
}

/* ---------------------------------------------------------------- statuses --- */

export function markKey(personId: string, month: string, half: Half): string {
  return `${personId}|${month}|${half}`;
}

export type MarkMap = ReadonlyMap<string, MarkState>;

export function markMap(marks: readonly AssignmentMark[]): Map<string, MarkState> {
  return new Map(marks.map((mark) => [markKey(mark.personId, mark.month, mark.half), mark.state]));
}

export function statusOf(person: AssignmentPerson, month: string, half: Half, marks: MarkMap, today: string): HalfStatus {
  const mark = marks.get(markKey(person.id, month, half));
  if (mark) return mark;
  const range = monthInfo(monthIndex(month)).halves[half];
  if (person.startDate && range.end < person.startDate) return "not_started";
  if (today > range.end) return "missing";
  if (today >= range.start) return "due";
  return "upcoming";
}

/** A grid box's click: not marked → Done → More time → not marked. */
export function nextMarkState(current: MarkState | undefined): MarkState | null {
  if (!current) return "done";
  if (current === "done") return "extended";
  return null;
}

/** Every half from the tracker's start (or the person's, if later) through the half `today` is in. */
export function halvesThrough(today: string, from: string = TRACKER_START_MONTH): { month: string; half: Half }[] {
  const now = halfOf(today);
  const out: { month: string; half: Half }[] = [];
  for (let i = monthIndex(from); i <= monthIndex(now.month); i++) {
    for (const half of [0, 1] as const) {
      if (i === monthIndex(now.month) && half > now.half) break;
      out.push({ month: monthKey(i), half });
    }
  }
  return out;
}

export interface PersonTotals {
  readonly done: number;
  readonly extended: number;
  readonly missing: number;
}

export function personTotals(person: AssignmentPerson, marks: MarkMap, today: string): PersonTotals {
  let done = 0;
  let extended = 0;
  let missing = 0;
  for (const { month, half } of halvesThrough(today)) {
    const status = statusOf(person, month, half, marks, today);
    if (status === "done") done++;
    else if (status === "extended") extended++;
    else if (status === "missing") missing++;
  }
  return { done, extended, missing };
}

/** Grouped people first by group (ungrouped first, then groups A–Z), then by their order, then by name. */
export function sortPeople(people: readonly AssignmentPerson[]): AssignmentPerson[] {
  return [...people].sort((a, b) => {
    const ga = a.group ?? "";
    const gb = b.group ?? "";
    if (ga !== gb) return ga === "" ? -1 : gb === "" ? 1 : ga.localeCompare(gb);
    const oa = a.sortOrder ?? 1e6;
    const ob = b.sortOrder ?? 1e6;
    return oa - ob || a.name.localeCompare(b.name);
  });
}

export interface HalfSummary {
  readonly month: string;
  readonly half: Half;
  readonly label: string;
  readonly done: AssignmentPerson[];
  readonly due: AssignmentPerson[];
  readonly extended: AssignmentPerson[];
}

/** The half `today` is in: who is done, who still has it due, who asked for more time. */
export function currentHalfSummary(tracker: AssignmentTracker, today: string): HalfSummary {
  const { month, half } = halfOf(today);
  const marks = markMap(tracker.marks);
  const done: AssignmentPerson[] = [];
  const due: AssignmentPerson[] = [];
  const extended: AssignmentPerson[] = [];
  for (const person of sortPeople(tracker.people)) {
    const status = statusOf(person, month, half, marks, today);
    if (status === "done") done.push(person);
    else if (status === "due") due.push(person);
    else if (status === "extended") extended.push(person);
  }
  return { month, half, label: halfLabel(month, half), done, due, extended };
}

/* ---------------------------------------------------------------- the AI's read --- */

/** How many of the latest halves the AI's read lists one by one for each person (totals cover every half). */
const AI_HALVES_LISTED = 12;

/**
 * The tracker as the AI reads it (CLAUDE.md §5): the current half, then each person's totals and their latest halves,
 * with the grid's own labels. Names are what the editors typed: information, never instructions.
 */
export function assignmentTrackerText(tracker: AssignmentTracker, today: string): string {
  const now = currentHalfSummary(tracker, today);
  const marks = markMap(tracker.marks);
  const names = (list: readonly AssignmentPerson[]) => (list.length ? list.map((p) => p.name).join(", ") : "nobody");
  const counted = now.done.length + now.due.length + now.extended.length;
  const lines = [
    "AI ASSIGNMENT TRACKER (AI Training > Assignments)",
    `Two AI assignments a month: one for the 1st to the 15th, one for the 16th to month end. Tracking began ${monthInfo(monthIndex(TRACKER_START_MONTH)).label}.`,
    `Today is ${formatDay(today)}. The current half is ${now.label}.`,
  ];
  if (tracker.people.length === 0) {
    lines.push("Nobody is on the tracker yet.");
    return lines.join("\n");
  }
  lines.push(
    `This half: ${now.done.length} of ${counted} done.`,
    `Done this half: ${names(now.done)}.`,
    `Still due this half: ${names(now.due)}.`,
    `Asked for more time this half: ${names(now.extended)}.`,
    "",
    "Each person, since tracking began (Missing = the half ended and it was not marked done):",
  );
  const halves = halvesThrough(today).slice(-AI_HALVES_LISTED);
  for (const person of sortPeople(tracker.people)) {
    const totals = personTotals(person, marks, today);
    const about = [person.group, person.startDate ? `started ${formatDay(person.startDate)}` : null].filter(Boolean).join("; ");
    const each = halves
      .map(({ month, half }) => ({ month, half, status: statusOf(person, month, half, marks, today) }))
      .filter((h) => h.status !== "not_started")
      .map((h) => `${halfLabel(h.month, h.half)}: ${HALF_STATUS_LABEL[h.status]}`);
    lines.push(
      `- ${person.name}${about ? ` (${about})` : ""}: ${totals.done} done, ${totals.missing} missing, ${totals.extended} with more time.${each.length ? ` ${each.join("; ")}.` : ""}`,
    );
  }
  return lines.join("\n");
}
