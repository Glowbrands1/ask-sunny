import { PRODUCTION_SALONS } from "@/data/salons";
import { priorCoachingOptionalEnabled } from "@/lib/config/chat-quality-flags";
import { readCorrectiveActionIntake, describesIncident, type IntakeItem } from "@/lib/forms/corrective-action-intake";
import { extractFormDate } from "@/lib/forms/form-date-answer";
import { payrollDeductAmount } from "@/lib/forms/payroll-deduct";
import { statedPayrollDeduct } from "@/lib/forms/payroll-deduct-answer";
import { extractEmployeeNames } from "@/lib/forms/proposal";
import { readSalonMentions, rosterSalonName } from "@/lib/forms/salon-mention";
import { rosterSalonFor } from "@/lib/forms/salon-text";
import { statedWarningLevel } from "@/lib/forms/warning-level";
import { sectionTitleMatches } from "@/lib/knowledge/hybrid-rank";

import type { FormToolTurn } from "./form-tool-schema";

/**
 * Fields a form turn has already established.
 *
 * Built from the existing readers first. A tool-call value is kept only when
 * the manager's words corroborate it: a salon is never the employee, a date
 * that was not typed is dropped, and a payroll amount that was not stated is
 * dropped. Confirmed fields stay when a later turn does not repeat them.
 */

export interface ConfirmedFormFields {
  readonly employeeName: string | null;
  readonly jobTitle: string | null;
  readonly salon: string | null;
  readonly incidentDateIso: string | null;
  readonly useToday: boolean;
  readonly payrollDeduct: "yes" | "no" | null;
  readonly payrollAmount: string | null;
  readonly warningLevel: "verbal" | "written" | null;
  readonly policySection: string | null;
  readonly whatHappened: boolean;
  readonly deadline: string | null;
}

export const EMPTY_CONFIRMED_FIELDS: ConfirmedFormFields = {
  employeeName: null,
  jobTitle: null,
  salon: null,
  incidentDateIso: null,
  useToday: false,
  payrollDeduct: null,
  payrollAmount: null,
  warningLevel: null,
  policySection: null,
  whatHappened: false,
  deadline: null,
};

function appears(text: string, phrase: string | null | undefined): boolean {
  const needle = phrase?.trim().toLowerCase() ?? "";
  return needle.length > 1 && text.toLowerCase().includes(needle);
}

function asWritten(text: string, phrase: string): string {
  const trimmed = phrase.trim();
  const index = text.toLowerCase().indexOf(trimmed.toLowerCase());
  if (index < 0) return trimmed;
  return text.slice(index, index + trimmed.length);
}

function isSalonName(value: string): boolean {
  const key = value.trim().toLowerCase();
  if (!key) return false;
  if (rosterSalonFor(value)) return true;
  if (readSalonMentions(value).length > 0) return true;
  return PRODUCTION_SALONS.some((salon) => {
    const full = salon.name.toLowerCase();
    const tail = full.replace(/^[a-z]{2}\s+/, "");
    return full === key || tail === key || (key.length >= 5 && tail.endsWith(` ${key}`));
  });
}

function salonFromText(text: string): string | null {
  const mentions = readSalonMentions(text);
  if (mentions.length === 1 && mentions[0]!.salonIds.length === 1) {
    return rosterSalonName(mentions[0]!.salonIds[0]!);
  }
  return null;
}

/**
 * A short salon the existing mention reader did not take, when it is exactly
 * one roster tail and the manager actually typed it. "at Wornall. Use today's
 * date" loses the salon because the next word is not a place cue; "Wornall"
 * still names one salon.
 */
function uniqueRosterSalon(phrase: string): string | null {
  const key = phrase
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (key.length < 5 || key.split(" ").length > 4) return null;
  const hits = PRODUCTION_SALONS.filter((salon) => {
    const full = salon.name.toLowerCase();
    const tail = full.replace(/^[a-z]{2}\s+/, "");
    return full === key || tail === key || tail.endsWith(` ${key}`);
  });
  return hits.length === 1 ? hits[0]!.name : null;
}

function dollarsIn(text: string): string[] {
  return [...text.matchAll(/\$\s?\d+(?:,\d{3})*(?:\.\d{2})?/g)].map((match) =>
    match[0].replace(/\s+/g, ""),
  );
}

/** What the existing readers can already prove from the manager's words. */
export function fieldsFromManagerText(text: string, today: string): ConfirmedFormFields {
  const intake = readCorrectiveActionIntake({
    text,
    employeeKnown: false,
    salonSettled: false,
  });
  const names = extractEmployeeNames(text).filter((name) => !isSalonName(name));
  const date = extractFormDate(text, today);
  const useToday = date === null && intake.supplied.includes("form_date");
  return {
    employeeName: names.length === 1 ? names[0]! : null,
    jobTitle: null,
    salon: salonFromText(text),
    incidentDateIso: date ?? (useToday ? today : null),
    useToday,
    payrollDeduct: statedPayrollDeduct(text),
    payrollAmount: payrollDeductAmount(text),
    warningLevel: statedWarningLevel(text),
    policySection: null,
    whatHappened: describesIncident(text) || intake.supplied.includes("what_happened"),
    deadline: null,
  };
}

/**
 * Fill gaps the readers missed, and reject anything the tool invented.
 * Where a reader already has a value, that value wins.
 */
export function corroborateModelFields(
  base: ConfirmedFormFields,
  model: FormToolTurn["fields"],
  text: string,
  today: string,
): ConfirmedFormFields {
  let employeeName = base.employeeName;
  if (
    !employeeName &&
    model.employeeName &&
    appears(text, model.employeeName) &&
    !isSalonName(model.employeeName)
  ) {
    employeeName = asWritten(text, model.employeeName);
  }

  let jobTitle = base.jobTitle;
  if (model.jobTitle && appears(text, model.jobTitle) && !isSalonName(model.jobTitle)) {
    jobTitle = asWritten(text, model.jobTitle);
  }

  let salon = base.salon;
  if (!salon && model.salon && appears(text, model.salon)) {
    const fromPhrase = salonFromText(model.salon) ?? salonFromText(text) ?? uniqueRosterSalon(model.salon);
    if (fromPhrase) salon = fromPhrase;
  }

  let incidentDateIso = base.incidentDateIso;
  let useToday = base.useToday;
  const extracted = extractFormDate(text, today);
  if (extracted) {
    incidentDateIso = extracted;
    useToday = false;
  } else if ((base.useToday || model.useToday) && /\btodays?\b|\btoday\b/i.test(text)) {
    useToday = true;
    incidentDateIso = today;
  }
  if (model.incidentDateIso && model.incidentDateIso !== incidentDateIso && model.incidentDateIso !== extracted) {
    // A calendar date the readers did not find is not stored.
    incidentDateIso = extracted ?? (useToday ? today : incidentDateIso);
  }

  const payrollDeduct = base.payrollDeduct ?? null;
  let payrollAmount = base.payrollAmount;
  if (!payrollAmount && payrollDeduct === "yes" && model.payrollAmount) {
    const stated = dollarsIn(text);
    const wanted = model.payrollAmount.replace(/\s+/g, "");
    if (stated.includes(wanted)) payrollAmount = wanted;
  }

  let policySection = base.policySection;
  if (
    model.policySection &&
    (appears(text, model.policySection) || sectionTitleMatches(text, model.policySection))
  ) {
    policySection = model.policySection.trim();
  }

  const deadline = model.deadline && appears(text, model.deadline) ? asWritten(text, model.deadline) : null;

  return {
    employeeName,
    jobTitle,
    salon,
    incidentDateIso,
    useToday,
    payrollDeduct,
    payrollAmount,
    warningLevel: base.warningLevel,
    policySection,
    whatHappened: base.whatHappened,
    deadline: base.deadline ?? deadline,
  };
}

/** A later turn fills blanks. A correction replaces a field only when the new value checked out. */
export function mergeConfirmed(
  previous: ConfirmedFormFields,
  next: ConfirmedFormFields,
  correct: boolean,
): ConfirmedFormFields {
  const pick = <T>(prior: T | null, incoming: T | null): T | null => {
    if (correct) return incoming ?? prior;
    return prior ?? incoming;
  };
  return {
    employeeName: pick(previous.employeeName, next.employeeName),
    jobTitle: pick(previous.jobTitle, next.jobTitle),
    salon: pick(previous.salon, next.salon),
    incidentDateIso: pick(previous.incidentDateIso, next.incidentDateIso),
    useToday: correct ? next.useToday || previous.useToday : previous.useToday || next.useToday,
    payrollDeduct: pick(previous.payrollDeduct, next.payrollDeduct),
    payrollAmount: pick(previous.payrollAmount, next.payrollAmount),
    warningLevel: pick(previous.warningLevel, next.warningLevel),
    policySection: pick(previous.policySection, next.policySection),
    whatHappened: previous.whatHappened || next.whatHappened,
    deadline: pick(previous.deadline, next.deadline),
  };
}

export function confirmedFromToolTurn(
  previous: ConfirmedFormFields,
  reading: FormToolTurn,
  managerText: string,
  today: string,
): ConfirmedFormFields {
  const base = fieldsFromManagerText(managerText, today);
  const corroborated = corroborateModelFields(base, reading.fields, managerText, today);
  return mergeConfirmed(previous, corroborated, reading.intent === "correct_fields");
}

/** Intake lines still unanswered after confirmed fields are taken into account. */
export function missingIntakeItems(text: string, fields: ConfirmedFormFields): IntakeItem[] {
  const intake = readCorrectiveActionIntake({
    text,
    employeeKnown: fields.employeeName !== null,
    salonSettled: fields.salon !== null,
    payrollDeduct: fields.payrollDeduct,
  });
  return intake.missing.filter((item) => {
    if (item.key === "employee_name" && fields.employeeName) return false;
    if (item.key === "salon" && fields.salon) return false;
    if (item.key === "form_date" && (fields.incidentDateIso || fields.useToday)) return false;
    if (item.key === "job_title" && fields.jobTitle) return false;
    if (item.key === "what_happened" && fields.whatHappened) return false;
    if (item.key === "warning_level" && fields.warningLevel) return false;
    if (item.key === "payroll_deduct" && fields.payrollDeduct) return false;
    // Off: prior coaching stays unanswered, which is the current intake.
    // On: a blank line is allowed, so it is not something still to collect.
    if (item.key === "previous_action") return !priorCoachingOptionalEnabled();
    return true;
  });
}

const ASK_LINE: { key: keyof ConfirmedFormFields; pattern: RegExp }[] = [
  { key: "employeeName", pattern: /employee'?s full name/i },
  { key: "salon", pattern: /salon location/i },
  { key: "incidentDateIso", pattern: /date for the form/i },
  { key: "jobTitle", pattern: /job title/i },
  { key: "warningLevel", pattern: /verbal or written warning/i },
  { key: "payrollDeduct", pattern: /payroll deduct applicable/i },
];

function fieldIsHeld(fields: ConfirmedFormFields, key: keyof ConfirmedFormFields): boolean {
  if (key === "incidentDateIso") return Boolean(fields.incidentDateIso) || fields.useToday;
  if (key === "whatHappened") return fields.whatHappened;
  if (key === "useToday") return fields.useToday;
  const value = fields[key];
  return value !== null && value !== "";
}

/** Drop intake lines for fields the conversation already established. */
export function retainFieldsInReply(content: string, fields: ConfirmedFormFields): string {
  const kept = content.split("\n").filter((line) => {
    for (const ask of ASK_LINE) {
      if (ask.pattern.test(line) && fieldIsHeld(fields, ask.key)) return false;
    }
    return true;
  });
  let text = kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  if (fields.employeeName && /nothing has been created/i.test(text)) {
    text = text.replace(
      /nothing has been created yet\.?/gi,
      `I still have ${fields.employeeName} for this form.`,
    );
  }
  return text;
}

/** What is already known, then only the lines that are still open. Uses the employee's name. */
export function retentionReply(fields: ConfirmedFormFields, missing: readonly IntakeItem[]): string {
  const held: string[] = [];
  if (fields.employeeName) held.push(fields.employeeName);
  if (fields.jobTitle) held.push(`title ${fields.jobTitle}`);
  if (fields.salon) held.push(fields.salon);
  if (fields.useToday) held.push("today's date");
  else if (fields.incidentDateIso) held.push(fields.incidentDateIso);
  if (fields.warningLevel) held.push(`a ${fields.warningLevel} warning`);
  if (fields.payrollDeduct === "yes") {
    held.push(fields.payrollAmount ? `a payroll deduction of ${fields.payrollAmount}` : "a payroll deduction");
  } else if (fields.payrollDeduct === "no") {
    held.push("no payroll deduction");
  }
  const lines = [
    held.length > 0 ? `I already have ${held.join(", ")}.` : "Tell me who the form is for.",
  ];
  if (missing.length === 0) {
    lines.push("I will not ask for those again.");
  } else {
    lines.push("I only still need:");
    missing.forEach((item, index) => lines.push(`${index + 1}. ${item.prompt}`));
  }
  return lines.join("\n");
}

/**
 * Restate corroborated fields in words the existing intake already understands,
 * and keep the turn on the open form.
 */
export function questionWithConfirmedFields(question: string, fields: ConfirmedFormFields): string {
  const lines = [question.trim()];
  // Each fact ends a sentence. A capital on the next line would otherwise be
  // read as another word of the employee's name ("Jordan Lee" + "Job").
  if (fields.employeeName) lines.push(`Employee name: ${fields.employeeName}.`);
  if (fields.jobTitle) lines.push(`job title: ${fields.jobTitle}.`);
  if (fields.salon) lines.push(`The salon is ${fields.salon}.`);
  if (fields.useToday) lines.push("Use today's date.");
  else if (fields.incidentDateIso) lines.push(`Date for the form: ${fields.incidentDateIso}.`);
  if (fields.warningLevel) lines.push(`${fields.warningLevel} warning`);
  if (fields.payrollDeduct === "yes") {
    lines.push(
      fields.payrollAmount ? `Payroll deduction of ${fields.payrollAmount}` : "Payroll deduction yes",
    );
  } else if (fields.payrollDeduct === "no") {
    lines.push("No payroll deduction");
  }
  if (!/\bkeep this as\b/i.test(question)) lines.push("keep this as this form");
  return lines.join("\n");
}
