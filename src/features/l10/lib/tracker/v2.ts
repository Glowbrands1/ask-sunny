// Copied from the Leadership Hub (src/lib/tracker/v2.ts); keep in step with it. See src/features/l10/README.md.
import type { Competency } from "./tracker";
import { COMPETENCIES } from "./tracker";

/**
 * The Quarterly Tracker document, version 2: the same shape as the JB & Associates Quarterly Tracker app's export,
 * so that an export can be imported as it is. Figures are kept AS TYPED ("$1.2M", "1,234", "$987,654 YTD") and
 * read with num() only for the math, the way that app does. Stored in l10.tracker_state (one versioned document).
 *
 * The business-plan fields of the export (plan.core: vision, mission, niche, values, marketing per brand) are not
 * stored here: they live in the Leadership meeting's Business Plan (one source of truth).
 */

export const SCHEMA = 2;

export type Status = "on" | "off" | "done" | "hold";
export const STATUSES: Status[] = ["on", "off", "done", "hold"];
export const STATUS_LABEL: Record<Status, string> = { on: "On track", off: "Off track", done: "Done", hold: "Not started" };
export type LookStatus = "hold" | "on" | "done";
export const LOOK_STATUSES: LookStatus[] = ["hold", "on", "done"];
export const LOOK_LABEL: Record<LookStatus, string> = { hold: "Not started", on: "In motion", done: "In place" };
export type IssueStatus = "open" | "closed";

export interface TQuarter {
  /** "2026-Q3" */
  id: string;
  label: string;
  meetingDate: string;
  notes: string;
  order: number;
  period: string;
  year: number | null;
}

export interface TRock {
  id: string;
  company: boolean;
  owner: string;
  /** A quarter id, "2026-Q3". */
  quarter: string;
  status: Status;
  title: string;
  notes: string;
  order: number;
}

export interface Checkin {
  status: Status;
  note: string;
}

export interface TGoal {
  id: string;
  year: number | null;
  num: number | null;
  owner: string;
  text: string;
  notes: string;
  status: Status;
  /** By quarter id. */
  checkins: Record<string, Checkin>;
}

export type QKey = "1" | "2" | "3" | "4";
export const QKEYS: QKey[] = ["1", "2", "3", "4"];

export interface YearMeasurable {
  id: string;
  label: string;
  baseline: string;
  target: string;
  q: Record<QKey, string>;
  /** The annual goal number this measurable supports, if any. */
  goal: number | null;
  note: string;
}

export interface TYear {
  year: number;
  futureDate: string;
  revenue: string;
  notes: string;
  measurables: YearMeasurable[];
}

export interface TBehavior {
  id: string;
  comp: string;
  n: number | null;
  owners: string;
  score: number | null;
  text: string;
}

export interface TPulse {
  id: string;
  date: string;
  overall: number | null;
  notes: string;
  scores: Record<Competency, number | null>;
  pcts: Record<Competency, number | null>;
  behaviors: TBehavior[];
}

export interface TIssue {
  id: string;
  text: string;
  owner: string;
  quarter: string;
  added: string;
  status: IssueStatus;
  notes: string;
}

export interface PlanMeasurable {
  id: string;
  label: string;
  baseline: string;
  target: string;
  actual: string;
  asOf: string;
}

export interface LooksLike {
  id: string;
  text: string;
  status: LookStatus;
}

export interface Flywheel {
  id: string;
  brand: string;
  title: string;
  stages: { name: string; drivers: string[] }[];
}

export interface Swott {
  date: string;
  subtitle: string;
  strengths: string[];
  weaknesses: string[];
  opportunities: string[];
  threats: string[];
  trends: string[];
}

export interface KeyPerson {
  id: string;
  name: string;
  cv: number | null;
  perf: number | null;
  pot: number | null;
  ra: number | null;
  note: string;
}

export interface TrackerV2 {
  schema: 2;
  settings: { currentQuarter: string; year: number | null };
  quarters: TQuarter[];
  rocks: TRock[];
  goals: TGoal[];
  years: TYear[];
  teamhealth: TPulse[];
  issues: TIssue[];
  plan: {
    threeyear: { futureDate: string; revenue: string; notes: string; measurables: PlanMeasurable[]; looksLike: LooksLike[] };
    reference: { flywheels: Flywheel[]; swott: Swott; people: KeyPerson[]; peopleDate: string; peopleNote: string };
  };
}

/* ── Reading (tolerant: anything malformed is dropped, never thrown) ─────── */

type O = Record<string, unknown>;
const obj = (v: unknown): O => (v && typeof v === "object" && !Array.isArray(v) ? (v as O) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
/** Text as typed. Numbers become their text (an export may hold 1234 instead of "1,234"). */
export const text = (v: unknown, max = 2000): string => (typeof v === "string" ? v.slice(0, max) : typeof v === "number" && Number.isFinite(v) ? String(v) : "");
const n = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : null);
const yearOf = (v: unknown): number | null => {
  const x = n(v);
  return x !== null && Number.isInteger(x) && x > 1900 && x < 3000 ? x : null;
};
const status = (v: unknown, fallback: Status = "on"): Status => (STATUSES.includes(v as Status) ? (v as Status) : fallback);
const lookStatus = (v: unknown): LookStatus => (LOOK_STATUSES.includes(v as LookStatus) ? (v as LookStatus) : "hold");
const strList = (v: unknown, max = 500): string[] => arr(v).map((x) => text(x, max)).filter((s) => s.trim() !== "");

let seq = 0;
/** A new id for an item (browser or server). */
export const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const idOr = (v: unknown, fallback: string) => text(v, 80) || fallback;

function readQuarter(raw: unknown, i: number): TQuarter | null {
  const o = obj(raw);
  const id = text(o.id, 20);
  if (!/^\d{4}-Q[1-4]$/.test(id)) return null;
  return { id, label: text(o.label, 80) || `Q${id.slice(6)} ${id.slice(0, 4)}`, meetingDate: text(o.meetingDate, 40), notes: text(o.notes, 4000), order: n(o.order) ?? i, period: text(o.period, 120), year: yearOf(o.year) ?? Number(id.slice(0, 4)) };
}

function readRock(raw: unknown, i: number): TRock | null {
  const o = obj(raw);
  const title = text(o.title, 500);
  if (!title.trim()) return null;
  return { id: idOr(o.id, `r${i + 1}`), company: o.company === true, owner: text(o.owner, 120), quarter: text(o.quarter, 20), status: status(o.status), title, notes: text(o.notes, 4000), order: n(o.order) ?? i };
}

function readGoal(raw: unknown, i: number): TGoal | null {
  const o = obj(raw);
  const goalText = text(o.text, 1000);
  if (!goalText.trim()) return null;
  const checkins: Record<string, Checkin> = {};
  for (const [k, v] of Object.entries(obj(o.checkins))) {
    if (!/^\d{4}-Q[1-4]$/.test(k)) continue;
    const c = obj(v);
    checkins[k] = { status: status(c.status), note: text(c.note, 2000) };
  }
  return { id: idOr(o.id, `g${i + 1}`), year: yearOf(o.year), num: n(o.num), owner: text(o.owner, 120), text: goalText, notes: text(o.notes, 4000), status: status(o.status), checkins };
}

function readYearMeasurable(raw: unknown, i: number, year: number): YearMeasurable | null {
  const o = obj(raw);
  const label = text(o.label, 200);
  if (!label.trim()) return null;
  const q = obj(o.q);
  return { id: idOr(o.id, `y${year}-m${i + 1}`), label, baseline: text(o.baseline, 80), target: text(o.target, 80), q: { "1": text(q["1"], 80), "2": text(q["2"], 80), "3": text(q["3"], 80), "4": text(q["4"], 80) }, goal: n(o.goal), note: text(o.note, 1000) };
}

function readYear(raw: unknown): TYear | null {
  const o = obj(raw);
  const year = yearOf(o.year);
  if (year === null) return null;
  return { year, futureDate: text(o.futureDate, 40), revenue: text(o.revenue, 200), notes: text(o.notes, 4000), measurables: arr(o.measurables).flatMap((m, i) => readYearMeasurable(m, i, year) ?? []) };
}

const compRecord = (v: unknown): Record<Competency, number | null> => {
  const o = obj(v);
  return Object.fromEntries(COMPETENCIES.map((c) => [c, n(o[c])])) as Record<Competency, number | null>;
};

function readPulse(raw: unknown, i: number): TPulse | null {
  const o = obj(raw);
  const date = text(o.date, 20);
  return {
    id: idOr(o.id, `p${i + 1}`),
    date,
    overall: n(o.overall),
    notes: text(o.notes, 4000),
    scores: compRecord(o.scores),
    pcts: compRecord(o.pcts),
    behaviors: arr(o.behaviors).flatMap((b, j) => {
      const x = obj(b);
      const t = text(x.text, 500);
      if (!t.trim()) return [];
      return [{ id: idOr(x.id, `p${i + 1}-b${j + 1}`), comp: text(x.comp, 40), n: n(x.n), owners: text(x.owners, 300), score: n(x.score), text: t }];
    }),
  };
}

function readIssue(raw: unknown, i: number): TIssue | null {
  const o = obj(raw);
  const t = text(o.text, 1000);
  if (!t.trim()) return null;
  return { id: idOr(o.id, `i${i + 1}`), text: t, owner: text(o.owner, 120), quarter: text(o.quarter, 20), added: text(o.added, 20), status: o.status === "closed" ? "closed" : "open", notes: text(o.notes, 4000) };
}

function readThreeYear(raw: unknown): TrackerV2["plan"]["threeyear"] {
  const o = obj(raw);
  return {
    futureDate: text(o.futureDate, 40),
    revenue: text(o.revenue, 200),
    notes: text(o.notes, 4000),
    measurables: arr(o.measurables).flatMap((m, i) => {
      const x = obj(m);
      const label = text(x.label, 200);
      return label.trim() ? [{ id: idOr(x.id, `t${i + 1}`), label, baseline: text(x.baseline, 80), target: text(x.target, 80), actual: text(x.actual, 80), asOf: text(x.asOf, 20) }] : [];
    }),
    looksLike: arr(o.looksLike).flatMap((l, i) => {
      const x = obj(l);
      const t = text(x.text, 1000);
      return t.trim() ? [{ id: idOr(x.id, `l${i + 1}`), text: t, status: lookStatus(x.status) }] : [];
    }),
  };
}

function readReference(raw: unknown): TrackerV2["plan"]["reference"] {
  const o = obj(raw);
  const s = obj(o.swott);
  return {
    flywheels: arr(o.flywheels).flatMap((f, i) => {
      const x = obj(f);
      const stages = arr(x.stages).flatMap((st) => {
        const y = obj(st);
        const name = text(y.name, 120);
        return name.trim() ? [{ name, drivers: strList(y.drivers, 300) }] : [];
      });
      return text(x.brand).trim() || stages.length ? [{ id: idOr(x.id, `f${i + 1}`), brand: text(x.brand, 120), title: text(x.title, 200), stages }] : [];
    }),
    swott: { date: text(s.date, 40), subtitle: text(s.subtitle, 300), strengths: strList(s.strengths), weaknesses: strList(s.weaknesses), opportunities: strList(s.opportunities), threats: strList(s.threats), trends: strList(s.trends) },
    people: arr(o.people).flatMap((p, i) => {
      const x = obj(p);
      const name = text(x.name, 120);
      return name.trim() ? [{ id: idOr(x.id, `k${i + 1}`), name, cv: n(x.cv), perf: n(x.perf), pot: n(x.pot), ra: n(x.ra), note: text(x.note, 2000) }] : [];
    }),
    peopleDate: text(o.peopleDate, 40),
    peopleNote: text(o.peopleNote, 4000),
  };
}

const byOrder = <T extends { order: number }>(xs: T[]) => [...xs].sort((a, b) => a.order - b.order);

/** A v2 tracker from whatever is stored (or an export). Anything else (an empty or older document) reads as empty. */
export function readTrackerV2(raw: unknown): TrackerV2 {
  const o = obj(raw);
  const settings = obj(o.settings);
  const plan = obj(o.plan);
  const quarters = byOrder(arr(o.quarters).flatMap((q, i) => readQuarter(q, i) ?? []));
  return {
    schema: SCHEMA,
    settings: { currentQuarter: text(settings.currentQuarter, 20), year: yearOf(settings.year) },
    quarters,
    rocks: byOrder(arr(o.rocks).flatMap((r, i) => readRock(r, i) ?? [])),
    goals: arr(o.goals).flatMap((g, i) => readGoal(g, i) ?? []),
    years: arr(o.years)
      .flatMap((y) => readYear(y) ?? [])
      .sort((a, b) => a.year - b.year),
    teamhealth: arr(o.teamhealth).flatMap((p, i) => readPulse(p, i) ?? []),
    issues: arr(o.issues).flatMap((x, i) => readIssue(x, i) ?? []),
    plan: { threeyear: readThreeYear(plan.threeyear), reference: readReference(plan.reference) },
  };
}

export const emptyTracker = (): TrackerV2 => readTrackerV2({});

/** True when nothing has been entered or imported yet. */
export const isEmptyTracker = (d: TrackerV2) =>
  !d.quarters.length && !d.rocks.length && !d.goals.length && !d.years.length && !d.teamhealth.length && !d.issues.length && !d.plan.threeyear.measurables.length && !d.plan.threeyear.looksLike.length && !d.plan.reference.people.length && !d.plan.reference.flywheels.length;

/* ── The tracker app's own math, ported as it is ───────────────────────── */

/** The first number in a typed figure, with k / m suffixes: "$1.2M" → 1200000, "1,234" → 1234, "$987,654 YTD" → 987654. */
export function num(s: unknown): number | null {
  const t = text(s).replace(/,/g, "");
  const m = /(-?\d+(?:\.\d+)?)([kKmM]\b)?/.exec(t);
  if (!m) return null;
  const v = Number(m[1]);
  const suffix = m[2]?.toLowerCase();
  return suffix === "m" ? v * 1e6 : suffix === "k" ? v * 1e3 : v;
}

/** round(100 × a / t) when both are numbers and t is not 0. */
export function pctOf(a: unknown, t: unknown): number | null {
  const x = num(a);
  const y = num(t);
  return x === null || y === null || y === 0 ? null : Math.round((100 * x) / y);
}

/** The newest non-empty quarter reading: { n: 4..1, v: the typed value }. */
export function latestQ(m: Pick<YearMeasurable, "q">): { n: number; v: string } | null {
  for (const k of ["4", "3", "2", "1"] as const) {
    const v = m.q[k];
    if (v && v.trim()) return { n: Number(k), v };
  }
  return null;
}

/** Rocks done of all, in percent (0 when there are none). */
export function rockScore(list: Pick<TRock, "status">[]): { n: number; d: number; pct: number } {
  const d = list.filter((r) => r.status === "done").length;
  return { n: list.length, d, pct: list.length ? Math.round((100 * d) / list.length) : 0 };
}

/** "2026-10-27" → "10/27/26"; anything else as it is. */
export function fmtDate(d: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d ?? "");
  return m ? `${Number(m[2])}/${Number(m[3])}/${m[1].slice(2)}` : (d ?? "");
}

/** Shows a number the way a typed figure is written: "$" and "%" kept, k / M when the figure uses them. */
export function fmtLike(v: number, like: string): string {
  const dollar = /\$/.test(like);
  const pct = /%/.test(like);
  const big = /\d\s*[mM]\b/.test(like) ? "M" : /\d\s*[kK]\b/.test(like) ? "k" : "";
  const abs = Math.abs(v);
  let body: string;
  if (big === "M") body = `${(abs / 1e6).toFixed(abs >= 1e7 ? 1 : 2).replace(/\.?0+$/, "")}M`;
  else if (big === "k") body = `${(abs / 1e3).toFixed(1).replace(/\.0$/, "")}k`;
  else body = new Intl.NumberFormat("en-US", { maximumFractionDigits: pct ? 1 : 2 }).format(abs);
  return `${v < 0 ? "−" : ""}${dollar ? "$" : ""}${body}${pct ? "%" : ""}`;
}

/** Quarter ids for a year, oldest first. */
export const quarterIdsOf = (year: number) => QKEYS.map((k) => `${year}-Q${k}`);

/** The quarter to show first: the settings' current quarter, else the newest quarter, else today's. */
export function defaultQuarter(d: TrackerV2, today: string): string {
  if (d.settings.currentQuarter && d.quarters.some((q) => q.id === d.settings.currentQuarter)) return d.settings.currentQuarter;
  if (d.quarters.length) return [...d.quarters].sort((a, b) => b.id.localeCompare(a.id))[0].id;
  const [y, m] = today.split("-").map(Number);
  return `${y}-Q${Math.floor((m - 1) / 3) + 1}`;
}

/** The year to show first: the settings' year, else the year of the current quarter, else the newest year. */
export function defaultYear(d: TrackerV2, today: string): number {
  if (d.settings.year) return d.settings.year;
  const q = defaultQuarter(d, today);
  const y = Number(q.slice(0, 4));
  if (d.years.some((x) => x.year === y) || !d.years.length) return y;
  return d.years[d.years.length - 1].year;
}

/** Rocks of a quarter: company rocks first, then each owner's (owners alphabetically), each group by its order. */
export function rockGroups(rocks: TRock[], quarter: string): { key: string; title: string; company: boolean; rocks: TRock[] }[] {
  const mine = rocks.filter((r) => r.quarter === quarter);
  const company = byOrder(mine.filter((r) => r.company));
  const owners = [...new Set(mine.filter((r) => !r.company).map((r) => r.owner.trim() || "Not assigned"))].sort((a, b) => a.localeCompare(b));
  return [
    ...(company.length ? [{ key: "company", title: "Company Rocks", company: true, rocks: company }] : []),
    ...owners.map((o) => ({ key: `owner:${o}`, title: o, company: false, rocks: byOrder(mine.filter((r) => !r.company && (r.owner.trim() || "Not assigned") === o)) })),
  ];
}

/** Rock completion per quarter (newest first), for trend tiles. */
export const rockTrend = (d: TrackerV2) =>
  [...d.quarters].sort((a, b) => b.id.localeCompare(a.id)).map((q) => ({ quarter: q, ...rockScore(d.rocks.filter((r) => r.quarter === q.id)), company: rockScore(d.rocks.filter((r) => r.quarter === q.id && r.company)) }));

/* ── Pace (computed; not in the tracker app, shown as an extra column like its printed report) ── */

export type PaceKind = "ahead" | "on" | "behind";
export interface PaceV2 {
  status: PaceKind;
  /** Percentage points ahead (+) or behind (−) of the share of the year passed. */
  pts: number;
  label: string;
}

/**
 * How far along the year's target the latest quarter is, against the share of the year passed at that quarter's end
 * (Q1 = 25%, … Q4 = 100%). A year-to-date reading ("YTD" / "year to date") counts from zero; any other reading counts
 * from the baseline toward the target. Within ±5 points is "On pace".
 */
export function paceOf(m: Pick<YearMeasurable, "q" | "baseline" | "target">): PaceV2 | null {
  const l = latestQ(m);
  const t = num(m.target);
  if (!l || t === null) return null;
  const v = num(l.v);
  if (v === null) return null;
  const expected = l.n / 4;
  const ytd = /\bytd\b|year to date/i.test(l.v);
  let progress: number;
  if (ytd) {
    if (t === 0) return null;
    progress = v / t;
  } else {
    const b = num(m.baseline);
    if (b === null || t === b) return null;
    progress = (v - b) / (t - b);
  }
  const pts = Math.round((progress - expected) * 100);
  const status: PaceKind = pts >= 5 ? "ahead" : pts <= -5 ? "behind" : "on";
  return { status, pts, label: status === "on" ? "On pace" : status === "ahead" ? `Ahead by ${pts} pts` : `Behind by ${-pts} pts` };
}

/* ── 3-year glide path (the tracker app's rule) ─────────────────────────── */

export interface GlideRow {
  m: PlanMeasurable;
  /** Waypoints for the three years after the start year. */
  waypoints: { year: number; value: number }[];
  /** This year's waypoint, or null when this year is outside the path. */
  need: number | null;
  verdict: string;
  kind: "ytd" | "on" | "ahead" | "behind" | "none";
}

/** The end year from the 3-year picture's future date (first 4-digit year), else this year + 2. */
export function glideYears(futureDate: string, currentYear: number): { startY: number; endY: number; years: number[] } {
  const m = /(\d{4})/.exec(futureDate ?? "");
  const endY = m ? Number(m[1]) : currentYear + 2;
  const startY = endY - 3;
  return { startY, endY, years: [startY + 1, startY + 2, startY + 3] };
}

export function glideRow(m: PlanMeasurable, futureDate: string, currentYear: number): GlideRow {
  const { years } = glideYears(futureDate, currentYear);
  const b = num(m.baseline);
  const t = num(m.target);
  const a = num(m.actual);
  const waypoints = b === null || t === null ? [] : years.map((year, i) => ({ year, value: b + ((t - b) * (i + 1)) / 3 }));
  const need = waypoints.find((w) => w.year === currentYear)?.value ?? null;
  if (/ytd|year to date/i.test(m.actual)) return { m, waypoints, need, verdict: "year-to-date, judge at year end", kind: "ytd" };
  if (need === null || a === null) return { m, waypoints, need, verdict: "", kind: "none" };
  const d = a - need;
  const tol = Math.abs(need) * 0.02;
  if (Math.abs(d) <= tol) return { m, waypoints, need, verdict: "on the path", kind: "on" };
  return d >= 0 ? { m, waypoints, need, verdict: `ahead by ${fmtLike(d, m.target)}`, kind: "ahead" } : { m, waypoints, need, verdict: `behind by ${fmtLike(-d, m.target)}`, kind: "behind" };
}
