import { PRODUCTION_SALONS } from "@/data/salons";
import { OFFICIAL_POLICY_MANUAL } from "@/lib/forms/official-policy-manual";
import { REPORT_FAMILIES } from "@/lib/reporting/read/report-families";
import { DAILY_STATS_REPORT_NAMES } from "./daily-stats-gate";

/**
 * A state abbreviation or the policy manual's own title, read from the roster
 * and the manual — never a list of words kept here.
 */

const TITLE_WORDS = new Set(
  OFFICIAL_POLICY_MANUAL.fallbackTitles.flatMap((title) =>
    title
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((word) => word.length > 0),
  ),
);

/** The whole candidate is a roster state's abbreviation: "NE", not "Mo Smith". */
export function isRosterStateName(name: string): boolean {
  const words = name.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length !== 1) return false;
  return PRODUCTION_SALONS.some((salon) => salon.state.toLowerCase() === words[0]);
}

/**
 * Every word is a word of the official manual's title: "JBA Manual",
 * "JBA Policy Manual". A single word is still somebody's name.
 */
export function isDocumentName(name: string): boolean {
  const words = name.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length < 2 || TITLE_WORDS.size === 0) return false;
  return words.every((word) => TITLE_WORDS.has(word));
}

/*
 * REPORT_NAME_NOT_A_PERSON_ENABLED (QA, live, 1 Nov 2026): "Show me the most
 * recent Daily Stats and what I need to focus on today." saved "Daily Stats"
 * as the conversation's employee. The app's own report names — the report
 * families' labels, a source report that is called a report ("Comp Report"),
 * and what managers call the daily report — read from the registry, never a
 * list kept here.
 */
function reportKey(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .filter((word, index, words) => !(index === words.length - 1 && words.length > 1 && /^reports?$/.test(word)))
    .join(" ");
}

const REPORT_NAMES = new Set(
  [
    ...REPORT_FAMILIES.map((family) => family.label),
    ...REPORT_FAMILIES.map((family) => family.sourceReport).filter((source) => /^[A-Z][\w ]*\bReport$/.test(source)),
    ...DAILY_STATS_REPORT_NAMES,
  ]
    .map(reportKey)
    .filter(Boolean),
);

/** The whole candidate is one of the app's report names: "Daily Stats", "Sales Totals report". */
export function isReportName(name: string): boolean {
  const key = reportKey(name);
  return key !== "" && REPORT_NAMES.has(key);
}
