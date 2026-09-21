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
 * NAMING THE DAY IT HAS IS NOT THE SAME AS REPORTING THE DAY IT LACKS, and the
 * first version of this module conflated them. Both the sentence and the rule
 * below described the newest delivery by how far short of today it fell, which
 * is a true description of a healthy overnight pipeline and a terrible thing to
 * put at the top of every answer. They now lead with the delivery being used —
 * "the most recent delivery available, one day before the day being asked
 * about" — and `FRESHNESS_RULE` says to open with that date rather than with
 * its absence. The prohibition that matters is unchanged: yesterday's figures
 * are never described as today's.
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

  /*
   * THE LAG IS STATED AS A PROPERTY OF THE DELIVERY BEING USED, not as a
   * shortfall against a delivery that was expected and did not come.
   *
   * It read "one day before the day being asked about", which is true and was
   * the whole sentence a model had to work from. Handed that beside a question
   * whose own words said "today", the reliable outcome was an answer that
   * opened by reporting the absence — "there is no Daily Stats report for
   * today" — about a pipeline that was working exactly as designed. The
   * Sales Totals email covers yesterday every morning of its life; a manager
   * clicking a question about today was being told their reporting was broken.
   *
   * So the clause now leads with `the most recent delivery available`. The
   * arithmetic is unchanged and the day count is still stated — what changed is
   * that the sentence names the delivery as the one to answer from before it
   * says how far back it runs.
   */
  const lag =
    level === "current"
      ? "which is the day being asked about"
      : daysBehind === 1
        ? "the most recent delivery available, one day before the day being asked about"
        : `the most recent delivery available, ${daysBehind} days before the day being asked about`;

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
 * present-tense answer. This says which delivery to answer from, and to name
 * its date.
 *
 * ============================================================================
 * IT LEADS WITH THE DELIVERY IT HAS, NOT WITH THE ONE IT LACKS
 * ============================================================================
 *
 * This rule opened with "NO REPORT HERE COVERS TODAY" and then told the model
 * to say so in its first sentence whenever the manager asked about today. Both
 * sentences were true. Together, and beside a homepage question whose own words
 * were "what should I focus on in today's Daily Stats?", they produced the same
 * answer every morning: there is no report for today. A manager clicking the
 * one question the product put in front of them was told, daily, that their
 * reporting was missing — when the overnight delivery had landed on time and
 * covered exactly what it always covers.
 *
 * THE LAG WAS NEVER THE PROBLEM AND IS NOT A DEFECT. The Sales Totals email
 * covers yesterday by design; the Comp Report covers the month through the day
 * it was run; the bed and spa reports cover a month that has usually ended. No
 * delivery will ever be dated today, on any day, however healthy the pipeline.
 * An instruction that treats that standing fact as news is an instruction to
 * report a fault that does not exist.
 *
 * SO THE ORDER IS REVERSED. Name the delivery being used and its date, answer
 * the question from it, and keep the one thing that genuinely matters: never
 * call yesterday's figures today's. `report-briefing.ts` owns the separate
 * case — a family with NO delivery at all — and `NO_DATA_RULE` is what says
 * that data is unavailable. This rule never does, because every family it
 * describes has figures.
 *
 * IT IS NOT A REFUSAL. Six-day-old figures are the ordinary, useful state of an
 * overnight report and a manager acts on them every morning. What must not
 * happen is an answer that reads as live — or an answer that does not arrive
 * because the model spent it apologising.
 */
export const FRESHNESS_RULE = `HOW CURRENT THIS DATA IS

- ANSWER FROM THE MOST RECENT DELIVERY LISTED ABOVE, AND OPEN BY NAMING ITS DATE. For example: "Using the most recent Daily Stats from September 20, along with the current month-to-date Comp Report...". Then answer the question. The deliveries above ARE the data for this question.
- A DELIVERY THAT IS NOT DATED TODAY IS THE NORMAL STATE, NOT A PROBLEM. These reports arrive overnight, on delivery or monthly, and none of them ever covers the current day. Never say there is no report for today, never call the most recent delivery missing, late, unavailable or out of date, and never open with an apology. There is nothing here to apologise for.
- STILL NEVER CALL IT TODAY. Name the as-of date the first time you quote a figure — "through the 20th", "August month to date" — and never write or imply that a figure describes today, right now or this moment. Do not project a figure forward to today.
- DATA IS "UNAVAILABLE" ONLY WHERE A REPORT HAS NOTHING INGESTED AT ALL. Those reports are listed separately above under their own heading, and that is the only place to say you are missing something. Every report listed in THIS block has figures and is answerable, however many days back it runs.
- The as-of date and the loaded timestamp are different facts. A report covering last month that loaded last night is current data about a finished period; one covering yesterday that loaded a week ago means deliveries have stopped. If a family's figures are much further behind than its delivery schedule implies, note after your answer that the delivery may not have arrived — as a note, not instead of the answer, and never as a reason to withhold one.
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
