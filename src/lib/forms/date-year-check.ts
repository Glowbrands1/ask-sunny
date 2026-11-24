import { EXIT_DATE_FIELDS, EXIT_DETAIL_FIELDS } from "./exit-library";

/**
 * ============================================================================
 * "CHECK THE YEAR" BEFORE FINALIZE (QA2, 21 Nov 2026; a real manager's exit form)
 * ============================================================================
 *
 * The exit form 77e3fe8f… was finalized with "Date that notice was given" 2020-11-20 beside a form dated 2026-11-20,
 * entered by hand on the page. Before Finalize, each of the exit form's date lines whose date is more than a year
 * (366 days) from the form's own date is named, so the page can say "Check the year". A warning, never a block: the
 * manager may finalize as it stands. Read from the form's keys (a record), never from words. Pure.
 */

const CHECKED = new Set<string>([EXIT_DATE_FIELDS.lastDayWorked, EXIT_DATE_FIELDS.noticeGiven, EXIT_DATE_FIELDS.noticeFulfilled, EXIT_DETAIL_FIELDS.resignationDate]);
const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY = 86_400_000;
const LIMIT_DAYS = 366;

function dayOf(iso: string | null | undefined): number | null {
  const match = ISO.exec((iso ?? "").trim());
  if (!match) return null;
  const time = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(time) ? null : time / DAY;
}

export interface YearCheckWarning {
  key: string;
  label: string;
  value: string;
}

/** The exit date lines (in the form's order) whose year looks wrong against the form's date; none without one. */
export function yearCheckWarnings(
  fields: readonly { key: string; label: string }[],
  values: Readonly<Record<string, string | null | undefined>>,
  formDate: string | null | undefined,
): YearCheckWarning[] {
  const anchor = dayOf(formDate);
  if (anchor === null) return [];
  return fields.flatMap((field) => {
    if (!CHECKED.has(field.key)) return [];
    const value = (values[field.key] ?? "").trim();
    const day = dayOf(value);
    return day !== null && Math.abs(day - anchor) > LIMIT_DAYS ? [{ key: field.key, label: field.label, value }] : [];
  });
}
