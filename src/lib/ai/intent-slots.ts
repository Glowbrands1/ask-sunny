import { z } from "zod";

import { datesInText } from "@/lib/forms/form-date-answer";
import { displayName, matchEmployeeName, type RosterEmployee } from "@/lib/forms/employee-match";
import { describedAttendanceKeys } from "@/lib/forms/ca-policy";
import { headingKey, sectionHeadingsFor } from "@/lib/forms/official-policy-manual";
import { namesHeading } from "@/lib/forms/named-policy-section";

import {
  EMPTY_FORM_STATE,
  prependFormState,
  stateSentences,
  type ConversationFormState,
} from "./form-state";
import type { GroundedPerson } from "./grounded-entities";

/**
 * Slots read off one turn, then kept only when the roster, the salon list,
 * or the manual headings agree.
 *
 * The model copies what the manager said. This file decides what is real.
 * A heading that is not in the headings it was given is not an incident
 * type, and a person who is not on the roster is not the employee.
 */

export const INTENT_TOOL_NAME = "record_intent_slots";

const warningSchema = z.enum(["verbal", "written"]).nullable().optional();

export const intentSlotSchema = z
  .object({
    employee: z.string().nullable().optional(),
    salon: z.string().nullable().optional(),
    title: z.string().nullable().optional(),
    incidentType: z.string().nullable().optional(),
    incidentDate: z.string().nullable().optional(),
    payrollAmount: z.string().nullable().optional(),
    warningLevel: warningSchema,
    formType: z.string().nullable().optional(),
    formTurn: z.boolean().optional(),
  })
  .transform((value) => ({
    employee: blank(value.employee),
    salon: blank(value.salon),
    title: blank(value.title),
    incidentType: blank(value.incidentType),
    incidentDate: blank(value.incidentDate),
    payrollAmount: blank(value.payrollAmount),
    warningLevel: value.warningLevel ?? null,
    formType: blank(value.formType),
    formTurn: value.formTurn ?? false,
  }));

export type IntentSlotReading = z.infer<typeof intentSlotSchema>;

export const INTENT_TOOL_INPUT_SCHEMA = {
  type: "object" as const,
  additionalProperties: false,
  required: [
    "employee",
    "salon",
    "title",
    "incidentType",
    "incidentDate",
    "payrollAmount",
    "warningLevel",
    "formType",
    "formTurn",
  ],
  properties: {
    employee: { type: ["string", "null"], description: "The person named, in the manager's own spelling. Null when nobody was named." },
    salon: { type: ["string", "null"], description: "The salon named, in the manager's own words. Null when none was named." },
    title: { type: ["string", "null"], description: "The job title the manager stated. Null when they did not state one." },
    incidentType: { type: ["string", "null"], description: "What happened, in the manager's words. Null when they did not say." },
    incidentDate: {
      type: ["string", "null"],
      description: "The incident date as the manager wrote it, any format. Null when they gave no date.",
    },
    payrollAmount: { type: ["string", "null"], description: "A payroll amount they stated. Null when they did not." },
    warningLevel: { type: ["string", "null"], enum: ["verbal", "written", null] },
    formType: { type: ["string", "null"], description: "The form they named, in their words. Null when no form was named." },
    formTurn: { type: "boolean", description: "True when this turn is filing or continuing a form." },
  },
};

export const INTENT_TOOL_DESCRIPTION =
  "Record the slots the manager has stated in this conversation. Copy their words. Do not invent a name, a salon, a title, a date, an amount, or a policy.";

export interface SalonRow {
  readonly id: string;
  readonly name: string;
}

export interface TemplateRow {
  readonly key: string;
  readonly name: string;
}

export interface IntentTurnInput {
  readonly question: string;
  readonly history: readonly { role: string; content: string }[];
  readonly today: string;
  readonly saved: ConversationFormState | null;
  /** The tool payload, or null when the model returned nothing usable. */
  readonly raw: unknown;
  readonly people: readonly GroundedPerson[];
  readonly salons: readonly SalonRow[];
  /** Section headings from the manual that was retrieved. */
  readonly headings: readonly string[];
  readonly templates: readonly TemplateRow[];
  readonly formInProgress: boolean;
}

export interface IntentTurnDecision {
  readonly question: string;
  readonly state: ConversationFormState;
  readonly clarification: string | null;
}

interface ChoiceOption {
  readonly label: string;
  readonly detail: string | null;
}

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8,
  sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};

const DAY_MONTH =
  /\b(\d{1,2})(?:st|nd|rd|th)?(?:\s+of)?\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?(?:,?\s+(\d{4}))?\b/gi;

/**
 * A calendar date in the shapes the form reader already accepts, plus a day
 * written before the month ("1 October 2026"). Anything that is not a real
 * day is null.
 */
export function normalizeIncidentDate(raw: string, today: string): string | null {
  const text = raw.trim();
  if (!text) return null;
  const known = datesInText(text, today);
  if (known.length === 1) return known[0]!.iso;
  if (known.length > 1) return known[known.length - 1]!.iso;
  DAY_MONTH.lastIndex = 0;
  const named = DAY_MONTH.exec(text);
  if (!named) return null;
  const month = MONTHS[named[2]!.toLowerCase().replace(/\./g, "")];
  if (!month) return null;
  const year = named[3] ? Number(named[3]) : Number(today.slice(0, 4));
  return calendarIso(year, month, Number(named[1]));
}

export function decideIntentTurn(input: IntentTurnInput): IntentTurnDecision {
  const saved = input.saved ?? EMPTY_FORM_STATE;
  const reading = parseReading(input.raw);
  const blob = conversationBlob(input);
  const choice = readPriorChoice(input.history, input.question, input.people, input.salons);
  const employee = choice?.person
    ? { person: choice.person, name: displayName(choice.person), ambiguous: [] as readonly GroundedPerson[], typed: null }
    : groundEmployee(reading?.employee ?? null, blob, input.people);
  const salon = groundSalon(choice?.salon ?? reading?.salon ?? null, blob, input.salons, employee.person);
  const title = groundTitle(reading?.title ?? null, blob, input.people, employee.person);
  const incidentType = groundIncident(reading?.incidentType ?? null, blob, input.headings);
  const date = groundDate(choice?.date ?? reading?.incidentDate ?? null, blob, input.today);
  const payrollAmount = groundPayroll(reading?.payrollAmount ?? null, blob);
  const warningLevel = groundWarning(choice?.warning ?? reading?.warningLevel ?? null, blob);
  const formType = groundForm(choice?.form ?? reading?.formType ?? null, blob, input.templates);
  const formTurn = Boolean(input.formInProgress || reading?.formTurn || formType.key || saved.templateKey);

  const state = mergeSlots(saved, {
    employee,
    salon,
    title,
    incidentType,
    date: date.iso,
    payrollAmount,
    warningLevel: warningLevel.value,
    formType: formType.key,
  });

  const clarification = clarificationFor({
    formTurn,
    employee,
    salon,
    title,
    incidentType,
    date,
    payrollAmount,
    warningLevel,
    formType,
    state,
    people: input.people,
    salons: input.salons,
    templates: input.templates,
  });

  if (clarification) return { question: input.question, state, clarification };
  if (!formTurn) return { question: input.question, state, clarification: null };
  return { question: prependFormState(input.question, state), state, clarification: null };
}

function parseReading(raw: unknown): IntentSlotReading | null {
  const parsed = intentSlotSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

function conversationBlob(input: IntentTurnInput): string {
  const prior = input.history.map((turn) => turn.content);
  const saved = input.saved ? stateSentences(input.saved).join(" ") : "";
  return [...prior, input.question, saved].filter((part) => part.trim() !== "").join("\n");
}

function groundEmployee(
  typed: string | null,
  blob: string,
  people: readonly GroundedPerson[],
): { person: GroundedPerson | null; name: string | null; ambiguous: readonly GroundedPerson[]; typed: string | null } {
  const fromText = peopleNamedIn(blob, people);
  const probe = typed?.trim() || (fromText.length === 1 ? displayName(fromText[0]!) : null);
  if (!probe) {
    if (fromText.length > 1) return { person: null, name: null, ambiguous: fromText, typed: displayName(fromText[0]!) };
    return { person: null, name: null, ambiguous: [], typed: null };
  }
  if (people.length === 0) return { person: null, name: probe, ambiguous: [], typed: probe };
  const match = matchEmployeeName(probe, people);
  if (match.kind === "exact") {
    const person = asGrounded(match.employee, people);
    return { person, name: displayName(person), ambiguous: [], typed: probe };
  }
  if (match.kind === "confirm") {
    const rows = match.candidates.map((candidate) => asGrounded(candidate.employee, people));
    const words = probe.split(/\s+/).filter(Boolean);
    if (rows.length === 1 && words.length > 1) {
      return { person: rows[0]!, name: displayName(rows[0]!), ambiguous: [], typed: probe };
    }
    return { person: null, name: null, ambiguous: rows, typed: probe };
  }
  if (match.kind === "unchecked") return { person: null, name: probe, ambiguous: [], typed: probe };
  return { person: null, name: null, ambiguous: [], typed: probe };
}

function peopleNamedIn(blob: string, people: readonly GroundedPerson[]): GroundedPerson[] {
  const haystack = blob.toLowerCase();
  const found: GroundedPerson[] = [];
  for (const person of people) {
    const names = [displayName(person), person.preferredFirstName ? `${person.preferredFirstName} ${person.lastName}` : ""]
      .map((name) => name.trim().toLowerCase())
      .filter((name) => name.includes(" "));
    if (names.some((name) => haystack.includes(name)) && !found.some((row) => row.id === person.id)) found.push(person);
  }
  return found;
}

function asGrounded(employee: RosterEmployee, people: readonly GroundedPerson[]): GroundedPerson {
  return people.find((person) => person.id === employee.id) ?? { ...employee, title: null, primaryLocationName: null };
}

function groundSalon(
  typed: string | null,
  blob: string,
  salons: readonly SalonRow[],
  person: GroundedPerson | null,
): { id: string | null; name: string | null; ambiguous: readonly SalonRow[] } {
  const pool = person && person.salonIds.length > 0 ? salons.filter((salon) => person.salonIds.includes(salon.id)) : salons;
  const list = pool.length > 0 ? pool : salons;
  const probed = typed?.trim() || null;
  const matched = probed ? matchSalons(probed, list) : matchSalonsInText(blob, list);
  if (matched.length === 1) return { id: matched[0]!.id, name: matched[0]!.name, ambiguous: [] };
  if (matched.length > 1) return { id: null, name: null, ambiguous: matched };
  if (person && person.salonIds.length === 1) {
    const only = salons.find((salon) => salon.id === person.salonIds[0]);
    if (only) return { id: only.id, name: only.name, ambiguous: [] };
    if (person.primaryLocationName) return { id: person.salonIds[0]!, name: person.primaryLocationName, ambiguous: [] };
  }
  return { id: null, name: null, ambiguous: [] };
}

function matchSalons(typed: string, salons: readonly SalonRow[]): SalonRow[] {
  const needle = wordsOf(typed);
  if (needle.length === 0) return [];
  const hits = salons.filter((salon) => wordsCover(needle, wordsOf(salon.name)));
  return hits;
}

function matchSalonsInText(blob: string, salons: readonly SalonRow[]): SalonRow[] {
  const haystack = ` ${wordsOf(blob).join(" ")} `;
  return salons.filter((salon) => {
    const words = wordsOf(salon.name).filter((word) => word.length >= 4);
    if (words.length === 0) return false;
    return words.every((word) => haystack.includes(` ${word} `));
  });
}

function groundTitle(
  typed: string | null,
  blob: string,
  people: readonly GroundedPerson[],
  person: GroundedPerson | null,
): string | null {
  if (person?.title) return person.title;
  const titles = [...new Set(people.map((row) => row.title).filter((title): title is string => Boolean(title?.trim())))];
  const probe = typed?.trim() || null;
  if (probe) {
    const hit = titles.find((title) => title.toLowerCase() === probe.toLowerCase());
    if (hit) return hit;
    const close = titles.filter((title) => editDistance(title.toLowerCase(), probe.toLowerCase()) <= 1);
    if (close.length === 1) return close[0]!;
  }
  const inText = titles.filter((title) => blob.toLowerCase().includes(title.toLowerCase()));
  return inText.length === 1 ? inText[0]! : null;
}

function groundIncident(typed: string | null, blob: string, headings: readonly string[]): string | null {
  const fromAccount = headingFromAccount(blob, headings);
  if (fromAccount) return fromAccount;
  if (!typed) return null;
  const exact = headings.find((heading) => headingKey(heading) === headingKey(typed));
  if (exact) return exact;
  const named = headings.filter((heading) => namesHeading(typed, heading));
  return named.length === 1 ? named[0]! : null;
}

/** The manual heading the account describes, and only a heading that was retrieved. */
export function headingFromAccount(text: string, headings: readonly string[]): string | null {
  const keys = describedAttendanceKeys(text);
  if (!keys || headings.length === 0) return null;
  const wanted = sectionHeadingsFor({ offenseKeys: keys, notes: text }).flat();
  for (const heading of wanted) {
    const found = headings.find((item) => headingKey(item) === headingKey(heading));
    if (found) return found;
  }
  return null;
}

function groundDate(
  typed: string | null,
  blob: string,
  today: string,
): { iso: string | null; ambiguous: readonly string[] } {
  const inText = datesInConversation(blob, today);
  const normalized = typed ? normalizeIncidentDate(typed, today) : null;
  if (normalized && inText.includes(normalized)) return { iso: normalized, ambiguous: [] };
  if (inText.length === 1) return { iso: inText[0]!, ambiguous: [] };
  if (inText.length > 1) return { iso: null, ambiguous: inText };
  return { iso: null, ambiguous: [] };
}

function datesInConversation(blob: string, today: string): string[] {
  const found = new Set(datesInText(blob, today).map((item) => item.iso));
  DAY_MONTH.lastIndex = 0;
  for (const match of blob.matchAll(DAY_MONTH)) {
    const iso = dayMonthIso(match, today);
    if (iso) found.add(iso);
  }
  return [...found];
}

function dayMonthIso(match: RegExpMatchArray, today: string): string | null {
  const month = MONTHS[match[2]!.toLowerCase().replace(/\./g, "")];
  if (!month) return null;
  const year = match[3] ? Number(match[3]) : Number(today.slice(0, 4));
  return calendarIso(year, month, Number(match[1]));
}

function groundPayroll(typed: string | null, blob: string): string | null {
  const found = payrollAmounts(blob);
  if (typed) {
    const wanted = canonicalAmount(typed);
    if (wanted && found.includes(wanted)) return wanted;
  }
  return found.length === 1 ? found[0]! : null;
}

export function payrollAmounts(text: string): string[] {
  const found = new Set<string>();
  for (const match of text.matchAll(/\$\s*(\d{1,6}(?:\.\d{1,2})?)/g)) {
    const amount = canonicalAmount(match[1] ?? "");
    if (amount) found.add(amount);
  }
  for (const match of text.matchAll(/\b(\d{1,6}(?:\.\d{1,2})?)\s*(?:dollars|dollar)\b/gi)) {
    const amount = canonicalAmount(match[1] ?? "");
    if (amount) found.add(amount);
  }
  return [...found];
}

function groundWarning(
  typed: "verbal" | "written" | null,
  blob: string,
): { value: "verbal" | "written" | null; ambiguous: boolean } {
  const verbal = /\bverbal\b/i.test(blob);
  const written = /\bwritten\b/i.test(blob);
  if (verbal && written) {
    if (typed === "verbal" || typed === "written") return { value: typed, ambiguous: false };
    return { value: null, ambiguous: true };
  }
  if (verbal) return { value: "verbal", ambiguous: false };
  if (written) return { value: "written", ambiguous: false };
  return { value: null, ambiguous: false };
}

function groundForm(
  typed: string | null,
  blob: string,
  templates: readonly TemplateRow[],
): { key: string | null; ambiguous: readonly TemplateRow[] } {
  const probed = typed?.trim() || null;
  const fromTyped = probed ? matchTemplates(probed, templates) : [];
  if (fromTyped.length === 1) return { key: fromTyped[0]!.key, ambiguous: [] };
  if (fromTyped.length > 1) return { key: null, ambiguous: fromTyped };
  const fromText = templates.filter((template) => blob.toLowerCase().includes(template.name.toLowerCase()));
  if (fromText.length === 1) return { key: fromText[0]!.key, ambiguous: [] };
  if (fromText.length > 1) return { key: null, ambiguous: fromText };
  return { key: null, ambiguous: [] };
}

function matchTemplates(typed: string, templates: readonly TemplateRow[]): TemplateRow[] {
  const needle = typed.toLowerCase().trim();
  const exact = templates.filter((template) => template.key.toLowerCase() === needle || template.name.toLowerCase() === needle);
  if (exact.length > 0) return exact;
  if (needle.length < 4) return [];
  return templates.filter((template) => template.name.toLowerCase().includes(needle) || needle.includes(template.name.toLowerCase()));
}

function mergeSlots(
  prior: ConversationFormState,
  slots: {
    employee: ReturnType<typeof groundEmployee>;
    salon: ReturnType<typeof groundSalon>;
    title: string | null;
    incidentType: string | null;
    date: string | null;
    payrollAmount: string | null;
    warningLevel: "verbal" | "written" | null;
    formType: string | null;
  },
): ConversationFormState {
  const named = slots.employee.name;
  return {
    ...prior,
    employeeId: slots.employee.person?.id ?? prior.employeeId,
    employeeName: slots.employee.person ? displayName(slots.employee.person) : named ?? prior.employeeName,
    salonId: slots.salon.id ?? prior.salonId,
    title: slots.title ?? prior.title,
    formDate: slots.date ?? prior.formDate,
    warningLevel: slots.warningLevel ?? prior.warningLevel,
    payrollDeduct: slots.payrollAmount ? "yes" : prior.payrollDeduct,
    templateKey: slots.formType ?? prior.templateKey,
    incidentType: slots.incidentType ?? prior.incidentType,
    payrollAmount: slots.payrollAmount ?? prior.payrollAmount,
  };
}

function clarificationFor(input: {
  formTurn: boolean;
  employee: ReturnType<typeof groundEmployee>;
  salon: ReturnType<typeof groundSalon>;
  title: string | null;
  incidentType: string | null;
  date: { iso: string | null; ambiguous: readonly string[] };
  payrollAmount: string | null;
  warningLevel: { value: "verbal" | "written" | null; ambiguous: boolean };
  formType: { key: string | null; ambiguous: readonly TemplateRow[] };
  state: ConversationFormState;
  people: readonly GroundedPerson[];
  salons: readonly SalonRow[];
  templates: readonly TemplateRow[];
}): string | null {
  if (input.employee.ambiguous.length > 1 || (input.employee.ambiguous.length === 1 && !input.employee.person)) {
    return personQuestion(input.employee.ambiguous, input.employee.typed, input.salons);
  }
  if (input.salon.ambiguous.length > 1) return salonQuestion(input.salon.ambiguous);
  if (input.date.ambiguous.length > 1) return dateQuestion(input.date.ambiguous);
  if (input.formType.ambiguous.length > 1) return formQuestion(input.formType.ambiguous);
  if (input.warningLevel.ambiguous) {
    return "Which warning level did you mean? Reply with the number.\n1. **verbal**\n2. **written**";
  }
  if (!input.formTurn) return null;

  const missing: string[] = [];
  if (!input.state.employeeName) {
    missing.push(
      input.employee.typed
        ? `which employee — **${input.employee.typed}** is not in the Woven roster`
        : "which employee",
    );
  }
  if (!input.state.salonId) missing.push("which salon");
  if (input.state.employeeName && !input.state.title) missing.push("the job title");
  if (!input.state.incidentType) missing.push("what happened");
  if (!input.state.formDate) missing.push("the date it happened");
  if (!input.state.templateKey) missing.push("which form");
  const corrective = isCorrective(input.state.templateKey, input.templates);
  if (corrective && !input.state.warningLevel) missing.push("the warning level, verbal or written");
  if (corrective && input.state.payrollDeduct === "yes" && !input.state.payrollAmount) missing.push("the payroll amount");
  if (missing.length === 0) return null;
  return `I still need ${joinList(missing)}.`;
}

function isCorrective(key: string | null, templates: readonly TemplateRow[]): boolean {
  if (!key) return false;
  const template = templates.find((item) => item.key === key);
  const name = `${key} ${template?.name ?? ""}`.toLowerCase();
  return name.includes("corrective");
}

function personQuestion(people: readonly GroundedPerson[], typed: string | null, salons: readonly SalonRow[]): string {
  const options = people.map((person, index) => {
    const detail = personDetail(person, salons);
    const label = detail ? `**${displayName(person)}** (${detail})` : `**${displayName(person)}**`;
    return `${index + 1}. ${label}`;
  });
  const who = typed ? ` for **${typed}**` : "";
  return `Which person did you mean${who}? Reply with the number, the salon, or the job title.\n${options.join("\n")}`;
}

function salonQuestion(salons: readonly SalonRow[]): string {
  const options = salons.map((salon, index) => `${index + 1}. **${salon.name}**`);
  return `Which salon did you mean? Reply with the number or the salon.\n${options.join("\n")}`;
}

function dateQuestion(dates: readonly string[]): string {
  const options = dates.map((iso, index) => `${index + 1}. **${slashDate(iso)}**`);
  return `Which date should go on the form? Reply with the number.\n${options.join("\n")}`;
}

function formQuestion(templates: readonly TemplateRow[]): string {
  const options = templates.map((template, index) => `${index + 1}. **${template.name}**`);
  return `Which form did you mean? Reply with the number or the form.\n${options.join("\n")}`;
}

export function personDetail(person: GroundedPerson, salons: readonly SalonRow[]): string | null {
  const names = person.salonIds
    .map((id) => salons.find((salon) => salon.id === id)?.name ?? (person.primaryLocationName && person.salonIds.length === 1 ? person.primaryLocationName : null))
    .filter((name): name is string => Boolean(name));
  const unique = [...new Set(names)];
  const salon = unique.length > 0 ? unique.join(", ") : person.primaryLocationName;
  const detail = [salon, person.title].filter(Boolean).join(", ");
  return detail || null;
}

function readPriorChoice(
  history: readonly { role: string; content: string }[],
  reply: string,
  people: readonly GroundedPerson[],
  salons: readonly SalonRow[],
): { person?: GroundedPerson; salon?: string; date?: string; form?: string; warning?: "verbal" | "written" } | null {
  const asked = [...history].reverse().find((turn) => turn.role === "assistant");
  if (!asked) return null;
  const options = choiceOptions(asked.content);
  if (options.length < 2) return null;
  const index = numberChoice(reply, options.length);
  const detailHits = options.filter((option) => optionMatches(reply, option));
  const picked = index !== null ? options[index] : detailHits.length === 1 ? detailHits[0] : null;
  if (!picked) return null;
  if (asked.content.startsWith("Which salon")) return { salon: picked.label };
  if (asked.content.startsWith("Which date")) return { date: picked.label };
  if (asked.content.startsWith("Which form")) return { form: picked.label };
  if (asked.content.startsWith("Which warning")) {
    const level = picked.label.toLowerCase();
    return level === "verbal" || level === "written" ? { warning: level } : null;
  }
  if (!asked.content.startsWith("Which person")) return null;
  const rows = people.filter((person) => displayName(person).toLowerCase() === picked.label.toLowerCase());
  const person =
    rows.length === 1
      ? rows[0]
      : rows.find((row) => personDetail(row, salons)?.toLowerCase() === picked.detail?.toLowerCase()) ?? null;
  return person ? { person } : null;
}

function choiceOptions(content: string): ChoiceOption[] {
  const options: ChoiceOption[] = [];
  for (const line of content.split("\n")) {
    const match = /^\s*(\d+)\.\s+\*\*([^*]+)\*\*(?:\s+\(([^)]*)\))?/.exec(line);
    if (!match) continue;
    options.push({ label: match[2]!.trim(), detail: match[3]?.trim() || null });
  }
  return options;
}

function numberChoice(reply: string, count: number): number | null {
  const trimmed = reply.trim().toLowerCase();
  const digit = /^(\d+)\b/.exec(trimmed);
  if (digit) {
    const index = Number(digit[1]) - 1;
    return index >= 0 && index < count ? index : null;
  }
  const words = ["first", "second", "third", "fourth", "fifth"];
  const found = words.findIndex((word) => trimmed.startsWith(word));
  return found >= 0 && found < count ? found : null;
}

function optionMatches(reply: string, option: ChoiceOption): boolean {
  const haystack = reply.toLowerCase();
  if (option.detail && option.detail.toLowerCase().split(",").some((part) => part.trim().length > 3 && haystack.includes(part.trim().toLowerCase()))) {
    return true;
  }
  return false;
}

function wordsOf(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((word) => word.length >= 3 && !SMALL.has(word));
}

const SMALL = new Set(["the", "and", "for", "salon", "store"]);

function wordsCover(needle: readonly string[], haystack: readonly string[]): boolean {
  if (needle.length === 0 || haystack.length === 0) return false;
  return needle.every((word) => haystack.some((other) => word === other || (word.length >= 4 && editDistance(word, other) <= 1)));
}

function editDistance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let previous = row[0]!;
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const current = row[j]!;
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min(current + 1, row[j - 1]! + 1, previous + cost);
      previous = current;
    }
  }
  return row[b.length]!;
}

function canonicalAmount(raw: string): string | null {
  const match = /(\d{1,6})(?:\.(\d{1,2}))?/.exec(raw.replace(/,/g, ""));
  if (!match) return null;
  const whole = String(Number(match[1]));
  if (match[2] === undefined) return whole;
  return `${whole}.${match[2].padEnd(2, "0").slice(0, 2)}`;
}

function calendarIso(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1) return null;
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day > days) return null;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function slashDate(iso: string): string {
  const [year, month, day] = iso.split("-");
  if (!year || !month || !day) return iso;
  return `${Number(month)}/${Number(day)}/${year}`;
}

function joinList(items: readonly string[]): string {
  if (items.length === 1) return items[0]!;
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

function blank(value: string | null | undefined): string | null {
  const text = value?.trim() ?? "";
  return text ? text : null;
}
