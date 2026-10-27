import { datesInText } from "@/lib/forms/form-date-answer";
import { displayName, editDistance } from "@/lib/forms/employee-match";
import { extractJobTitle } from "@/lib/forms/proposal";

import type { GroundedPerson } from "../grounded-entities";
import { titleInWords } from "../title-in-words";
import type { FormReading, ReadField } from "./schema";

/**
 * ============================================================================
 * AI_READS_CODE_CHECKS_ENABLED — THE CODE CHECKS WHAT THE MODEL READ
 * ============================================================================
 *
 * Each field passes or fails. Nothing is guessed here:
 *
 *   quote     the evidence is in one of the manager's own turns (case,
 *             spacing and punctuation aside); the app's lines never count
 *   employee  one person on the scoped roster, by full name, preferred name,
 *             "Last, First", a first or last name nobody else in scope has,
 *             or one letter off
 *   date      the quote states that calendar day, and it is not in the future
 *   location  the quote names that one location
 *   title     the quote states that title
 *   policy    exactly one of the manual's headings
 *   warning / payroll / amount   the quote says that word or that amount
 *
 * A field that fails is null, as if the model had not read it.
 */

export interface LocationRow {
  readonly id: string;
  readonly name: string;
}

export interface CheckContext {
  /** The manager's own turns about this form, oldest first. */
  readonly managerTurns: readonly string[];
  readonly people: readonly GroundedPerson[];
  readonly locations: readonly LocationRow[];
  readonly headings: readonly string[];
  readonly today: string;
}

export interface CheckedReading {
  readonly employee: { readonly name: string; readonly person: GroundedPerson | null } | null;
  readonly location: LocationRow | null;
  readonly jobTitle: string | null;
  readonly incidentDate: string | null;
  readonly warningLevel: "verbal" | "written" | null;
  readonly payroll: "yes" | "no" | null;
  readonly payrollAmount: string | null;
  readonly policyHeading: string | null;
  /** Dates the manager gave for something other than the incident, each quoted. */
  readonly notIncidentDates: readonly string[];
  /** The fields that were read but failed a check, for the trace. */
  readonly rejected: readonly string[];
}

export function checkReading(reading: FormReading, context: CheckContext): CheckedReading {
  const rejected: string[] = [];
  const keep = <T>(name: string, field: ReadField, check: (value: string, evidence: string) => T | null): T | null => {
    if (!field.value) return null;
    if (!field.evidence || !quoted(field.evidence, context.managerTurns)) {
      rejected.push(name);
      return null;
    }
    const value = check(field.value, field.evidence);
    if (value === null) rejected.push(name);
    return value;
  };

  const employee = keep("employee", reading.employee, (value, evidence) => checkEmployee(value, evidence, context.people));
  const location = keep("location", reading.location, (value, evidence) => checkLocation(value, evidence, context.locations));
  const jobTitle = keep("jobTitle", reading.jobTitle, (value, evidence) => checkTitle(value, evidence, context.people));
  const notIncidentDates = [...reading.priorSteps, ...reading.otherDates]
    .filter((row) => row.date && row.evidence && quoted(row.evidence, context.managerTurns))
    .map((row) => checkDate(row.date!, row.evidence!, context.today))
    .filter((iso): iso is string => iso !== null);
  const statedDate = keep("incidentDate", reading.incidentDate, (value, evidence) => checkDate(value, evidence, context.today));
  const incidentDate = statedDate && !notIncidentDates.includes(statedDate) ? statedDate : null;
  if (statedDate && !incidentDate) rejected.push("incidentDate");
  const warningLevel = keep("warningLevel", reading.warningLevel, (value, evidence) => {
    const level = value.toLowerCase();
    return (level === "verbal" || level === "written") && wordSaid(level, evidence) ? level : null;
  });
  const payroll = keep("payroll", reading.payroll, (value, evidence) => {
    const answer = value.toLowerCase();
    if (answer !== "yes" && answer !== "no") return null;
    return /\b(?:payroll|deduct\w*)\b/i.test(evidence) || /^\s*(?:yes|no)\b/i.test(evidence) ? answer : null;
  });
  const payrollAmount = keep("payrollAmount", reading.payrollAmount, (value, evidence) => checkAmount(value, evidence));
  const policyHeading = reading.policyHeading.value
    ? (context.headings.find((heading) => heading === reading.policyHeading.value) ?? null)
    : null;
  if (reading.policyHeading.value && !policyHeading) rejected.push("policyHeading");

  return {
    employee,
    location,
    jobTitle,
    incidentDate,
    warningLevel,
    payroll,
    payrollAmount,
    policyHeading,
    notIncidentDates,
    rejected,
  };
}

/* ------------------------------------------------------------- the quote --- */

/** Lowercase words and numbers only, one space apart. */
export function plainWords(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9$]+/g, " ")
    .trim();
}

export function quoted(evidence: string, turns: readonly string[]): boolean {
  const needle = plainWords(evidence);
  if (needle === "") return false;
  return turns.some((turn) => ` ${plainWords(turn)} `.includes(` ${needle} `));
}

function wordSaid(word: string, evidence: string): boolean {
  return plainWords(evidence)
    .split(" ")
    .some((said) => said === word || (said.length >= 5 && editDistance(said, word) <= 1));
}

/* -------------------------------------------------------------- employee --- */

function checkEmployee(
  value: string,
  evidence: string,
  people: readonly GroundedPerson[],
): { name: string; person: GroundedPerson | null } | null {
  // The name as the manager typed it, inside the quote it came from.
  const typed = plainWords(value);
  const words = typed.split(" ").filter((word) => /^[a-z]+$/.test(word));
  if (words.length === 0 || !` ${plainWords(evidence)} `.includes(` ${typed} `)) return null;
  // No roster to check against: the typed name stands, as the readers keep it today.
  if (people.length === 0) return { name: value.trim(), person: null };
  const fits = people.filter((person) => nameFits(person, words));
  if (fits.length !== 1) return null;
  return { name: displayName(fits[0]!), person: fits[0]! };
}

/**
 * The typed name is this person: every word is their first, preferred or last
 * name (one letter off allowed from four letters up), in either order, so
 * "quinn", "Marlowe, Quinn" and "quin marlowe" all fit and "quinn ferris" does not.
 */
function nameFits(person: GroundedPerson, words: readonly string[]): boolean {
  const names = [person.firstName, person.preferredFirstName ?? "", person.lastName]
    .flatMap((name) => plainWords(name).split(" "))
    .filter(Boolean);
  const close = (word: string, name: string) => word === name || (name.length >= 4 && word.length >= 4 && editDistance(word, name) <= 1);
  return words.every((word) => names.some((name) => close(word, name)));
}

/* --------------------------------------------------------- the other ones --- */

/**
 * The location the manager wrote, inside its quote: its words ("kearney",
 * "wornall", "lincoln o street") are all in one location's name, and in only
 * that one. "salon" and "store" are not a name.
 */
function checkLocation(value: string, evidence: string, locations: readonly LocationRow[]): LocationRow | null {
  const typed = plainWords(value);
  if (typed === "" || !` ${plainWords(evidence)} `.includes(` ${typed} `)) return null;
  const words = typed.split(" ").filter((word) => word !== "salon" && word !== "store" && word !== "location");
  if (words.length === 0) return null;
  const fits = locations.filter((row) => {
    const name = plainWords(row.name).split(" ");
    return words.every((word) => name.includes(word));
  });
  return fits.length === 1 ? fits[0]! : null;
}

function checkTitle(value: string, evidence: string, people: readonly GroundedPerson[]): string | null {
  const stated = extractJobTitle(evidence);
  if (stated && plainWords(stated) === plainWords(value)) return stated;
  const directory = people.map((person) => person.title).find((title) => title && plainWords(title) === plainWords(value));
  return directory && titleInWords(directory, evidence) ? directory : null;
}

function checkAmount(value: string, evidence: string): string | null {
  const wanted = canonical(value.replace(/[$\s]/g, ""));
  if (!wanted) return null;
  const said = [...evidence.matchAll(/\$?\s*(\d{1,6}(?:\.\d{1,2})?)/g)].map((match) => canonical(match[1] ?? ""));
  return said.includes(wanted) ? wanted : null;
}

function canonical(raw: string): string | null {
  if (!/^\d{1,6}(?:\.\d{1,2})?$/.test(raw)) return null;
  const amount = Number(raw);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return `$${Number.isInteger(amount) ? amount : amount.toFixed(2)}`;
}

/* ------------------------------------------------------------------ dates --- */

const MONTH_WORDS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6,
  jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11,
  november: 11, dec: 12, december: 12,
};

/**
 * The model's YYYY-MM-DD is kept when its quote states that day and it is not
 * after today. The quote may be any shape a manager writes: "10/15", "10-15-26",
 * "10.15", "oct 15", "october 15th", "15 october", or "the 15th" (this month,
 * or last month when the 15th has not come yet).
 */
export function checkDate(value: string, evidence: string, today: string): string | null {
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!iso || !realDay(Number(iso[1]), Number(iso[2]), Number(iso[3]))) return null;
  const wanted = value.trim();
  if (wanted > today) return null;
  return datesSaid(evidence, today).includes(wanted) ? wanted : null;
}

function datesSaid(evidence: string, today: string): string[] {
  const found = new Set(datesInText(evidence, today).map((date) => date.iso));
  const year = Number(today.slice(0, 4));
  const add = (month: number, day: number, written?: number) => {
    // No year written: the latest such day that is not after today.
    const y = written ? (written < 100 ? 2000 + written : written) : isoOf(year, month, day) <= today ? year : year - 1;
    if (realDay(y, month, day)) found.add(isoOf(y, month, day));
  };
  const text = evidence.toLowerCase();
  for (const match of text.matchAll(/\b(\d{1,2})[./-](\d{1,2})(?:[./-](\d{2,4}))?\b/g)) {
    add(Number(match[1]), Number(match[2]), match[3] ? Number(match[3]) : undefined);
  }
  const month = String.raw`(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?`;
  for (const match of text.matchAll(new RegExp(String.raw`\b${month}\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?\b`, "g"))) {
    add(MONTH_WORDS[match[1]!]!, Number(match[2]), match[3] ? Number(match[3]) : undefined);
  }
  for (const match of text.matchAll(new RegExp(String.raw`\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?${month}(?:,?\s+(\d{4}))?`, "g"))) {
    add(MONTH_WORDS[match[2]!]!, Number(match[1]), match[3] ? Number(match[3]) : undefined);
  }
  for (const match of text.matchAll(/\bthe\s+(\d{1,2})(?:st|nd|rd|th)\b/g)) {
    const day = Number(match[1]);
    const [y, m, d] = today.split("-").map(Number) as [number, number, number];
    const back = day <= d ? { y, m } : m === 1 ? { y: y - 1, m: 12 } : { y, m: m - 1 };
    if (realDay(back.y, back.m, day)) found.add(isoOf(back.y, back.m, day));
  }
  return [...found];
}

function realDay(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1) return false;
  return day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function isoOf(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
