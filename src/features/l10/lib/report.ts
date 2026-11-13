// Copied from the Leadership Hub (src/lib/meetings/report.ts); keep in step with it. See src/features/l10/README.md.
import { cellTone, displayName, formatDuration, formatHeld, formatValue, rockSections, shortDate, type CellTone } from "./doc";
import { childrenOf, readSeats, type Seat } from "./seats";
import type { Issue, MeetingDoc, RecapRow, Rock, ScorecardRow, Vto } from "./types";
import type { Roster } from "./config";
import { rockGroups, rockScore, type Status as TStatus, type TRock, type TrackerV2 } from "@/features/l10/lib/tracker/v2";

/**
 * The meeting report (Export PDF), one per meeting, built only from what the Hub already stores for THAT meeting: its
 * document (rocks, business plan, accountability chart, issues, scorecard) and its recaps. Nothing is invented and no
 * other meeting's data is mixed in. The company-level pages of the sample (Team Health, the quarterly tracker, the
 * 3-year glide path, annual goals, marketing by brand) belong to the Leadership report only. All but Marketing by
 * Brand come from the Quarterly Tracker once it has data (companyPageHasData); until then, and always for Marketing
 * by Brand, they print a "No data tracked in the Hub yet" placeholder (NOT_TRACKED).
 */

export const NO_DATA = "No data tracked in the Hub yet";

/** "Q4 2026" for a date (calendar quarters). */
export function quarterLabel(d: Date): string {
  return `Q${Math.floor(d.getUTCMonth() / 3) + 1} ${d.getUTCFullYear()}`;
}

/** "11-02-2026", as the sample's title uses. */
export function reportDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}-${d.getUTCFullYear()}`;
}

export const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

/* ── Goals ────────────────────────────────────────────────────────────── */

export type StatusWord = "Done" | "On track" | "Off track" | "Not started";
export const statusWord = (s: Rock["status"]): StatusWord => (s === "done" ? "Done" : s === "off-track" ? "Off track" : "On track");

export interface RockLine {
  id: string;
  title: string;
  owner: string;
  due: string;
  milestones: string;
  status: StatusWord;
}

export interface GoalsSection {
  company: RockLine[];
  people: { name: string; initials: string; rocks: RockLine[] }[];
  /** Individual (not Company) rocks: how many are done of how many. */
  done: number;
  total: number;
}

const rockLine = (r: Rock): RockLine => {
  const ms = Array.isArray(r.milestones) ? r.milestones : [];
  return {
    id: r.id,
    title: r.title,
    owner: r.owner,
    due: r.dueDate ?? "",
    milestones: ms.length ? `${ms.filter((m) => m.done).length}/${ms.length} milestones` : "",
    status: statusWord(r.status),
  };
};

/** Company rocks, then each person's rocks (archived rocks are left out). */
export function goalsSection(rocks: Rock[]): GoalsSection {
  const sections = rockSections(rocks ?? [], [], false);
  const company = (sections.find(([o]) => o === "Company")?.[1] ?? []).map(rockLine);
  const people = sections
    .filter(([o, list]) => o !== "Company" && list.length)
    .map(([o, list]) => ({ name: o, initials: initialsOf(o), rocks: list.map(rockLine) }));
  const individual = people.flatMap((p) => p.rocks);
  return { company, people, done: individual.filter((r) => r.status === "Done").length, total: individual.length };
}

/* ── Business plan ────────────────────────────────────────────────────── */

export interface PlanSection {
  coreValues: { name: string; desc: string }[];
  purpose: string;
  niche: string;
  tenYear: string;
  marketing: string;
  threeYear: string[];
  oneYear: string[];
  quarterly: RockLine[];
}

const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const items = (v: unknown) => (Array.isArray(v) ? v.map((x) => text((x as { text?: unknown })?.text)).filter(Boolean) : []);

export function planSection(vto: Vto | undefined, rocks: Rock[]): PlanSection {
  const v = vto ?? {};
  return {
    coreValues: (Array.isArray(v.coreValues) ? v.coreValues : []).map((c) => ({ name: text(c?.name), desc: text(c?.desc) })).filter((c) => c.name || c.desc),
    purpose: text(v.purpose),
    niche: text(v.niche),
    tenYear: text(v.tenYear),
    marketing: text(v.marketingStrategy),
    threeYear: items(v.threeYear),
    oneYear: items(v.oneYear),
    quarterly: goalsSection(rocks).company,
  };
}

/* ── Accountability chart ─────────────────────────────────────────────── */

export interface SeatNode {
  id: string;
  title: string;
  name: string;
  open: boolean;
  initials: string;
  responsibilities: string[];
  children: SeatNode[];
}

/** The meeting's seats as trees (roots first). A seat whose parent is missing is shown as a root. */
export function seatTree(raw: unknown): SeatNode[] {
  const seats = readSeats(raw);
  const ids = new Set(seats.map((s) => s.id));
  const seen = new Set<string>();
  const node = (s: Seat): SeatNode => {
    seen.add(s.id);
    return {
      id: s.id,
      title: s.title,
      name: s.name,
      open: !s.name.trim(),
      initials: initialsOf(s.name),
      responsibilities: s.responsibilities,
      children: childrenOf(seats, s.id).filter((c) => !seen.has(c.id)).map(node),
    };
  };
  return seats.filter((s) => s.parentId === null || !ids.has(s.parentId)).map(node);
}

/* ── Issues ───────────────────────────────────────────────────────────── */

export interface IssuesSection {
  groups: { person: string; titles: string[] }[];
  open: number;
  /** Issues solved at the last L10 (latest recap), or null when there is no recap. */
  solvedLast: number | null;
}

export function issuesSection(issues: Issue[], recaps: Pick<RecapRow, "held_at" | "resolved_issues">[], roster?: Pick<Roster, "members">): IssuesSection {
  const open = (issues ?? []).filter((i) => !i.resolved);
  const map = new Map<string, string[]>();
  for (const i of open) {
    const who = text(i.addedBy) ? displayName(text(i.addedBy), roster) : "Not assigned";
    map.set(who, [...(map.get(who) ?? []), i.title]);
  }
  const groups = [...map].map(([person, titles]) => ({ person, titles })).sort((a, b) => (a.person === "Not assigned" ? 1 : b.person === "Not assigned" ? -1 : a.person.localeCompare(b.person)));
  const latest = [...(recaps ?? [])].sort((a, b) => b.held_at.localeCompare(a.held_at))[0];
  return { groups, open: open.length, solvedLast: latest ? (latest.resolved_issues?.length ?? 0) : null };
}

/* ── Metrics (scorecard) ──────────────────────────────────────────────── */

export interface MetricCell {
  text: string;
  tone: CellTone;
}

export interface MetricsSection {
  /** Week-ending labels, oldest first (at most `weeks`). */
  weeks: string[];
  owners: { owner: string; rows: { metric: string; goal: string; cells: MetricCell[] }[] }[];
}

/** The last `count` weeks of the scorecard, one table per owner. */
export function metricsSection(doc: Pick<MeetingDoc, "scorecard" | "weekEndings">, count = 13): MetricsSection {
  const rows = Array.isArray(doc.scorecard) ? doc.scorecard : [];
  const n = Math.max(Array.isArray(doc.weekEndings) ? doc.weekEndings.length : 0, ...rows.map((r) => (Array.isArray(r.weeks) ? r.weeks.length : 0)), 0);
  const from = Math.max(0, n - count);
  const idx = Array.from({ length: n - from }, (_, i) => from + i);
  const weeks = idx.map((i) => shortDate(doc.weekEndings?.[i]) || `Wk ${i + 1}`);
  const byOwner = new Map<string, MetricsSection["owners"][number]["rows"]>();
  for (const r of rows as ScorecardRow[]) {
    const owner = text(r.owner) || "Not assigned";
    const cells = idx.map((i) => {
      const v = r.weeks?.[i] ?? null;
      return { text: formatValue(v, r.format), tone: cellTone(r, v) };
    });
    byOwner.set(owner, [...(byOwner.get(owner) ?? []), { metric: r.metric, goal: r.goal, cells }]);
  }
  return { weeks, owners: [...byOwner].map(([owner, rs]) => ({ owner, rows: rs })) };
}

/* ── Recaps ───────────────────────────────────────────────────────────── */

export interface RecapLine {
  id: string;
  held: string;
  duration: string;
  rating: string;
  solved: number;
  openTodos: number;
  cascade: string;
  autoSaved: boolean;
}

/** This meeting's recaps, newest first (at most `count`). */
export function recapsSection(recaps: RecapRow[], count = 13): RecapLine[] {
  return [...(recaps ?? [])]
    .sort((a, b) => b.held_at.localeCompare(a.held_at))
    .slice(0, count)
    .map((r) => ({
      id: r.id,
      held: formatHeld(r.held_at),
      duration: formatDuration(r.duration_seconds),
      rating: r.rating_avg != null ? Number(r.rating_avg).toFixed(1) : "—",
      solved: r.resolved_issues?.length ?? 0,
      openTodos: r.open_todos?.length ?? 0,
      cascade: text(r.cascade),
      autoSaved: !!r.auto_saved,
    }));
}

/* ── Sections and contents ────────────────────────────────────────────── */

/**
 * The Leadership report's company pages, filled from the Quarterly Tracker (and Marketing by Brand from the Business
 * Plan). A page without data prints a "No data tracked in the Hub yet" placeholder that says what it needs.
 */
export const NOT_TRACKED = [
  { id: "quarterly-tracker", title: "Quarterly Tracker", what: "rocks by quarter (the quarter's rocks and their status), from the Quarterly Tracker" },
  { id: "annual-goals", title: "Annual Goals & Measurables", what: "the year's measurables by quarter and the annual goals with their check-ins" },
  { id: "three-year-glide", title: "3-Year Glide Path", what: "3-year measurables (baseline, target, actual) and “what does it look like?” statements" },
  { id: "team-health", title: "Team Health", what: "a Team Health pulse: competency scores and behaviours" },
  { id: "long-term-issues", title: "Long-term Issues", what: "long-term issues from the Quarterly Tracker" },
  { id: "people-seats", title: "People & Seats", what: "the key people assessment (core values, performance, potential, role alignment)" },
  { id: "marketing-by-brand", title: "Marketing by Brand", what: "brand cards on the Business Plan page (who we're for, why us, proven process, guarantee)" },
] as const;
export type CompanyPageId = (typeof NOT_TRACKED)[number]["id"];

/** Sections every meeting's report has: all of these are stored per meeting. */
export const MEETING_SECTIONS = [
  { id: "goals", title: "Goals" },
  { id: "business-plan", title: "Business Plan" },
  { id: "org-chart", title: "Organizational Chart" },
  { id: "issues", title: "Issues" },
  { id: "metrics", title: "Metrics" },
  { id: "recaps", title: "Meeting Recaps" },
] as const;

/** The company-level placeholders print only in the Leadership report. */
export const hasCompanyPages = (key: string) => key === "leadership";

/** Whether a company page has anything to print (otherwise it keeps its placeholder). */
export function companyPageHasData(id: CompanyPageId, t: TrackerV2, vto: Vto | undefined): boolean {
  switch (id) {
    case "quarterly-tracker":
      return t.rocks.length > 0;
    case "annual-goals":
      return t.years.some((y) => y.measurables.length > 0) || t.goals.length > 0;
    case "three-year-glide":
      return t.plan.threeyear.measurables.length > 0 || t.plan.threeyear.looksLike.length > 0;
    case "team-health":
      return t.teamhealth.length > 0;
    case "long-term-issues":
      return t.issues.length > 0;
    case "people-seats":
      return t.plan.reference.people.length > 0;
    case "marketing-by-brand":
      return (vto?.brands ?? []).some((b) => b.brand.trim());
  }
}

const TRACKER_STATUS: Record<TStatus, StatusWord> = { done: "Done", on: "On track", off: "Off track", hold: "Not started" };

/**
 * The Leadership report's Goals page from the Quarterly Tracker's rocks for a quarter (company rocks, then each
 * owner's), with the quarter's score. Null when the tracker has no rocks for that quarter (the meeting's rocks are
 * used then).
 */
export function trackerGoals(t: TrackerV2, quarter: string): (GoalsSection & { pct: number }) | null {
  const groups = rockGroups(t.rocks, quarter);
  if (!groups.length) return null;
  const line = (r: TRock): RockLine => ({ id: r.id, title: r.title, owner: r.company ? "Company" : r.owner, due: "", milestones: r.notes, status: TRACKER_STATUS[r.status] });
  const all = t.rocks.filter((r) => r.quarter === quarter);
  const score = rockScore(all);
  return {
    company: groups.filter((g) => g.company).flatMap((g) => g.rocks.map(line)),
    people: groups.filter((g) => !g.company).map((g) => ({ name: g.title, initials: initialsOf(g.title), rocks: g.rocks.map(line) })),
    done: score.d,
    total: score.n,
    pct: score.pct,
  };
}

/** The report's sections in order for one meeting. */
export function reportSections(key: string): { id: string; title: string }[] {
  return [...MEETING_SECTIONS, ...(hasCompanyPages(key) ? NOT_TRACKED.map((t) => ({ id: t.id, title: t.title })) : [])];
}

/**
 * Table of contents in section order. No page numbers: a section can run over several printed pages (one per
 * scorecard owner, long rock lists), and the browser's print cannot look up which page a section lands on, so a
 * printed number would be a guess. Every printed page shows its own number at the bottom right.
 */
export const contents = (key: string) => reportSections(key).map((s, i) => ({ ...s, n: i + 1 }));
