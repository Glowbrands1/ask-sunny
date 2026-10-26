import { formDateIncidentOnlyEnabled, lateOpenDateEnabled } from "@/lib/config/chat-quality-flags";

import { listIncidentDates } from "./form-date-answer";
import { incidentOnly } from "./form-date-incident-only";

/**
 * ============================================================================
 * A LATE OPENING, AND THE DATE IT HAPPENED (QA, 24 OCT 2026)
 * ============================================================================
 *
 * "late to open 10-19, verbal, no payroll" came back with no date and the
 * Attendance section. Two readers missed it:
 *
 *   THE DATE. The shared date reader needs a year on a dashed date, because
 *   "10-12" alone is more often a range ("10-12 hours"). After a date cue —
 *   "on", "dated", "the date is / to", "change … to", "late to open" — a
 *   yearless "10-19" is a month and day. It is the most recent 19 October on
 *   or before today, never a future one.
 *
 *   THE POLICY. "late to open" is the manual's Late Opening section, as
 *   "late opening" and "opened late" already were. "Late for her shift" is
 *   still Attendance.
 *
 * Used by the callers only (`intent-slots.ts`, `intake-augment.ts`,
 * `official-policy-manual.ts`, `ca-policy.ts`, `form-card-slots.ts`), behind
 * LATE_OPEN_DATE_ENABLED. The protected date and payroll readers are not
 * changed. Pure and browser-safe.
 */

/** "late to open", "was late to open the salon". */
export const LATE_TO_OPEN = /\blate\s+to\s+open\b/i;

/**
 * An account that is also about a shift or an absence, which the Attendance
 * section governs whatever else happened.
 */
const ATTENDANCE_TOO =
  /\b(?:late\s+(?:to|for)\s+(?:(?:her|his|their|a|the|my|your)\s+)?shift|tardy|tardiness|absent|absence|absences|absenteeism|no[- ]call|no[- ]show|called\s+(?:out|off)|call[- ]?off|missed\s+(?:her|his|their|a|the)\s+shift|left\s+early|leaving\s+early|clocked\s+out\s+early)\b/i;

/** Whether the account describes something the Attendance section governs beside a late opening. */
export function describesAttendanceToo(text: string): boolean {
  return ATTENDANCE_TOO.test(text ?? "");
}

/** A month-day with no year, not part of a longer date or number. "10-19", not "10-19-26". */
const YEARLESS_DASHED = /(?<![\d/.-])(\d{1,2})-(\d{1,2})(?![\d/-]|\.\d)/g;

/** Words just before the date that make it one. */
const DATE_CUE_BEFORE = new RegExp(
  String.raw`(?:\bon|\bdated?|\bdate\s+(?:is|was|to|as|of|should\s+be|will\s+be)|\bchange(?:d)?\b[^.\n]{0,40}?\bto|\bmake\s+(?:it|the\s+date)|\blate\s+to\s+open(?:\s+(?:the\s+)?(?:salon|store|location|shop))?|\blate[- ]open(?:ing|ed)?|\bopen(?:ed|ing)?(?:\s+(?:the\s+)?(?:salon|store|location|shop))?\s+late)\s*[:,]?\s*$`,
  "i",
);

/** Words just after it that make it a range: "10-12 hours", "5-10 min". */
const RANGE_AFTER = /^\s*(?:min|mins|minutes|hrs?|hours?|days?|weeks?|months?|years?|people|times|x\b|%|am\b|pm\b|dollars?)/i;

function isoOf(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1) return null;
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day > days) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** The most recent `month`-`day` on or before `today`. */
export function mostRecent(month: number, day: number, today: string): string | null {
  const year = Number(/^(\d{4})-/.exec(today)?.[1]);
  if (!Number.isFinite(year)) return null;
  const thisYear = isoOf(year, month, day);
  if (thisYear && thisYear <= today) return thisYear;
  return isoOf(year - 1, month, day);
}

export interface YearlessDate {
  readonly iso: string;
  readonly index: number;
  readonly end: number;
}

/** Every yearless dashed month-day in the text that follows a date cue, in order. */
export function yearlessCuedDates(text: string, today: string): YearlessDate[] {
  const found: YearlessDate[] = [];
  const source = text ?? "";
  for (const match of source.matchAll(YEARLESS_DASHED)) {
    const index = match.index ?? 0;
    const end = index + match[0].length;
    /*
     * FORM_DATE_INCIDENT_ONLY_ENABLED (QA, 26 Oct 2026, conv_mvolz9vk2cwijs1):
     * "late on 10-5 and 10-15" — the second date continues the cued list and
     * is a date too, or the form took the first one alone.
     */
    const previous = found[found.length - 1];
    const continuesList =
      formDateIncidentOnlyEnabled() &&
      previous !== undefined &&
      index - previous.end <= 8 &&
      /^\s*(?:,|and|&|or|,\s*and)\s*$/i.test(source.slice(previous.end, index));
    if (!continuesList && !DATE_CUE_BEFORE.test(source.slice(Math.max(0, index - 60), index))) continue;
    if (RANGE_AFTER.test(source.slice(end, end + 12))) continue;
    const iso = mostRecent(Number(match[1]), Number(match[2]), today);
    if (iso) found.push({ iso, index, end });
  }
  return found;
}

function slashed(iso: string): string {
  const [year, month, day] = iso.split("-");
  return `${Number(month)}/${Number(day)}/${year}`;
}

/** The same text with each cued yearless "10-19" written "10/19/2026", a shape the date readers accept. */
export function withYearlessDatesWritten(text: string, today: string): string {
  const dates = yearlessCuedDates(text, today);
  if (dates.length === 0) return text;
  let out = "";
  let at = 0;
  for (const date of dates) {
    out += text.slice(at, date.index) + slashed(date.iso);
    at = date.end;
  }
  return out + text.slice(at);
}

/**
 * The one incident date THIS turn states, yearless ones included, or null.
 * The newest date the manager gives dates the form ahead of one saved from
 * an earlier turn: "change the date to 10-22" after "late to open 10-19".
 * `read` is the caller's own reader of the turn's dates.
 */
export function newestStatedDate(
  question: string,
  today: string,
  read: (text: string, today: string) => string | null = singleIncidentDate,
): string | null {
  return read(withYearlessDatesWritten(question, today), today);
}

function singleIncidentDate(text: string, today: string): string | null {
  const dates = [...new Set(incidentOnly(text, today, listIncidentDates(text, today)).map((found) => found.iso))];
  return dates.length === 1 ? dates[0]! : null;
}

/** Whether LATE_OPEN_DATE_ENABLED is on. One import for the callers. */
export function lateOpenOn(): boolean {
  return lateOpenDateEnabled();
}
