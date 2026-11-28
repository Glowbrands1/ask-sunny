// Ask Sunny only (not copied from the Leadership Hub): an L10 meeting as the chat's AI reads it. See src/features/l10/README.md.
import { formatValue, hasGoal, isMiss, issueTerm, readDoc, recentlySolved, ROCK_STATUS_LABEL } from "./doc";
import { pastMeetings, type PastMeeting } from "./past";
import { todoDueLabel } from "./todo-due";
import type { MeetingDoc, RecapRow } from "./types";
import { formatCentral } from "./when";

/**
 * ============================================================================
 * AN L10 MEETING, FOR THE AI (Pau, 28 Nov 2026: the meeting pages readable by Sunny's AI, "depends on the access of the
 * user ok? admin gets all")
 * ============================================================================
 *
 * What the meeting pages show, as short lines the model can quote: the current document (to-dos, open and recently
 * solved issues, headlines, rocks, the scorecard's latest weeks, the meeting notes and cascading message) and the past
 * meetings (recaps saved by End meeting, and the meetings imported from Bloom Growth). Nothing is invented: an empty
 * section is said to be empty. Every list is capped, and a capped list says how many it left out. Pure.
 *
 * Who may read a meeting is the Leadership Hub's decision (its attendees, and its admins), made before this runs.
 */

export const TODOS_MAX = 40;
export const ISSUES_MAX = 30;
export const SOLVED_MAX = 10;
export const HEADLINES_MAX = 20;
export const ROCKS_MAX = 25;
export const METRICS_MAX = 40;
export const METRIC_WEEKS = 4;
export const PAST_DEFAULT = 3;
export const PAST_MAX = 12;
const NOTES_MAX = 1_500;
const LINE_MAX = 300;

const clip = (s: string, max = LINE_MAX) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const who = (owner: string) => (owner.trim() ? owner.trim() : "no owner");

/** "3 more not listed" when a list was capped. */
function capped(lines: string[], total: number, max: number): string[] {
  return total > max ? [...lines.slice(0, max), `(${total - max} more not listed)`] : lines;
}

export interface MeetingSections {
  /** Open to-dos (overdue first), then how many are done. */
  todos: string[];
  todos_open: number;
  todos_overdue: number;
  todos_done: number;
  /** Open issues: the short-term list (this week's IDS) and the long-term list. */
  issues: string[];
  issues_open: number;
  /** Issues solved most recently. */
  solved: string[];
  headlines: string[];
  rocks: string[];
  /** Each metric with its goal and its latest weeks, newest first; "missed" where a week was off goal. */
  scorecard: string[];
  /** The shared meeting notes and the cascading message, when there are any. */
  notes: string | null;
  cascade: string | null;
}

/** The current document's sections. `today` is the business date (YYYY-MM-DD, Central) for "overdue". */
export function meetingSections(raw: Record<string, unknown> | null | undefined, today: string): MeetingSections {
  const doc: MeetingDoc = readDoc(raw);

  const todos = doc.todos.filter((t) => t && typeof t.text === "string");
  const open = todos.filter((t) => !t.done);
  const overdue = (t: { done: boolean; dueDate?: string }) => !t.done && typeof t.dueDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(t.dueDate) && t.dueDate < today;
  const openSorted = [...open.filter(overdue), ...open.filter((t) => !overdue(t))];
  const todoLines = openSorted.map((t) => {
    const due = todoDueLabel(t);
    return `${who(str(t.owner))}: ${clip(t.text)}${due ? ` (${due})` : ""}${overdue(t) ? " OVERDUE" : ""}`;
  });

  const issues = doc.issues.filter((i) => i && typeof i.title === "string");
  const openIssues = issues.filter((i) => !i.resolved);
  const issueLine = (i: (typeof issues)[number]) =>
    `${i.priority ? "! " : ""}${clip(i.title)}${i.owner ? ` (owner ${i.owner})` : ""}${str(i.notes).trim() ? ` — notes: ${clip(str(i.notes), 200)}` : ""}`;
  const short = openIssues.filter((i) => issueTerm(i) === "short").map((i) => `Short-term: ${issueLine(i)}`);
  const long = openIssues.filter((i) => issueTerm(i) === "long").map((i) => `Long-term: ${issueLine(i)}`);
  const solved = recentlySolved(issues).map((i) => `${clip(i.title)}${i.owner ? ` (owner ${i.owner})` : ""}${i.resolvedAt ? `, solved ${formatCentral(i.resolvedAt)}` : ""}`);

  const headlines = doc.headlines
    .filter((h) => h && typeof h.text === "string")
    .map((h) => `${h.kind === "customer" ? "Customer" : "Employee"} headline from ${who(str(h.author))}: ${clip(h.text)}`);

  const rocks = doc.rocks
    .filter((r) => r && typeof r.title === "string" && !r.archived)
    .map((r) => {
      const milestones = Array.isArray(r.milestones) ? r.milestones : [];
      const done = milestones.filter((m) => m && m.done).length;
      return `${who(str(r.owner))}: ${clip(r.title)} — ${ROCK_STATUS_LABEL[r.status] ?? r.status}${r.dueDate ? `, due ${r.dueDate}` : ""}${milestones.length ? `, ${done} of ${milestones.length} milestones done` : ""}`;
    });

  const weeks = doc.weekEndings;
  const scorecard = doc.scorecard
    .filter((row) => row && typeof row.metric === "string")
    .map((row) => {
      const values = Array.isArray(row.weeks) ? row.weeks : [];
      const latest: string[] = [];
      for (let i = values.length - 1; i >= 0 && latest.length < METRIC_WEEKS; i -= 1) {
        const v = values[i];
        const week = weeks[i] ? `week ending ${weeks[i]}` : `week ${i + 1}`;
        latest.push(`${week}: ${formatValue(v ?? null, row.format)}${isMiss(row, v) ? " missed" : ""}`);
      }
      const goal = hasGoal(row) ? `goal ${row.goal}` : "no goal set";
      return `${clip(row.metric, 120)}${row.salon ? ` [${row.salon}]` : ""} (${who(str(row.owner))}; ${goal}): ${latest.length ? latest.join("; ") : "no weeks entered"}`;
    });

  const notes = str(doc.meetingNotes).trim();
  const cascade = doc.cascade.trim();
  return {
    todos: capped(todoLines, todoLines.length, TODOS_MAX),
    todos_open: open.length,
    todos_overdue: open.filter(overdue).length,
    todos_done: todos.length - open.length,
    issues: capped([...short, ...long], short.length + long.length, ISSUES_MAX),
    issues_open: openIssues.length,
    solved: capped(solved, solved.length, SOLVED_MAX),
    headlines: capped(headlines, headlines.length, HEADLINES_MAX),
    rocks: capped(rocks, rocks.length, ROCKS_MAX),
    scorecard: capped(scorecard, scorecard.length, METRICS_MAX),
    notes: notes ? clip(notes, NOTES_MAX) : null,
    cascade: cascade ? clip(cascade, NOTES_MAX) : null,
  };
}

/** One past meeting as one paragraph: when, rating, who came, what was solved and left open, its notes. */
export function pastMeetingLine(m: PastMeeting): string {
  const parts = [`Held ${formatCentral(m.heldAt)}${m.source === "bloom-growth" ? " (imported from Bloom Growth)" : ""}`];
  if (m.durationSeconds) parts.push(`${Math.round(m.durationSeconds / 60)} minutes`);
  parts.push(m.ratingAvg === null ? "no rating" : `rated ${m.ratingAvg}`);
  if (m.attendees.length) parts.push(`attendees: ${m.attendees.map((a) => `${a.name}${a.rating === null ? "" : ` ${a.rating}`}`).join(", ")}`);
  if (m.recorded.issues) parts.push(m.solvedIssues.length ? `issues solved: ${m.solvedIssues.map((i) => `${clip(i.title, 150)}${i.owner ? ` (${i.owner})` : ""}`).join("; ")}` : `issues solved: ${m.issuesSolved}`);
  else parts.push(`issues solved: ${m.issuesSolved} (titles not recorded)`);
  if (m.todosCompletedPct !== null) parts.push(`to-dos completed: ${m.todosCompletedPct}%`);
  if (m.recorded.todos) parts.push(m.openTodos.length ? `to-dos open at the end: ${m.openTodos.slice(0, 15).map((t) => `${who(t.owner)}: ${clip(t.text, 150)}${t.due ? ` (due ${t.due})` : ""}`).join("; ")}${m.openTodos.length > 15 ? `; and ${m.openTodos.length - 15} more` : ""}` : "no to-dos open at the end");
  if (m.cascade) parts.push(`cascading message: ${clip(m.cascade, 400)}`);
  if (m.notes) parts.push(`notes: ${clip(m.notes, 600)}`);
  return parts.join(" · ");
}

/** The past meetings, newest first, at most `count`. */
export function pastMeetingLines(recaps: RecapRow[], raw: Record<string, unknown> | null | undefined, count: number): { lines: string[]; total: number } {
  const all = pastMeetings(recaps, raw ?? {});
  return { lines: all.slice(0, Math.max(0, count)).map(pastMeetingLine), total: all.length };
}

/** One saved version of the meeting, as the Meeting history page lists it. */
export interface MeetingVersionRow {
  version: number;
  savedAt: string;
  savedByName: string | null;
  isCurrent: boolean;
  isImport: boolean;
}

/** What the AI's meeting reader gets from the Leadership Hub, as the person asking (`ai-read.server.ts`). */
export type MeetingContentRead =
  | { state: "off" }
  | { state: "failed" }
  /** The Hub refused: this person neither attends the meeting nor is an admin (or the meeting is not shown in this app). */
  | { state: "forbidden" }
  | { state: "ok"; part: "now"; version: number; updatedAt: string | null; doc: Record<string, unknown>; recaps: RecapRow[] }
  | { state: "ok"; part: "history"; rows: MeetingVersionRow[] }
  /** One saved version's document (the Meeting version page). null: the Hub has no such version. */
  | { state: "ok"; part: "version"; version: number; doc: Record<string, unknown> | null };
