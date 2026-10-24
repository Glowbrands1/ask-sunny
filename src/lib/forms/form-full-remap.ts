import { PRODUCTION_SALONS } from "@/data/salons";
import { storeNameKey } from "@/lib/reporting/store-identity";

import { datesInText } from "./form-date-answer";
import { payrollAskAmount, statedPayrollDeduct } from "./payroll-deduct";
import { priorActionLine } from "./prior-actions";
import { extractEmployeeNames, extractJobTitle, JOB_TITLES, tidyTypedName } from "./proposal";
import { statedWarningLevel } from "./warning-level";

/**
 * One read of everything the manager has said, field by field.
 *
 * A value is kept only when their words support it, and the quote is the
 * span those words came from. A later turn replaces that field. A field
 * they have not mentioned stays empty. "write up" is the form, not a
 * Written Warning. A history date is prior coaching, not the form date.
 */

export interface Sourced<T> {
  readonly value: T;
  readonly quote: string;
}

export interface FormFieldMap {
  employeeName: Sourced<string> | null;
  jobTitle: Sourced<string> | null;
  formDate: Sourced<string> | null;
  warningLevel: Sourced<"verbal" | "written"> | null;
  payrollDeduct: Sourced<"yes" | "no"> | null;
  payrollAmount: Sourced<string> | null;
  priorCoaching: Sourced<string> | null;
  observation: Sourced<string> | null;
}

const EMPTY: FormFieldMap = {
  employeeName: null,
  jobTitle: null,
  formDate: null,
  warningLevel: null,
  payrollDeduct: null,
  payrollAmount: null,
  priorCoaching: null,
  observation: null,
};

const THING_WORDS = new Set([
  "cash",
  "drawer",
  "drawers",
  "register",
  "registers",
  "shortage",
  "shortages",
  "till",
  "tills",
]);

const LABEL_WORDS = new Set([
  "job",
  "title",
  "observation",
  "offense",
  "payroll",
  "date",
  "policy",
  "form",
]);

const NAME = "[A-Z][A-Za-z'’.-]+";
const PERSON = `${NAME}(?:\\s+${NAME}){0,2}`;
const WRITE_UP_NAME = new RegExp(
  `\\bwrit(?:e|ing)\\s+up\\s+(${PERSON})(?=\\s+for\\b|\\s+at\\b|[,.]|$)`,
);
const FOR_NAME = new RegExp(`\\bfor\\s+(${PERSON})(?=\\s+at\\b|\\s+for\\b|[,.]|$)`);
const EMPLOYEE_IS = new RegExp(`\\bemployee(?:'s)?(?:\\s+name)?\\s+is\\s+(${PERSON})\\b`);
const FOR_ROLE = /\bfor\s+([A-Za-z][\w'’-]+)\s+employee\b/;
const LEVEL_EDIT = /\b(?:make it|(?:this\s+)?should be|this is)\s+(?:a\s+)?(verbal|written)\b/i;
const DATE_EDIT = /\b(?:change|set|update|make)\s+(?:the\s+)?(?:form\s+)?date\s+to\b/i;
const HISTORY_CUE = /\b(?:was|were|been)\s+given\b|\b(?:prior|previous|earlier|already)\b|\bcoaching\b/i;
const HISTORY_STEP = /\b(?:ca|c\/a|warnings?|coaching|corrective)\b/i;
const FOR_INCIDENT =
  /\bfor\s+((?:cell\s+phone|opening|being|using|talking|wearing|missing|not\s+\w+|dress\s+code|no[- ]?show)[^.\n]*)/i;

export function extractFormRemap(userTurns: readonly string[], today: string): FormFieldMap {
  let map: FormFieldMap = { ...EMPTY };
  for (const turn of userTurns) {
    const text = turn ?? "";
    if (!text.trim() || isPolicyQuotation(text)) continue;
    const read = readTurn(text, today);
    map = {
      employeeName: read.employeeName ?? map.employeeName,
      jobTitle: read.jobTitle ?? map.jobTitle,
      formDate: read.formDate === undefined ? map.formDate : read.formDate,
      warningLevel: read.warningLevel ?? map.warningLevel,
      payrollDeduct: read.payrollDeduct ?? map.payrollDeduct,
      payrollAmount: read.payrollDeduct ? (read.payrollAmount ?? null) : (read.payrollAmount ?? map.payrollAmount),
      priorCoaching: read.priorCoaching ?? map.priorCoaching,
      observation: read.observation ?? map.observation,
    };
    if (read.payrollDeduct && read.payrollDeduct.value === "no") map = { ...map, payrollAmount: null };
  }
  return map;
}

interface TurnRead {
  employeeName?: Sourced<string>;
  jobTitle?: Sourced<string>;
  /** Undefined keeps the date already read. Null clears an ambiguous turn. */
  formDate?: Sourced<string> | null;
  warningLevel?: Sourced<"verbal" | "written">;
  payrollDeduct?: Sourced<"yes" | "no">;
  payrollAmount?: Sourced<string> | null;
  priorCoaching?: Sourced<string>;
  observation?: Sourced<string>;
}

function readTurn(text: string, today: string): TurnRead {
  const read: TurnRead = {};
  const employee = employeeFrom(text);
  if (employee) read.employeeName = employee;
  const title = jobTitleFrom(text);
  if (title) read.jobTitle = title;
  const warning = warningFrom(text);
  if (warning) read.warningLevel = warning;
  const payroll = payrollFrom(text);
  if (payroll) {
    read.payrollDeduct = payroll.deduct;
    read.payrollAmount = payroll.amount;
  }
  const observation = observationFrom(text);
  if (observation) read.observation = observation;
  applyDates(text, today, read);
  return read;
}

function employeeFrom(text: string): Sourced<string> | null {
  for (const pattern of [WRITE_UP_NAME, FOR_NAME, EMPLOYEE_IS]) {
    const match = pattern.exec(text);
    const accepted = match?.[1] ? acceptName(match[1]) : null;
    if (accepted) return { value: accepted, quote: match![1]! };
  }
  const role = FOR_ROLE.exec(text);
  if (role?.[1] && role[1].toLowerCase() !== "the" && !/\bTest\s+Employee\b/.test(text)) {
    const accepted = acceptName(role[1]);
    if (accepted) return { value: accepted, quote: role[1] };
  }
  const names = [
    ...new Set(
      extractEmployeeNames(text)
        .map((name) => keepTypedEmployee(text, name))
        .filter((name) => acceptName(name) !== null),
    ),
  ];
  if (names.length !== 1) return null;
  const value = tidyTypedName(names[0]!);
  return { value, quote: quoteOf(text, value) ?? value };
}

function keepTypedEmployee(text: string, name: string): string {
  const match = new RegExp(`\\b${escapeReg(name)}\\s+Employee\\b`).exec(text);
  return match ? tidyTypedName(`${name} Employee`) : tidyTypedName(name);
}

function acceptName(name: string): string | null {
  const value = tidyTypedName(name).replace(/[.,]+$/g, "");
  if (!value) return null;
  const words = value.toLowerCase().split(/\s+/);
  if (words.every((word) => THING_WORDS.has(word) || LABEL_WORDS.has(word))) return null;
  if (isStoreName(value)) return null;
  return value;
}

function isStoreName(name: string): boolean {
  const key = storeNameKey(name);
  return PRODUCTION_SALONS.some((salon) => {
    const full = storeNameKey(salon.name);
    const local = full.replace(/^[a-z]{2} /, "");
    return key === full || key === local;
  });
}

function jobTitleFrom(text: string): Sourced<string> | null {
  const found: { index: number; value: string; quote: string }[] = [];
  const label = /\bjob title\b\s*[:\-–—]?\s+/i.exec(text);
  if (label) {
    const rest = text.slice(label.index + label[0].length);
    const sentence = (rest.split(/[.!?\n;]/)[0] ?? "").trim();
    const value = cutTitle(sentence);
    if (value && !/it happened/i.test(value)) found.push({ index: label.index, value, quote: value });
  }
  for (const match of text.matchAll(/\b(tanning\s+consultants?|tan\s+consultants?)\b/gi)) {
    const raw = match[0];
    const value = /^tanning\b/i.test(raw) ? "Tanning Consultant" : raw;
    found.push({ index: match.index ?? 0, value, quote: raw });
  }
  if (found.length > 0) {
    const last = found.sort((a, b) => a.index - b.index)[found.length - 1]!;
    return /it happened/i.test(last.value) ? null : { value: last.value, quote: last.quote };
  }
  const stripped = text.replace(
    /\bnot\s+(?:a\s+|an\s+)?(?:salon\s+director|district\s+manager|tanning\s+consultant|tan\s+consultant|assistant\s+salon\s+director|sdit|asd|tsd)\b/gi,
    " ",
  );
  for (const entry of JOB_TITLES) {
    const match = new RegExp(entry.pattern.source, "i").exec(stripped);
    if (!match) continue;
    if (!quoteOf(text, match[0])) continue;
    return { value: entry.title, quote: match[0] };
  }
  const canonical = extractJobTitle(stripped);
  return canonical ? { value: canonical, quote: canonical } : null;
}

function cutTitle(raw: string): string {
  const kept: string[] = [];
  for (const word of raw.trim().split(/\s+/)) {
    const clean = word.replace(/^[("']+|[)"',.]+$/g, "");
    if (!clean || /^(?:at|in|on|for)$/i.test(clean)) break;
    kept.push(clean);
  }
  return kept.join(" ").trim();
}

function warningFrom(text: string): Sourced<"verbal" | "written"> | null {
  const masked = text.replace(/\bwritten\s+up\b/gi, " ").replace(/\bwrite[- ]?ups?\b/gi, " ");
  const edit = LEVEL_EDIT.exec(masked);
  if (edit?.[1] && quoteOf(text, edit[0])) {
    const value = edit[1].toLowerCase() as "verbal" | "written";
    return { value, quote: edit[0] };
  }
  const stated = statedWarningLevel(masked);
  if (!stated) return null;
  const quote = quoteForLevel(text, stated);
  if (!quote) return null;
  return { value: stated, quote };
}

function quoteForLevel(text: string, level: "verbal" | "written"): string | null {
  const patterns = [
    new RegExp(`\\b${level}\\s+(?:warning|corrective\\s+action|ca|c\\/a)\\b`, "i"),
    new RegExp(`\\b${level}\\b`, "i"),
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (!match) continue;
    if (/\bwrite[- ]?ups?\b/i.test(match[0]) || /\bwritten\s+up\b/i.test(match[0])) continue;
    return match[0];
  }
  return null;
}

function payrollFrom(text: string): { deduct: Sourced<"yes" | "no">; amount: Sourced<string> | null } | null {
  const explicit = /\bpayroll\s+deduct(?:ion)?\s+(yes|no)\b/i.exec(text);
  if (explicit?.[1]) {
    const value = explicit[1].toLowerCase() as "yes" | "no";
    const amount = value === "yes" ? payrollAskAmount(text) : null;
    return {
      deduct: { value, quote: explicit[0] },
      amount: amount ? { value: amount, quote: amount } : null,
    };
  }
  const amount = payrollAskAmount(text);
  const stated = statedPayrollDeduct(text) ?? (amount && /\bdeduct/i.test(text) ? "yes" : null);
  if (!stated) return null;
  const quote =
    quoteOf(text, "payroll deduct") ??
    quoteOf(text, "deduct") ??
    (stated === "yes" ? "yes" : "no");
  return {
    deduct: { value: stated, quote },
    amount: stated === "yes" && amount ? { value: amount, quote: amount } : null,
  };
}

function observationFrom(text: string): Sourced<string> | null {
  const incident = FOR_INCIDENT.exec(text);
  if (incident?.[1]) {
    const clause = incident[1].trim();
    const summary = summariseIncident(clause);
    if (summary && summary.toLowerCase() !== text.trim().toLowerCase()) {
      return { value: summary, quote: coreIncident(clause) };
    }
  }
  const drawer = /\bcash drawer was\b[^.\n]*/i.exec(text);
  if (drawer) {
    const clause = drawer[0].trim();
    return { value: sentence(clause), quote: clause };
  }
  if (/\b(?:was|were)\s+late\b/i.test(text)) return { value: "Late.", quote: "late" };
  return null;
}

function summariseIncident(clause: string): string | null {
  const core = coreIncident(clause);
  if (!core || /^(?:write|create|make)\b/i.test(core)) return null;
  if (/^cell\s+phone\s+use$/i.test(core)) return "Cell phone use.";
  if (/^opening\s+(?:the\s+)?salon\s+late$/i.test(core)) return "Opening the salon late.";
  if (core.length > 160) return null;
  return sentence(core);
}

function coreIncident(clause: string): string {
  return clause
    .replace(/\s+on\s+(?:the\s+)?(?:\d|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec).+$/i, "")
    .replace(/\s+at\s+.+$/i, "")
    .trim()
    .replace(/[.\s]+$/g, "");
}

function sentence(text: string): string {
  const trimmed = text.trim().replace(/[.\s]+$/g, "");
  if (!trimmed) return "";
  const head = trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
  return `${head}.`;
}

function applyDates(text: string, today: string, read: TurnRead): void {
  const dates = datesInText(text, today);
  const edit = DATE_EDIT.exec(text);
  let edited: Sourced<string> | null = null;
  if (edit) {
    const tail = text.slice(edit.index);
    const next = datesInText(tail, today)[0];
    if (next) edited = { value: next.iso, quote: tail.slice(0, next.end).trim() };
  }
  const history: Sourced<string>[] = [];
  const incidents: Sourced<string>[] = [];
  for (const found of dates) {
    if (edited && found.iso === edited.value && text.slice(found.index, found.end) && edit && found.index >= edit.index) {
      continue;
    }
    const sentence = sentenceAt(text, found.index);
    const local = sentence.indexOf(text.slice(found.index, found.end));
    const before = local >= 0 ? sentence.slice(0, local) : sentence;
    const quote = text.slice(found.index, found.end);
    if (HISTORY_CUE.test(before) && HISTORY_STEP.test(before)) {
      history.push({ value: priorLine(before, found.iso), quote: sentence.trim() });
    } else if (!edited) {
      incidents.push({ value: found.iso, quote });
    }
  }
  if (history.length > 0) {
    read.priorCoaching = {
      value: history.map((step) => step.value).join("; "),
      quote: history.map((step) => step.quote).join(" "),
    };
  }
  if (edited) read.formDate = edited;
  else if (incidents.length === 1) read.formDate = { value: incidents[0]!.value, quote: incidents[0]!.quote };
  else if (incidents.length > 1) read.formDate = null;
}

function priorLine(before: string, iso: string): string {
  let step = "Corrective action";
  if (/\bverbal\b/i.test(before)) step = "Verbal corrective action";
  else if (/\bwritten\b/i.test(before)) step = "Written corrective action";
  else if (/\bcoaching\b/i.test(before)) step = "Coaching";
  return priorActionLine(step, iso);
}

function sentenceAt(text: string, index: number): string {
  let start = 0;
  for (const mark of [".", "!", "?", "\n"]) {
    const at = text.lastIndexOf(mark, index - 1);
    if (at >= start) start = at + 1;
  }
  let end = text.length;
  for (const mark of [".", "!", "?", "\n"]) {
    const at = text.indexOf(mark, index);
    if (at >= 0 && at < end) end = at;
  }
  return text.slice(start, end);
}

function isPolicyQuotation(text: string): boolean {
  return /\breimburse\b/i.test(text) && /\bpayroll deduction\b/i.test(text) && /\bwhen applicable\b/i.test(text);
}

function quoteOf(text: string, needle: string): string | null {
  const index = text.toLowerCase().indexOf(needle.toLowerCase());
  if (index < 0) return null;
  return text.slice(index, index + needle.length);
}

function escapeReg(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
