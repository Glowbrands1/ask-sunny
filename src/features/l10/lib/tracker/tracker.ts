// Copied from the Leadership Hub (src/lib/tracker/tracker.ts); keep in step with it. See src/features/l10/README.md.
import type { Rock } from "@/features/l10/lib/types";

/**
 * The company tracker document (l10.tracker_state, one versioned JSON document). Only what has to be typed is
 * stored: each measurable's settings and its quarterly actuals. Everything else (% of goal, the pace chip, rock
 * completion by quarter) is computed here, so nothing is typed twice. Years are fields, never hard-coded.
 *
 * CSV shape for a later import (docs/tracker-csv.md): one row per measurable, the same field names in snake_case.
 */

export const UNITS = ["number", "currency", "percent"] as const;
export type Unit = (typeof UNITS)[number];

/** "ytd": adds up over the year (revenue, transactions). "level": a count at a point in time (salons, members). */
export const KINDS = ["ytd", "level"] as const;
export type Kind = (typeof KINDS)[number];

export const QUARTERS = ["Q1", "Q2", "Q3", "Q4"] as const;
export type Quarter = (typeof QUARTERS)[number];

export interface Actual {
  value: number | null;
  /** YYYY-MM-DD: the date the value was true on. */
  asOf: string;
}

export interface Measurable {
  id: string;
  name: string;
  unit: Unit;
  kind: Kind;
  higherIsBetter: boolean;
  baselineYear: number | null;
  baseline: number | null;
  /** The year the annual target and the quarterly actuals belong to. */
  year: number | null;
  annualTarget: number | null;
  longTargetYear: number | null;
  longTarget: number | null;
  footnote: string;
  archived: boolean;
  actuals: Partial<Record<Quarter, Actual>>;
}

export const COMPETENCIES = ["trust", "conflict", "commitment", "accountability", "results"] as const;
export type Competency = (typeof COMPETENCIES)[number];
export const COMPETENCY_LABEL: Record<Competency, string> = { trust: "Trust", conflict: "Conflict", commitment: "Commitment", accountability: "Accountability", results: "Results" };
/** Pulse scores are on a 1 to 5 scale. */
export const PULSE_MAX = 5;

export interface Behavior {
  id: string;
  text: string;
  score: number | null;
  owner: string;
  note: string;
}

/** One Team Health pulse: the five competencies' scores on one date, the lowest-scoring behaviors, and notes. */
export interface Pulse {
  id: string;
  /** YYYY-MM-DD */
  date: string;
  scores: Record<Competency, number | null>;
  behaviors: Behavior[];
  facilitatorNotes: string;
}

export interface TrackerDoc {
  measurables: Measurable[];
  pulses: Pulse[];
  /** The share of rocks that should be done each quarter, in percent. */
  rockStandardPct: number;
  [extra: string]: unknown;
}

export interface LoadedTracker {
  version: number;
  updatedAt: string | null;
  doc: Record<string, unknown>;
}

export const DEFAULT_ROCK_STANDARD = 80;

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const int = (v: unknown): number | null => (typeof v === "number" && Number.isInteger(v) && v > 1900 && v < 3000 ? v : null);
const str = (v: unknown, max = 500): string => (typeof v === "string" ? v.slice(0, max) : "");
export const isDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));

function readMeasurable(raw: unknown, i: number): Measurable | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const actuals: Partial<Record<Quarter, Actual>> = {};
  const a = o.actuals && typeof o.actuals === "object" ? (o.actuals as Record<string, unknown>) : {};
  for (const q of QUARTERS) {
    const v = a[q] as { value?: unknown; asOf?: unknown } | undefined;
    if (v && typeof v === "object" && (num(v.value) !== null || isDate(v.asOf))) actuals[q] = { value: num(v.value), asOf: isDate(v.asOf) ? v.asOf : "" };
  }
  return {
    id: str(o.id, 64) || `m${i + 1}`,
    name: str(o.name, 200),
    unit: UNITS.includes(o.unit as Unit) ? (o.unit as Unit) : "number",
    kind: KINDS.includes(o.kind as Kind) ? (o.kind as Kind) : "level",
    higherIsBetter: o.higherIsBetter !== false,
    baselineYear: int(o.baselineYear),
    baseline: num(o.baseline),
    year: int(o.year),
    annualTarget: num(o.annualTarget),
    longTargetYear: int(o.longTargetYear),
    longTarget: num(o.longTarget),
    footnote: str(o.footnote, 1000),
    archived: o.archived === true,
    actuals,
  };
}

const score = (v: unknown): number | null => {
  const n = num(v);
  return n !== null && n >= 1 && n <= PULSE_MAX ? n : null;
};

function readPulse(raw: unknown, i: number): Pulse | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const sc = o.scores && typeof o.scores === "object" ? (o.scores as Record<string, unknown>) : {};
  const list = Array.isArray(o.behaviors) ? o.behaviors : [];
  return {
    id: str(o.id, 64) || `p${i + 1}`,
    date: isDate(o.date) ? o.date : "",
    scores: Object.fromEntries(COMPETENCIES.map((c) => [c, score(sc[c])])) as Record<Competency, number | null>,
    behaviors: list.flatMap((b, j) => {
      if (!b || typeof b !== "object") return [];
      const x = b as Record<string, unknown>;
      return [{ id: str(x.id, 64) || `b${j + 1}`, text: str(x.text, 300), score: score(x.score), owner: str(x.owner, 120), note: str(x.note, 1000) }];
    }),
    facilitatorNotes: str(o.facilitatorNotes, 4000),
  };
}

/** A tracker document from whatever the database holds; unknown fields are kept, bad ones are dropped. */
export function readTracker(raw: unknown): TrackerDoc {
  const o = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const list = Array.isArray(o.measurables) ? o.measurables : [];
  const pulses = Array.isArray(o.pulses) ? o.pulses : [];
  const pct = num(o.rockStandardPct);
  return {
    ...o,
    measurables: list.map(readMeasurable).filter((m): m is Measurable => m !== null),
    pulses: pulses.map(readPulse).filter((p): p is Pulse => p !== null),
    rockStandardPct: pct !== null && pct > 0 && pct <= 100 ? pct : DEFAULT_ROCK_STANDARD,
  };
}

export function newMeasurable(id: string, year: number): Measurable {
  return { id, name: "", unit: "number", kind: "level", higherIsBetter: true, baselineYear: year - 1, baseline: null, year, annualTarget: null, longTargetYear: year + 2, longTarget: null, footnote: "", archived: false, actuals: {} };
}

/* ── Numbers ──────────────────────────────────────────────────────────── */

/** "$1,250", "12.5%", "1,250". Blank for no value. */
export function formatMeasure(v: number | null, unit: Unit): string {
  if (v === null) return "";
  const n = new Intl.NumberFormat("en-US", { maximumFractionDigits: unit === "number" ? 2 : 1 }).format(Math.abs(v));
  const sign = v < 0 ? "−" : "";
  return unit === "currency" ? `${sign}$${n}` : unit === "percent" ? `${sign}${n}%` : `${sign}${n}`;
}

/** The latest quarter with a value. */
export function latestActual(m: Measurable): ({ quarter: Quarter } & Actual & { value: number }) | null {
  for (const q of [...QUARTERS].reverse()) {
    const a = m.actuals[q];
    if (a && a.value !== null) return { quarter: q, value: a.value, asOf: a.asOf };
  }
  return null;
}

/** How much of `year` has passed on `asOf` (0..1). Null without a usable date. */
export function yearShare(asOf: string, year: number | null): number | null {
  if (!isDate(asOf) || year === null) return null;
  const start = Date.UTC(year, 0, 1);
  const end = Date.UTC(year + 1, 0, 1);
  const t = Date.parse(`${asOf}T00:00:00Z`) + 86_400_000; // the as-of day counts as passed
  return Math.min(1, Math.max(0, (t - start) / (end - start)));
}

/**
 * % of goal for the latest actual: actual / target (target / actual when lower is better). Null when either is
 * missing or the division makes no sense.
 */
export function pctOfGoal(m: Measurable): number | null {
  const a = latestActual(m);
  if (!a || m.annualTarget === null) return null;
  if (m.higherIsBetter) return m.annualTarget === 0 ? null : a.value / m.annualTarget;
  return a.value === 0 ? null : m.annualTarget / a.value;
}

export type PaceStatus = "ahead" | "on" | "behind";
export const PACE_TOLERANCE = 0.05;
export const PACE_LABEL: Record<PaceStatus, string> = { ahead: "Ahead of pace", on: "On pace", behind: "Behind pace" };

/**
 * The pace chip: how far along the year's goal the latest actual is, against how much of the year has passed.
 *  - ytd: progress = actual / target (for lower-is-better, being under the year's share is good).
 *  - level: progress = (actual − baseline) / (target − baseline), the share of the way from the baseline to the
 *    target (works in either direction). Needs a baseline.
 * Within ±5 points of the year's share is "on pace".
 */
export function pace(m: Measurable): { status: PaceStatus; progress: number; expected: number } | null {
  const a = latestActual(m);
  if (!a || m.annualTarget === null) return null;
  const expected = yearShare(a.asOf, m.year);
  if (expected === null) return null;
  let progress: number;
  let diff: number;
  if (m.kind === "ytd") {
    if (m.annualTarget === 0) return null;
    progress = a.value / m.annualTarget;
    diff = m.higherIsBetter ? progress - expected : expected - progress;
  } else {
    if (m.baseline === null || m.annualTarget === m.baseline) return null;
    progress = (a.value - m.baseline) / (m.annualTarget - m.baseline);
    diff = progress - expected;
  }
  const status: PaceStatus = diff >= PACE_TOLERANCE ? "ahead" : diff <= -PACE_TOLERANCE ? "behind" : "on";
  return { status, progress, expected };
}

/* ── Rocks by quarter (computed from the Leadership meeting's rocks) ─── */

export interface RockQuarterRow {
  /** "2026-Q4", or "none" for rocks without a due date. */
  key: string;
  label: string;
  done: number;
  total: number;
  companyDone: number;
  companyTotal: number;
  /** done / total in percent, rounded. */
  pct: number;
  meetsStandard: boolean;
}

const quarterOf = (date: string) => {
  const [y, m] = date.split("-").map(Number);
  return { key: `${y}-Q${Math.floor((m - 1) / 3) + 1}`, label: `Q${Math.floor((m - 1) / 3) + 1} ${y}` };
};

/**
 * Rock completion per quarter, by each rock's due date. Archived rocks count too (they are last quarters' rocks).
 * Newest quarter first; rocks without a due date come last as "No due date".
 */
export function rocksByQuarter(rocks: Rock[], standardPct: number): RockQuarterRow[] {
  const rows = new Map<string, RockQuarterRow>();
  for (const r of Array.isArray(rocks) ? rocks : []) {
    if (!r || typeof r !== "object") continue;
    const q = isDate(r.dueDate) ? quarterOf(r.dueDate) : { key: "none", label: "No due date" };
    const row = rows.get(q.key) ?? { key: q.key, label: q.label, done: 0, total: 0, companyDone: 0, companyTotal: 0, pct: 0, meetsStandard: false };
    const done = r.status === "done";
    row.total += 1;
    if (done) row.done += 1;
    if (r.owner === "Company") {
      row.companyTotal += 1;
      if (done) row.companyDone += 1;
    }
    rows.set(q.key, row);
  }
  return [...rows.values()]
    .map((r) => ({ ...r, pct: r.total ? Math.round((r.done / r.total) * 100) : 0, meetsStandard: r.total > 0 && (r.done / r.total) * 100 >= standardPct }))
    .sort((a, b) => (a.key === "none" ? 1 : b.key === "none" ? -1 : b.key.localeCompare(a.key)));
}

/** True when the tracker has anything worth printing in the report. */
export const hasMeasurables = (doc: TrackerDoc) => doc.measurables.some((m) => !m.archived && m.name.trim());

/* ── 3-year glide path (computed from the baseline and the long-term target; nothing typed twice) ── */

export interface GlidePath {
  /** One waypoint per year after the baseline year, up to the long-term year: a straight line. */
  waypoints: { year: number; value: number }[];
  /** The latest actual and where the line says it should be on that as-of date. Null without a usable actual. */
  check: {
    quarter: Quarter;
    asOf: string;
    actual: number;
    expected: number;
    /** How far ahead (positive) or behind (negative) of the line, in the measurable's unit. */
    gap: number;
    onPath: boolean;
  } | null;
}

/**
 * The straight line from the baseline (baselineYear) to the long-term target (longTargetYear).
 *  - level: the line's value at the as-of date (between last year's and this year's waypoints).
 *  - ytd: this year's waypoint is a full-year total, so the line expects that share of it by the as-of date.
 * "On the path" when the actual is at or past the line (in the better direction).
 */
export function glidePath(m: Measurable): GlidePath | null {
  const { baselineYear: y0, baseline: b, longTargetYear: y1, longTarget: t } = m;
  if (y0 === null || b === null || y1 === null || t === null || y1 <= y0 || y1 - y0 > 20) return null;
  const at = (year: number) => b + ((t - b) * (year - y0)) / (y1 - y0);
  const waypoints = Array.from({ length: y1 - y0 }, (_, i) => ({ year: y0 + i + 1, value: at(y0 + i + 1) }));
  const a = latestActual(m);
  const share = a && m.year !== null ? yearShare(a.asOf, m.year) : null;
  if (!a || share === null || m.year === null || m.year <= y0 || m.year > y1) return { waypoints, check: null };
  const expected = m.kind === "ytd" ? at(m.year) * share : at(m.year - 1) + (at(m.year) - at(m.year - 1)) * share;
  const gap = m.higherIsBetter ? a.value - expected : expected - a.value;
  return { waypoints, check: { quarter: a.quarter, asOf: a.asOf, actual: a.value, expected, gap, onPath: gap >= 0 } };
}

/** "On the path", or "Behind by $120". */
export function glideLabel(g: NonNullable<GlidePath["check"]>, unit: Unit): string {
  return g.onPath ? "On the path" : `Behind by ${formatMeasure(Math.abs(g.gap), unit)}`;
}

/* ── Team Health ──────────────────────────────────────────────────────── */

export function newPulse(id: string, date: string): Pulse {
  return { id, date, scores: { trust: null, conflict: null, commitment: null, accountability: null, results: null }, behaviors: [], facilitatorNotes: "" };
}

/** Overall health in percent: the mean of the scored competencies over the 1-5 scale's top. Null with no scores. */
export function overallPct(p: Pulse): number | null {
  const v = COMPETENCIES.map((c) => p.scores[c]).filter((x): x is number => x !== null);
  return v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length / PULSE_MAX) * 100) : null;
}

/** Pulses newest first (undated last). */
export const pulsesByDate = (pulses: Pulse[]) => [...pulses].sort((a, b) => (!a.date ? 1 : !b.date ? -1 : b.date.localeCompare(a.date)));

export interface PulseSummary {
  pulse: Pulse;
  overall: number | null;
  /** Change in overall percentage points vs the previous pulse (null when either is missing). */
  overallChange: number | null;
  /** Change per competency vs the previous pulse, in score points. */
  changes: Record<Competency, number | null>;
  /** Behaviors with a score, lowest first. */
  lowest: Behavior[];
  previousDate: string | null;
}

/** The latest pulse with its change vs the one before, or null when there is none. */
export function latestPulse(pulses: Pulse[]): PulseSummary | null {
  const [cur, prev] = pulsesByDate(pulses);
  if (!cur) return null;
  const overall = overallPct(cur);
  const prevOverall = prev ? overallPct(prev) : null;
  const round1 = (n: number) => Math.round(n * 10) / 10;
  return {
    pulse: cur,
    overall,
    overallChange: overall !== null && prevOverall !== null ? overall - prevOverall : null,
    changes: Object.fromEntries(COMPETENCIES.map((c) => [c, prev && cur.scores[c] !== null && prev.scores[c] !== null ? round1(cur.scores[c]! - prev.scores[c]!) : null])) as Record<Competency, number | null>,
    lowest: cur.behaviors.filter((b) => b.score !== null && b.text.trim()).sort((a, b) => a.score! - b.score!),
    previousDate: prev?.date || null,
  };
}

/** "+0.3", "−0.2", "±0". */
export const signed = (n: number, suffix = "") => (n > 0 ? `+${n}${suffix}` : n < 0 ? `−${Math.abs(n)}${suffix}` : `±0${suffix}`);

