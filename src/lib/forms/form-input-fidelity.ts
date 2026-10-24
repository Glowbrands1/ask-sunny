import { formInputFidelityEnabled } from "@/lib/config/chat-quality-flags";
import { shiftDays, weekdayOf } from "@/lib/business-date";

import { extractFormDate } from "./form-date-answer";

/**
 * A date the manager typed, as the form's date.
 *
 * `extractFormDate` already reads "Oct 20" and "10/20". It does not read
 * "yesterday" or "last Tuesday" (`form-date-answer.ts`). The intake still
 * treats those words as a date that was given, and a missing form date is
 * stored as today when the draft is created. With the flag on, those
 * relative days resolve against the business day passed in. "today" stays
 * unresolved, so a form with no date is still dated the day it is created.
 * With the flag off this is `extractFormDate`.
 */

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;
const WEEKDAY = WEEKDAYS.join("|");

const NOT_THIS_INCIDENT =
  /\b(?:previous|prior|already|earlier|coached|coaching|warning|warned|write[- ]?ups?|written up|corrective action|was given|were given)\b/i;

const BARE_FOLLOW_UP = new RegExp(
  String.raw`^(?:a\s+)?(?:verbal|written|yes|no|yeah|yep|yup|nope|yesterday|today|tonight|${WEEKDAY})(?:\s+warning)?$`,
  "i",
);

const LAST_WEEKDAY = new RegExp(String.raw`^(?:last|this\s+past|past)\s+(${WEEKDAY})$`, "i");

const BARE_WEEKDAY = new RegExp(
  String.raw`^(?:\d+\s*[.)]\s*)?(?:(?:it\s+)?(?:was|happened(?:\s+on)?)\s+)?(?:on\s+)?(${WEEKDAY})[.!]?\s*$`,
  "i",
);

function tidy(value: string): string {
  return value
    .trim()
    .replace(/[.!?]+$/g, "")
    .replace(/^\d+\s*[.)]\s*/, "")
    .trim();
}

/** A reply that is a warning, a yes/no, a weekday, or a date — not a job title. */
export function isNonTitleFollowUp(value: string): boolean {
  const text = tidy(value);
  if (text === "") return false;
  if (BARE_FOLLOW_UP.test(text) || LAST_WEEKDAY.test(text)) return true;
  const dated = extractFormDate(text, "2026-06-15");
  if (!dated) return false;
  const rest = text
    .replace(/\b(?:\d{4}-\d{2}-\d{2}|\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?|(?:jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(?:st|nd|rd|th)?)\b/i, "")
    .replace(/[.,]/g, "")
    .trim();
  return rest === "";
}

/** The whole reply is a weekday and nothing else ("Monday", "on Monday"). */
export function isBareWeekdayReply(text: string): boolean {
  return BARE_WEEKDAY.test(tidy(text));
}

function clauseBefore(text: string, index: number): string {
  const before = text.slice(0, index);
  const start = before.search(/[^.;\n]*$/);
  return before.slice(start < 0 ? 0 : start);
}

function lastWeekday(today: string, name: string): string {
  const target = WEEKDAYS.indexOf(name.toLowerCase() as (typeof WEEKDAYS)[number]);
  const back = ((weekdayOf(today) - target + 7) % 7) || 7;
  return shiftDays(today, -back);
}

function recentWeekday(today: string, name: string): string {
  const target = WEEKDAYS.indexOf(name.toLowerCase() as (typeof WEEKDAYS)[number]);
  const back = (weekdayOf(today) - target + 7) % 7;
  return shiftDays(today, -back);
}

function relativeIncidentDates(text: string, today: string): string[] {
  const found: string[] = [];
  const take = (index: number, iso: string) => {
    if (NOT_THIS_INCIDENT.test(clauseBefore(text, index))) return;
    found.push(iso);
  };
  for (const match of text.matchAll(/\byesterday\b/gi)) take(match.index ?? 0, shiftDays(today, -1));
  for (const match of text.matchAll(new RegExp(String.raw`\b(?:last|this past|past)\s+(${WEEKDAY})\b`, "gi"))) {
    take(match.index ?? 0, lastWeekday(today, match[1]!));
  }
  return [...new Set(found)];
}

/**
 * The incident date to store, or null when the manager did not give one.
 * Null still means the draft is dated the day it is created.
 */
export function resolveStatedFormDate(text: string, today: string): string | null {
  const calendar = extractFormDate(text, today);
  if (!formInputFidelityEnabled()) return calendar;
  if (calendar) return calendar;
  const relative = relativeIncidentDates(text, today);
  if (relative.length === 1) return relative[0]!;
  if (relative.length > 1) return null;
  const bare = BARE_WEEKDAY.exec(tidy(text));
  return bare ? recentWeekday(today, bare[1]!) : null;
}

/**
 * The assistant message is one question about the job title.
 * A numbered intake that also lists the title is not that question:
 * the title line is on the list even when the reply answers another line.
 */
export function askedOnlyForJobTitle(assistant: string): boolean {
  const text = assistant ?? "";
  if ((text.match(/^\s*\d+\.\s+/gm) ?? []).length >= 2) return false;
  if (!/\bjob title\b/i.test(text)) return false;
  return !/\b(?:verbal or written|date of the incident|date for the form|date of occurrence|payroll deduct)\b/i.test(text);
}

/** The assistant message is one question about the incident date. */
export function askedForIncidentDate(assistant: string): boolean {
  const text = assistant ?? "";
  if ((text.match(/^\s*\d+\.\s+/gm) ?? []).length >= 2) return false;
  return /\b(?:date of the incident|date for the form|date of occurrence|what date|which date)\b/i.test(text);
}
