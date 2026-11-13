// Copied from the Leadership Hub (src/lib/meetings/doc.ts); keep in step with it. See src/features/l10/README.md.
import type { Roster } from "./config";
import type { Attendee, Issue, IssueTerm, MeetingDoc, MetricFormat, Milestone, RecapInput, Rock, RockStatus, ScorecardRow } from "./types";

/* ── Reading a saved document ─────────────────────────────────────────────
 * A meeting that has nothing saved shows empty lists, never invented content.
 * Unknown keys are kept as they are, so a save writes back everything it read. */

const asArray = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

export function readDoc(raw: Record<string, unknown> | null | undefined): MeetingDoc {
  const d = raw ?? {};
  return {
    ...d,
    scorecard: asArray<ScorecardRow>(d.scorecard),
    weekEndings: asArray<string>(d.weekEndings),
    rocks: asArray<Rock>(d.rocks),
    headlines: asArray(d.headlines),
    todos: asArray(d.todos),
    issues: asArray<Issue>(d.issues),
    attendees: asArray<Attendee>(d.attendees),
    cascade: typeof d.cascade === "string" ? d.cascade : "",
    vto: d.vto && typeof d.vto === "object" ? (d.vto as MeetingDoc["vto"]) : {},
    seats: asArray(d.seats),
  };
}

/* ── Attendees come from the meeting's own member list ────────────────── */

export function displayName(first: string, roster?: Pick<Roster, "members">): string {
  return roster?.members.find((m) => m.first === first)?.name ?? first;
}

/**
 * Who is on the segue page: this meeting's own members, with each person's shared /
 * rating state taken from the saved document by name. (Lovable seeded the same three
 * people into every meeting.)
 */
export function effectiveAttendees(roster: Pick<Roster, "members">, saved: Attendee[]): Attendee[] {
  const byName = new Map(saved.map((a) => [a.name, a]));
  return roster.members.map(({ first, name, role: known }) => {
    const was = byName.get(name);
    const role = was?.role || known || "";
    return was ? { ...was, role } : { id: `att-${first.toLowerCase()}`, name, role, shared: false, rating: null };
  });
}

/* ── Scorecard ──────────────────────────────────────────────────────────── */

/** Newest week first, as indexes into `weeks`. */
export function newestFirst(doc: Pick<MeetingDoc, "scorecard" | "weekEndings">): number[] {
  const n = Math.max(doc.weekEndings.length, ...doc.scorecard.map((r) => r.weeks.length), 0);
  return Array.from({ length: n }, (_, i) => n - 1 - i);
}

/** "04/26/2026" -> "4/26" */
export function shortDate(mmddyyyy: string | undefined): string {
  if (!mmddyyyy) return "";
  const [mm, dd] = mmddyyyy.split("/");
  return mm && dd ? `${Number(mm)}/${Number(dd)}` : mmddyyyy;
}

export function formatValue(v: number | null | undefined, format: MetricFormat): string {
  if (v == null) return "—";
  if (format === "percent") return `${v.toFixed(Math.abs(v) < 10 ? 2 : 1).replace(/\.?0+$/, "")}%`;
  if (format === "currency") {
    if (Math.abs(v) >= 1000) return `$${Math.round(v).toLocaleString("en-US")}`;
    return `$${v.toFixed(2)}`;
  }
  return v.toLocaleString("en-US");
}

export function isMiss(row: ScorecardRow, v: number | null | undefined): boolean {
  if (v == null || row.bidirectional) return false;
  return row.higherIsBetter ? v < row.goalValue : v > row.goalValue;
}

/** How far below the goal still counts as "close": this share of the goal value (percent). A row may carry its own `tolerance`. */
export const DEFAULT_TOLERANCE_PCT = 10;

function tolerancePct(row: ScorecardRow): number {
  const t = row.tolerance;
  return typeof t === "number" && Number.isFinite(t) && t >= 0 ? t : DEFAULT_TOLERANCE_PCT;
}

/**
 * Cell text colour. Green: meets or beats the goal. Black: short of it by no more than the tolerance
 * (default 10% of the goal value, or the row's own `tolerance`). Red: worse than that, and any negative
 * value (as in Lovable). Bidirectional goals count as met, as before.
 */
export type CellTone = "empty" | "negative" | "bad" | "near" | "good";
export function cellTone(row: ScorecardRow, v: number | null | undefined): CellTone {
  if (v == null) return "empty";
  if (v < 0) return "negative";
  if (!isMiss(row, v)) return "good";
  const band = (Math.abs(row.goalValue) * tolerancePct(row)) / 100;
  const shortBy = row.higherIsBetter ? row.goalValue - v : v - row.goalValue;
  return shortBy <= band + 1e-9 ? "near" : "bad";
}

/** What a person typed into a cell: "$1,200", "5.87%", "" (clears). Anything else is not a number. */
export function parseCell(raw: string): { ok: true; value: number | null } | { ok: false } {
  const cleaned = raw.replace(/[$,%\s]/g, "");
  if (cleaned === "") return { ok: true, value: null };
  const n = Number(cleaned);
  return Number.isFinite(n) ? { ok: true, value: n } : { ok: false };
}

/** MM/DD/YYYY + 7 days. */
export function nextWeekEnding(last: string | undefined): string {
  if (!last) return "";
  const [mm, dd, yyyy] = last.split("/").map(Number);
  if (!mm || !dd || !yyyy) return "";
  const d = new Date(Date.UTC(yyyy, mm - 1, dd + 7));
  return `${String(d.getUTCMonth() + 1).padStart(2, "0")}/${String(d.getUTCDate()).padStart(2, "0")}/${d.getUTCFullYear()}`;
}

export function addWeek(doc: MeetingDoc): MeetingDoc {
  const last = doc.weekEndings[doc.weekEndings.length - 1];
  const weekEndings = last ? [...doc.weekEndings, nextWeekEnding(last)] : doc.weekEndings;
  const target = weekEndings.length || (doc.scorecard[0]?.weeks.length ?? 0) + 1;
  return {
    ...doc,
    weekEndings,
    weekCount: target,
    scorecard: doc.scorecard.map((r) => {
      const weeks = [...r.weeks];
      while (weeks.length < target) weeks.push(null);
      return { ...r, weeks };
    }),
  };
}

export function setCell(doc: MeetingDoc, rowId: string, weekIdx: number, value: number | null): MeetingDoc {
  return {
    ...doc,
    scorecard: doc.scorecard.map((r) => {
      if (r.id !== rowId) return r;
      const weeks = [...r.weeks];
      while (weeks.length <= weekIdx) weeks.push(null);
      weeks[weekIdx] = value;
      return { ...r, weeks };
    }),
  };
}

/* ── Issues ───────────────────────────────────────────────────────────── */

/**
 * Ranking (per person). Every person ranks up to three open issues 1, 2 and 3 for themselves; the votes live on the
 * issue, keyed by the person's user id, so two people voting at once merge cleanly (key by key) and nobody's save can
 * remove someone else's vote. The room's result is the tally: most #1 votes first, then #2, then #3, then title A–Z.
 *
 * Before per-person ranking an issue held one shared `rank`. Those are kept: while nobody has voted they still order the
 * list and show as the badges, labelled "previous shared order"; once anyone votes, the tally takes over.
 */
export const RANKS = [1, 2, 3] as const;
export type Rank = (typeof RANKS)[number];
export type Voter = { id: string; name: string };

const openIssues = (issues: Issue[]) => issues.filter((i) => !i.resolved);
const votesOf = (i: Issue) => (i.votes && typeof i.votes === "object" ? Object.entries(i.votes) : []);

/** This person's rank on this issue, if any. */
export function myRank(issue: Issue, voterId: string): Rank | undefined {
  const v = issue.votes?.[voterId];
  return v && RANKS.includes(v.rank) ? v.rank : undefined;
}

/** The numbers this person has already used on open issues. */
function usedBy(issues: Issue[], voterId: string, exceptId?: string): Set<number> {
  return new Set(openIssues(issues).filter((i) => i.id !== exceptId).map((i) => myRank(i, voterId)).filter((r): r is Rank => !!r));
}

/** Whether pressing the rank control would do anything for this person (it would not if all three of their numbers are used). */
export function canVote(issues: Issue[], id: string, voterId: string): boolean {
  const me = issues.find((i) => i.id === id);
  if (!me || me.resolved) return false;
  if (myRank(me, voterId)) return true;
  return usedBy(issues, voterId).size < RANKS.length;
}

/**
 * One press: an issue this person has not ranked gets their lowest free number; one they have ranked is cleared.
 * Nothing changes if all three of their numbers are used. Other people's votes are never touched.
 */
export function toggleVote(issues: Issue[], id: string, voter: Voter): Issue[] {
  const me = issues.find((i) => i.id === id);
  if (!me || me.resolved) return issues;
  if (myRank(me, voter.id)) {
    return issues.map((i) => {
      if (i.id !== id) return i;
      const votes = { ...(i.votes ?? {}) };
      delete votes[voter.id];
      return Object.keys(votes).length ? { ...i, votes } : withoutKey(i, "votes");
    });
  }
  const used = usedBy(issues, voter.id, id);
  const next = RANKS.find((n) => !used.has(n));
  if (!next) return issues;
  return issues.map((i) => (i.id === id ? { ...i, votes: { ...(i.votes ?? {}), [voter.id]: { rank: next, name: voter.name } } } : i));
}

export interface TallyRow {
  issue: Issue;
  /** Names of who ranked it 1, 2 and 3 (alphabetical). */
  names: Record<Rank, string[]>;
  total: number;
}

/** Every open issue with at least one vote, in the room's order: most #1, then #2, then #3, then title A–Z. */
export function tallyVotes(issues: Issue[]): TallyRow[] {
  const rows: TallyRow[] = [];
  for (const issue of openIssues(issues)) {
    const names: Record<Rank, string[]> = { 1: [], 2: [], 3: [] };
    for (const [, v] of votesOf(issue)) if (v && RANKS.includes(v.rank)) names[v.rank].push(typeof v.name === "string" && v.name ? v.name : "Someone");
    const total = names[1].length + names[2].length + names[3].length;
    if (!total) continue;
    for (const r of RANKS) names[r].sort((a, b) => a.localeCompare(b));
    rows.push({ issue, names, total });
  }
  return rows.sort(
    (a, b) =>
      b.names[1].length - a.names[1].length ||
      b.names[2].length - a.names[2].length ||
      b.names[3].length - a.names[3].length ||
      a.issue.title.localeCompare(b.issue.title),
  );
}

/** The sign-in ids of everyone who has ranked an open issue (votes are keyed by the voter's id). */
export function voterIds(issues: Issue[]): Set<string> {
  const ids = new Set<string>();
  for (const issue of openIssues(issues)) for (const [id, v] of votesOf(issue)) if (v && RANKS.includes(v.rank)) ids.add(id);
  return ids;
}

export interface VoterPicks {
  /** The voter's sign-in id (votes are keyed by it). */
  id: string;
  /** The name stored with their votes. */
  name: string;
  /** Their own #1, #2 and #3 open issue, where they have used that number. */
  picks: Partial<Record<Rank, Issue>>;
}

/** Each person who has ranked an open issue, with their own 1, 2 and 3 (names A–Z). */
export function picksByVoter(issues: Issue[]): VoterPicks[] {
  const byId = new Map<string, VoterPicks>();
  for (const issue of openIssues(issues)) {
    for (const [id, v] of votesOf(issue)) {
      if (!v || !RANKS.includes(v.rank)) continue;
      const row = byId.get(id) ?? { id, name: typeof v.name === "string" && v.name ? v.name : "Someone", picks: {} };
      row.picks[v.rank] = issue;
      byId.set(id, row);
    }
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** True when nobody has voted yet on any open issue, so the old shared ranks still decide the order. */
export const usesPreviousOrder = (issues: Issue[]) => tallyVotes(issues).length === 0 && openIssues(issues).some((i) => i.rank);

/** The room's top three as issue id -> 1, 2, 3: from the votes, or from the old shared ranks while nobody has voted. */
export function groupRanks(issues: Issue[]): Map<string, Rank> {
  const tally = tallyVotes(issues);
  if (tally.length) return new Map(tally.slice(0, 3).map((row, n) => [row.issue.id, RANKS[n]]));
  return new Map(openIssues(issues).filter((i) => i.rank && RANKS.includes(i.rank as Rank)).map((i) => [i.id, i.rank as Rank]));
}

/** The issues that held the old shared ranks (1, 2, 3), for the "previous shared order" line. */
export function previousOrder(issues: Issue[]): Issue[] {
  return openIssues(issues)
    .filter((i) => i.rank && RANKS.includes(i.rank as Rank))
    .sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0));
}

/** The room's top three first (1, 2, 3), then the other open issues in added order; solved last. */
export function sortIssues(issues: Issue[]): Issue[] {
  const ranks = groupRanks(issues);
  const open = openIssues(issues);
  const ranked = open.filter((i) => ranks.has(i.id)).sort((a, b) => (ranks.get(a.id) ?? 0) - (ranks.get(b.id) ?? 0));
  const rest = open.filter((i) => !ranks.has(i.id));
  return [...ranked, ...rest, ...issues.filter((i) => i.resolved)];
}

/** Solving or reopening releases the issue's votes and its old shared rank. */
export function toggleSolved(issues: Issue[], id: string, session: string, now: string = new Date().toISOString()): Issue[] {
  return issues.map((i) => {
    if (i.id !== id) return i;
    const base = withoutKey(withoutKey(withoutKey(i, "rank"), "votes"), "resolvedAt");
    return i.resolved ? { ...base, resolved: false, resolvedSession: null } : { ...base, resolved: true, resolvedSession: session, resolvedAt: now };
  });
}

/** Which open-issue list an issue sits on; anything not marked long-term is short-term. */
export function issueTerm(i: Pick<Issue, "term">): IssueTerm {
  return i.term === "long" ? "long" : "short";
}

/** Solved issues, most recently solved first (issues without a solve time keep their order, after the dated ones). */
export function recentlySolved(issues: Issue[]): Issue[] {
  const at = (i: Issue) => (typeof i.resolvedAt === "string" ? Date.parse(i.resolvedAt) || 0 : 0);
  return issues
    .filter((i) => i.resolved)
    .map((i, n) => ({ i, n }))
    .sort((a, b) => at(b.i) - at(a.i) || a.n - b.n)
    .map((x) => x.i);
}

function withoutKey<T extends object>(o: T, key: string): T {
  const copy = { ...o } as Record<string, unknown>;
  delete copy[key];
  return copy as T;
}

export function searchIssues(issues: Issue[], query: string): Issue[] {
  const q = query.trim().toLowerCase();
  if (!q) return issues;
  return issues.filter((i) => i.title.toLowerCase().includes(q) || (i.notes ?? "").toLowerCase().includes(q));
}

/* ── Rocks ────────────────────────────────────────────────────────────── */

export const ROCK_STATUS_LABEL: Record<RockStatus, string> = { "on-track": "On track", "off-track": "Off track", done: "Done" };
export const ROCK_STATUS_ORDER: RockStatus[] = ["on-track", "off-track", "done"];

/** Owners in Lovable's order: Company, then the meeting's people, then anyone else with a rock. */
export function rockSections(rocks: Rock[], owners: string[], showArchived: boolean): [string, Rock[]][] {
  const order = ["Company", ...owners.filter((o) => o !== "Company")];
  const map = new Map<string, Rock[]>(order.map((o) => [o, []]));
  for (const r of rocks) {
    if (r.archived && !showArchived) continue;
    if (!map.has(r.owner)) map.set(r.owner, []);
    map.get(r.owner)!.push(r);
  }
  return [...map].filter(([o, list]) => order.includes(o) || list.length > 0);
}

/** A copy for another owner: fresh ids, milestones unticked. */
export function duplicateRock(rock: Rock, owner: string, newId: () => string): Rock {
  return {
    ...rock,
    id: newId(),
    owner,
    lead: owner === "Company" ? rock.lead : undefined,
    milestones: rock.milestones.map((m: Milestone) => ({ ...m, id: newId(), done: false })),
  };
}

/* ── To-dos ───────────────────────────────────────────────────────────── */

/** "send the deck @Pat" -> owner Pat Example, text "send the deck". */
export function parseMention(raw: string, candidates: string[]): { text: string; owner?: string } {
  const m = raw.match(/@([A-Za-z][A-Za-z\-']{0,30})/);
  if (!m) return { text: raw };
  const tag = m[1].toLowerCase();
  const match = candidates.find((p) => p.toLowerCase().startsWith(tag));
  if (!match) return { text: raw };
  return { text: raw.replace(m[0], "").replace(/\s{2,}/g, " ").trim(), owner: match };
}

export function isOverdue(t: { done: boolean; dueDate?: string }, today: string): boolean {
  return !t.done && !!t.dueDate && t.dueDate < today;
}

/** Overdue first, then open, then done. */
export function sortTodos<T extends { done: boolean; dueDate?: string }>(todos: T[], today: string): T[] {
  const rank = (t: T) => (isOverdue(t, today) ? 0 : t.done ? 2 : 1);
  return [...todos].sort((a, b) => rank(a) - rank(b));
}

/* ── Ids ──────────────────────────────────────────────────────────────── */

let counter = 0;
/** A short unique id for new items (Lovable used random 8-character strings). */
export function newItemId(): string {
  counter += 1;
  return `${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 5)}`;
}

/* ── Concluding a meeting ─────────────────────────────────────────────── */

/** The meeting's recap: ratings, outstanding to-dos, and only the issues solved in this session. */
export function buildRecap(doc: MeetingDoc, attendees: Attendee[], sessionKey: string, sessionId: string, durationSeconds = 0): RecapInput {
  const rated = attendees.filter((a) => a.rating != null);
  const ratingAvg = rated.length ? rated.reduce((sum, a) => sum + (a.rating ?? 0), 0) / rated.length : null;
  return {
    sessionId,
    cascade: doc.cascade,
    ratingAvg,
    durationSeconds,
    attendees: attendees.map((a) => ({ name: a.name, rating: a.rating })),
    openTodos: doc.todos.filter((t) => !t.done),
    resolvedIssues: doc.issues.filter((i) => i.resolved && (i.resolvedSession ?? null) === sessionKey).map((i) => i.title),
  };
}

/** After a recap is saved its solved issues move to that session, so they never appear in a later recap. */
export function markRecapped(issues: Issue[], sessionKey: string, sessionId: string): Issue[] {
  return issues.map((i) => (i.resolved && (i.resolvedSession ?? null) === sessionKey ? { ...i, resolvedSession: sessionId } : i));
}

/** "2026-10-26T16:23:24Z" -> "Oct 26, 2026" (UTC, so every viewer sees the same date). */
export function formatHeld(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

export function formatDuration(seconds: number): string {
  if (!seconds) return "—";
  const m = Math.round(seconds / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
}
