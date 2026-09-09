import { daysBetween } from "@/lib/business-date";
import {
  REPORT_PERIOD_TYPE_LABEL,
  type ReportFamily,
} from "./report-families";
import type { CatalogPeriod } from "./report-catalog";

/**
 * ============================================================================
 * "TODAY" IS NOT A PERIOD ANY REPORT DELIVERS
 * ============================================================================
 *
 * A manager asks "how are we doing today?" every morning. None of the five
 * sources can answer that. Sales Totals arrives overnight and covers YESTERDAY;
 * the Comp Report covers the month through the day it was run; the bed and spa
 * reports cover a month that has usually already ended.
 *
 * So the honest answer names the day it actually has. Before this module the
 * briefing carried each section's period, which is necessary but not
 * sufficient: a model handed "report date 2026-09-03" and told "today is
 * 2026-09-09" has everything it needs to notice the gap and no instruction to
 * mention it, and the reliable outcome is an answer that reads as live.
 *
 * PURE. Dates in, sentences out. It computes no figure and reads no database,
 * so what it says about staleness is testable without one.
 *
 * ============================================================================
 * THE TWO DATES ARE DIFFERENT FACTS AND BOTH MATTER
 * ============================================================================
 *
 *   AS OF   the last day the FIGURES cover. This is what a manager means by
 *           "how current is this".
 *
 *   LOADED  when the delivery was ingested. This is what an operator means.
 *           A report covering August that only arrived last night is current
 *           data about a stale period; one covering yesterday that arrived a
 *           week ago means ingestion has stopped.
 *
 * Both travel. Reporting only the first would hide a broken pipeline; only the
 * second would let a week-old month read as fresh because it loaded this
 * morning.
 */

/** How stale a family's newest figures are, against the day being asked about. */
export type FreshnessLevel =
  /** The newest figures cover the day in question. */
  | "current"
  /** One or two days behind — the ordinary state of an overnight delivery. */
  | "one_day_behind"
  /** Within the same month, but several days back. */
  | "days_behind"
  /** A month or more behind. */
  | "months_behind"
  /** Nothing is ingested for this family. */
  | "absent";

export interface FamilyFreshness {
  readonly familyId: ReportFamily["id"];
  readonly familyLabel: string;
  readonly level: FreshnessLevel;
  /** Last day the figures cover, or null when nothing is ingested. */
  readonly asOf: string | null;
  /** Whole days between `asOf` and the day asked about. Null when absent. */
  readonly daysBehind: number | null;
  /** ISO instant the delivery was ingested, when recorded. */
  readonly ingestedAt: string | null;
  /** Which window the newest period is. */
  readonly periodLabel: string | null;
  /** One sentence, safe to put in a prompt or show a manager. */
  readonly sentence: string;
}

function levelFor(daysBehind: number): FreshnessLevel {
  if (daysBehind <= 0) return "current";
  if (daysBehind <= 2) return "one_day_behind";
  if (daysBehind <= 31) return "days_behind";
  return "months_behind";
}

/**
 * How current one family's newest delivery is.
 *
 * NEITHER THE CLOCK NOR THE ZONE IS READ HERE. Both would be wrong to hardcode:
 * `utils/date.ts` holds `DEMO_ANCHOR`, a frozen date the prototype measured
 * everything against, and a freshness check that consulted it would report
 * every report as current forever; and the UTC date rolls over five hours
 * before the US Eastern one, which would make every report look a day staler
 * than it is through every evening. So the caller passes the business date, and
 * `/api/chat` gets it from the one module that knows the zone.
 */
export function familyFreshness(input: {
  readonly family: ReportFamily;
  readonly latest: CatalogPeriod | null;
  /**
   * The BUSINESS date the question is being asked about, ISO `yyyy-mm-dd`.
   *
   * Supplied by the caller, never read from a module constant here — the same
   * rule the whole reporting read path follows. `/api/chat` fills it from
   * `businessToday()`, which is the app's one answer to what day it is; a
   * freshness check that reached for the UTC date instead would report a report
   * covering yesterday as two days behind for the whole of every US evening.
   */
  readonly today: string;
}): FamilyFreshness {
  const { family, latest, today } = input;

  if (!latest) {
    return {
      familyId: family.id,
      familyLabel: family.label,
      level: "absent",
      asOf: null,
      daysBehind: null,
      ingestedAt: null,
      periodLabel: null,
      sentence: `${family.label}: no delivery ingested. The ${family.sourceReport} would carry it.`,
    };
  }

  /*
   * `daysBetween` from `lib/business-date`, not a local copy. Both sides are
   * already calendar dates in the business zone by the time they reach here —
   * one from `businessToday`, the other a period label the workbook wrote that
   * carries no zone at all — so this is whole days with no daylight-saving
   * arithmetic to get wrong. A second implementation of it here was the start
   * of a second opinion about how far apart two days are.
   */
  const daysBehind = daysBetween(latest.end, today);
  const level = levelFor(daysBehind);
  const window = REPORT_PERIOD_TYPE_LABEL[latest.type];
  const loaded = latest.ingestedAt ? `, loaded ${latest.ingestedAt}` : "";

  const lag =
    level === "current"
      ? "which is the day being asked about"
      : daysBehind === 1
        ? "one day before the day being asked about"
        : `${daysBehind} days before the day being asked about`;

  return {
    familyId: family.id,
    familyLabel: family.label,
    level,
    asOf: latest.end,
    daysBehind,
    ingestedAt: latest.ingestedAt,
    periodLabel: latest.label,
    sentence: `${family.label}: newest figures cover ${window} through ${latest.end} — ${lag}${loaded}.`,
  };
}

/**
 * The instruction that travels when any requested family is behind.
 *
 * WHY IT IS AN INSTRUCTION AND NOT JUST DATA. The dates alone are not enough:
 * "today is the 9th" beside "report date the 3rd" is a gap the model can see
 * and has no reason to volunteer, and "how are we doing today?" invites a
 * present-tense answer. This says to name the as-of date before answering.
 *
 * IT IS NOT A REFUSAL. Six-day-old figures are the ordinary, useful state of an
 * overnight report and a manager acts on them every morning. What must not
 * happen is an answer that reads as live.
 */
export const FRESHNESS_RULE = `HOW CURRENT THIS DATA IS

- NO REPORT HERE COVERS TODAY. Each family's newest figures and the day they run through are listed above. Name the as-of date the first time you quote a figure — "through the 3rd", "August month to date" — and never write or imply that a figure describes today, right now, or this moment.
- If the manager asked about today and the newest figures stop earlier, say so in your first sentence before answering from what you do have. Do not project forward to today, and do not apologise at length — one clause is enough.
- The as-of date and the loaded timestamp are different facts. A report covering last month that loaded last night is current data about a finished period; one covering yesterday that loaded a week ago means deliveries have stopped. If a family's figures are more than a few days behind what its delivery schedule implies, say that the delivery may not have arrived rather than treating the gap as a business result.
- Never compare a figure from one family's as-of date with another family's unless both cover the same window. The five reports arrive on their own schedules.`;

/**
 * The freshness block for a briefing, or null when nothing is worth saying.
 *
 * Null when every requested family is absent — the no-data rule already names
 * those, and a freshness block that only repeats "no delivery" is noise.
 */
export function buildFreshnessBlock(
  entries: readonly FamilyFreshness[],
): string | null {
  const withData = entries.filter((entry) => entry.level !== "absent");
  if (withData.length === 0) return null;

  const behind = withData.some((entry) => entry.level !== "current");

  return [
    "DATA FRESHNESS",
    "",
    ...withData.map((entry) => `  ${entry.sentence}`),
    "",
    behind
      ? FRESHNESS_RULE
      : "Every report above covers the day being asked about. Still name the period each figure belongs to.",
  ].join("\n");
}
