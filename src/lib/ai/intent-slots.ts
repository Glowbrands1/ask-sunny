import { z } from "zod";

import {
  caTemplateMapEnabled,
  codeSlotsEnabled,
  formChoiceStatedEnabled,
  intentPayrollManagerOnlyEnabled,
  managerWordsOnlyEnabled,
  placeSpanGuardEnabled,
  notANameGuardEnabled,
  titleWholeWordEnabled,
  typedNameProceedsEnabled,
  remapIncidentFixEnabled,
  warningLevelManagerOnlyEnabled,
} from "@/lib/config/chat-quality-flags";
import { payrollDeductAmount, payrollDeductFromConversation, type PayrollDeductAnswer } from "@/lib/forms/payroll-deduct";
import { explicitIncidentIso } from "@/lib/forms/explicit-incident-date";
import { lateOpenOn, newestStatedDate, withYearlessDatesWritten } from "@/lib/forms/late-open";
import { printedPageForPolicy } from "@/lib/forms/printed-policy-pages";
import { PRODUCTION_SALONS } from "@/data/salons";
import { stripFieldLabels } from "@/lib/forms/name-words";
import { isNotAName, maskNotANameText, saidInReply } from "@/lib/forms/not-a-name";
import { cleanPersonName, employeeNamedOnPurpose } from "@/lib/forms/roster-validated-name";
import { datesInText, listIncidentDates, priorSteps } from "@/lib/forms/form-date-answer";
import { displayName, matchEmployeeName, type RosterEmployee } from "@/lib/forms/employee-match";
import { extractEmployeeNames, extractJobTitle, titleAfterJobTitleLabel } from "@/lib/forms/proposal";
import { readPlaceState } from "@/lib/forms/place-state";
import { correctiveActionBasis } from "@/lib/forms/corrective-action-intake";
import {
  detectTemplateIntent,
  mentionsEarlierCoaching,
} from "@/lib/forms/template-intent";
import { labelledSalonIds } from "@/lib/forms/salon-cue";
import { managerStatedWarningLevel, templateHasWarningLevel, warningLevelFromTurns } from "@/lib/forms/warning-level";
import { isDocumentName, isRosterStateName } from "./not-a-person";
import { readsAsStatedTitle, titleTextFromTurns } from "./title-words";
import { titleInWords } from "./title-in-words";
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
import { withoutStateCodes } from "./remap-incident";

/**
 * Slots read off one turn, then kept only when the roster, the salon list,
 * or the manual headings agree.
 *
 * The model copies what the manager said. This file decides what is real.
 * A heading that is not in the headings it was given is dropped. A person
 * who is not on the roster keeps the name the manager typed. That is not an
 * error, and the other slots stay.
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
    policyHeading: z.string().nullable().optional(),
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
    policyHeading: blank(value.policyHeading),
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
    "policyHeading",
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
    policyHeading: {
      type: ["string", "null"],
      description:
        "The one heading from the supplied manual list that this account is about. Null when none of those headings fit. Do not invent a heading.",
    },
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
  /** Printed page of each retrieved heading, keyed by that heading. */
  readonly headingPages?: Readonly<Record<string, number>>;
  readonly templates: readonly TemplateRow[];
  readonly formInProgress: boolean;
}

export interface IntentTurnDecision {
  readonly question: string;
  readonly state: ConversationFormState;
  readonly clarification: string | null;
  /** True when this turn is filing or continuing a form. */
  readonly formTurn: boolean;
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

const BARE_YES_NO = /^(yes|yeah|yep|yup|no|nope)\b[.!]*$/i;

/**
 * A bare yes or no is resolved against pendingConfirmation before the model
 * runs. With nothing pending, the stored slots stay — "Yes" does not clear
 * the employee (s25).
 */
function settleYesNo(question: string, saved: ConversationFormState): ConversationFormState | null {
  if (!BARE_YES_NO.test(question.trim()) || !saved.templateKey) return null;
  const pending = saved.pendingConfirmation ?? null;
  if (!pending) return { ...saved, pendingConfirmation: null };
  const accept = /^(yes|yeah|yep|yup)\b/i.test(question.trim());
  return {
    ...saved,
    employeeName: accept ? pending.candidate : pending.typed,
    pendingConfirmation: null,
  };
}

export function decideIntentTurn(rawInput: IntentTurnInput): IntentTurnDecision {
  const input = withoutUntypedSavedName(rawInput);
  const choiceStated = formChoiceStatedEnabled();
  const saved = choiceStated
    ? withoutDisciplineProcedure(input.saved ?? EMPTY_FORM_STATE)
    : (input.saved ?? EMPTY_FORM_STATE);
  if (codeSlotsEnabled()) {
    const settled = settleYesNo(input.question, saved);
    if (settled) {
      return { question: input.question, state: settled, clarification: null, formTurn: true };
    }
  }
  const reading = parseReading(input.raw);
  const blob = conversationBlob(input);
  const choice = readPriorChoice(input.history, input.question, input.people, input.salons);
  const employee = choice?.person
    ? { person: choice.person, name: displayName(choice.person), ambiguous: [] as readonly GroundedPerson[], typed: null }
    : groundEmployee(
        codeSlotsEnabled() ? null : reading?.employee ?? null,
        blob,
        input.people,
        input.salons,
        notANameGuardEnabled() ? managerTurns(input) : null,
      );
  const userText = [input.question, ...input.history.filter((turn) => turn.role !== "assistant").map((turn) => turn.content)]
    .filter((part) => part.trim() !== "")
    .join("\n");
  const salon =
    newestTurnSalon(input.question, input.salons) ??
    groundSalon(choice?.salon ?? reading?.salon ?? null, userText, input.salons, employee.person);
  // The manager's turns only: a pasted policy is not their words, and
  // "ass't salon director" is read as the assistant title.
  const managerTitleText = managerWordsOnlyEnabled()
    ? titleTextFromTurns([input.question, ...input.history.filter((turn) => turn.role !== "assistant").map((turn) => turn.content)])
    : userText;
  // REMAP_INCIDENT_FIX_ENABLED: "empire, sd" is a place and its state, not Salon Director.
  const titleText = remapIncidentFixEnabled() ? withoutStateCodes(managerTitleText) : managerTitleText;
  const title = groundTitle(reading?.title ?? null, titleText, input.people, employee.person, employee.name ?? employee.typed);
  const groundedIncident = groundIncident(reading?.incidentType ?? null, blob, input.headings);
  const incidentType = choiceStated && isDisciplineProcedure(groundedIncident) ? null : groundedIncident;
  /*
   * LATE_OPEN_DATE_ENABLED (QA, 24 Oct 2026): "late to open 10-19" and
   * "change the date to 10-22" are dates, and the one this turn states dates
   * the form ahead of the saved one. See `late-open.ts`.
   */
  const lateOpen = lateOpenOn();
  const dateQuestion = lateOpen ? withYearlessDatesWritten(input.question, input.today) : input.question;
  const dateText = lateOpen ? withYearlessDatesWritten(userText, input.today) : userText;
  const statedNow =
    lateOpen && !choice?.date ? newestStatedDate(input.question, input.today, explicitIncidentIso) : null;
  const groundedDate = statedNow
    ? { iso: statedNow, ambiguous: [] as readonly string[] }
    : groundDate(choice?.date ?? reading?.incidentDate ?? null, dateQuestion, dateText, input.today);
  const date = codeSlotsEnabled()
    ? { iso: explicitIncidentIso(dateQuestion, input.today) ?? saved.formDate, ambiguous: [] as readonly string[] }
    : groundedDate;
  const managerOnly = intentPayrollManagerOnlyEnabled();
  // The manager's Yes/No, never an assistant turn's: "payroll deduct is not
  // applicable" is No in the saved state too (LATE_OPEN_DATE_ENABLED).
  const payrollAnswer =
    managerOnly || lateOpen
      ? payrollDeductFromConversation([...input.history, { role: "user", content: input.question }])
      : null;
  const payrollAmount = !managerOnly
    ? lateOpen && payrollAnswer === "no"
      ? null
      : groundPayroll(reading?.payrollAmount ?? null, blob)
    : payrollAnswer === "no"
      ? null
      : (payrollClauseAmount(input) ??
        (payrollAnswer === "yes" ? groundPayroll(reading?.payrollAmount ?? null, managerBlob(input)) : null));
  const formType: { key: string | null; ambiguous: readonly TemplateRow[]; together?: boolean } = choiceStated
    ? groundStatedForm(
        choice?.form ?? null,
        managerSaidTurns(input),
        input.templates,
        saved.templateKey ? null : (reading?.formType ?? null),
        saved.templateKey,
      )
    : groundForm(choice?.form ?? reading?.formType ?? null, blob, input.templates, {
        question: input.question,
        managerText: managerBlob(input),
      });
  const groundedPolicy = groundPolicy(reading?.policyHeading ?? null, input.headings);
  const modelPolicy = choiceStated && isDisciplineProcedure(groundedPolicy) ? null : groundedPolicy;
  /*
   * THE MANAGER'S LEVEL ONLY (WARNING_LEVEL_MANAGER_ONLY_ENABLED). Live
   * replays, 24 Oct 2026: the blob holds Ask Sunny's own "You'll set the
   * verbal/written warning level", and the slot model's guess was taken as
   * given, so "for Test Employee" and a bare "Yes" came back "Written Warning,
   * as you said". With the flag, the level is a numbered choice the manager
   * just made, or what their own turns state — nothing else.
   */
  const warningManagerOnly = warningLevelManagerOnlyEnabled();
  const warningLevel = warningManagerOnly
    ? {
        value:
          choice?.warning ?? managerStatedWarningLevel([...input.history, { role: "user", content: input.question }]),
        ambiguous: false,
      }
    : groundWarning(choice?.warning ?? reading?.warningLevel ?? null, blob);
  // A heading already grounded stays. The account reader fills one in only
  // when this conversation has not chosen one, so a resend does not replace
  // Late Opening with the broader Attendance section.
  const policyHeading = modelPolicy ?? saved.policyHeading ?? incidentType;
  const policyPage = codeSlotsEnabled()
    ? pageForHeading(policyHeading, input.headingPages) ?? saved.policyPage ?? printedPageForPolicy(policyHeading)
    : modelPolicy
      ? pageForHeading(modelPolicy, input.headingPages)
      : saved.policyHeading
        ? saved.policyPage
        : pageForHeading(policyHeading, input.headingPages);
  const formTurn = Boolean(input.formInProgress || reading?.formTurn || formType.key || saved.templateKey);

  const salonForMerge = codeSlotsEnabled() && salon.ambiguous.length > 1
    ? { id: salon.id, name: salon.name, ambiguous: [] as readonly SalonRow[] }
    : salon;
  const employeeForMerge = codeSlotsEnabled()
    ? { ...employee, ambiguous: [] as readonly GroundedPerson[] }
    : employee;

  let state = mergeSlots(saved, {
    employee: employeeForMerge,
    salon: salonForMerge,
    title,
    incidentType,
    date: date.iso,
    payrollAmount,
    payrollAnswer,
    managerOnly,
    managerAnswer: lateOpen,
    warningLevel: warningLevel.value,
    formType: formType.key,
    policyHeading,
    policyPage,
  });
  if (choiceStated) state = firstCoachingUnlessEarlier(state, managerSaidTurns(input), input.templates);
  if (warningManagerOnly) {
    const answered = payrollAnsweredNow(input.history, input.question);
    if (answered) state = { ...state, payrollDeduct: answered };
    /*
     * RE-READ EVERY TURN, AND ONLY FOR A FORM WITH A TYPE OF WARNING. QA, 24
     * Oct 2026: a level stored once (from the assistant's own words) came back
     * on every later turn, beat "this is a verbal", and rode onto a
     * Resignation/Exit Form and a Policy Review. The level is what the
     * manager's turns state now; the stored one is kept only when the history
     * may have been cut (the route keeps the last HISTORY_CAP turns), so a
     * level stated before that is not lost.
     */
    const template = input.templates.find((row) => row.key === state.templateKey) ?? null;
    const kept = warningLevel.value ?? (input.history.length >= HISTORY_CAP ? saved.warningLevel : null);
    const level = templateHasWarningLevel(template ?? { key: state.templateKey }) ? kept : null;
    if (level !== state.warningLevel) state = { ...state, warningLevel: level };
  }
  if (codeSlotsEnabled()) {
    const salonNames = PRODUCTION_SALONS.map((salon) => salon.name);
    const prior = cleanPersonName(saved.employeeName, salonNames);
    const named = employeeNamedOnPurpose(input.question, prior, input.people, salonNames);
    const employeeName = named ?? prior ?? cleanPersonName(state.employeeName, salonNames);
    if (employeeName !== state.employeeName) state = { ...state, employeeName };
  }

  const clarification = clarificationFor({
    formTurn,
    employee: employeeForMerge,
    salon: salonForMerge,
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

  const question = formTurn ? questionWithState(input.question, state, input.templates) : input.question;
  // FORM_CHOICE_STATED_ENABLED: two forms in one turn is a question, not a
  // card. A form turn otherwise keeps its card, and the proposal would pick
  // one of the two on its own.
  if (clarification && formType.together) return { question, state, clarification, formTurn: false };
  if (clarification) return { question, state, clarification, formTurn };
  if (!formTurn) return { question, state, clarification: null, formTurn: false };
  return { question, state, clarification: null, formTurn: true };
}

/** `LIMITS.historyTurns` in `lib/api/validation.ts` (server-only, so not imported here). */
const HISTORY_CAP = 20;

/** Another yes/no question beside the payroll one: "Did you mean **Rowan Testo**?". */
const OTHER_YES_NO =
  /^\s*(?:did\s+you\s+mean|is|isn'?t|are|was|should|shall|do|does|did|will|would|can|could)\b/i;

/**
 * "Yes" / "No" ANSWERING "Is payroll deduct applicable? Yes or No?" — read
 * here, while the reply is still bare. Live replay, 24 Oct 2026: once the
 * stored slots are put ahead of it ("The form is the Corrective Action Form.
 * The employee is … Yes") the reply is no longer a bare answer, and the card
 * asked the payroll question again. Only the assistant turn right before it
 * counts, and only when that turn asks no other yes/no question, so the "Yes"
 * that confirms a name is never a payroll answer. Behind
 * WARNING_LEVEL_MANAGER_ONLY_ENABLED.
 */
function payrollAnsweredNow(
  history: readonly { role: string; content: string }[],
  question: string,
): "yes" | "no" | null {
  const before = history[history.length - 1];
  if (!before || before.role !== "assistant") return null;
  const questions = (before.content.replace(/[*_`]/g, "").match(/[^.!?\n]*\?/g) ?? [])
    .map((line) => line.trim())
    .filter((line) => !/payroll/i.test(line) && !/^yes\s+or\s+no\?$/i.test(line));
  // An either/or ("a Verbal Warning or a Written Warning?") is not answered by "Yes", as payroll-deduct.ts reads it too.
  if (questions.some((line) => OTHER_YES_NO.test(line) && !/\bor\b/i.test(line))) return null;
  return payrollDeductFromConversation(
    [
      { role: "assistant", content: before.content },
      { role: "user", content: question },
    ],
    { fromThisForm: true },
  );
}

/**
 * The stored slots, then the published form's own name, ahead of this turn.
 * A reply of "1" does not repeat the form, and the proposal reader only
 * sees what the question says.
 */
function questionWithState(
  question: string,
  state: ConversationFormState,
  templates: readonly TemplateRow[],
): string {
  const named = prependFormState(question, state);
  const template = state.templateKey ? templates.find((item) => item.key === state.templateKey) : undefined;
  if (!template) return named;
  if (named.toLowerCase().includes(template.name.toLowerCase())) return named;
  return `The form is the ${template.name}.\n${named}`;
}

function pageForHeading(heading: string | null, pages: Readonly<Record<string, number>> | undefined): number | null {
  if (!heading || !pages) return null;
  if (pages[heading] && pages[heading]! > 0) return pages[heading]!;
  const key = headingKey(heading);
  for (const [name, page] of Object.entries(pages)) {
    if (headingKey(name) === key && page > 0) return page;
  }
  return null;
}

/** A retrieved heading the model named, or null when that heading was not retrieved. */
function groundPolicy(typed: string | null, headings: readonly string[]): string | null {
  // "Warning" is a retirement notice in the manual, not a policy heading.
  if (!typed || headings.length === 0 || headingKey(typed) === "warning") return null;
  const exact = headings.find((heading) => headingKey(heading) === headingKey(typed));
  if (exact) return exact;
  const named = headings.filter((heading) => namesHeading(typed, heading));
  return named.length === 1 ? named[0]! : null;
}

/**
 * FORM_CHOICE_STATED_ENABLED. "Disciplinary Action" is the manual's discipline
 * procedure itself, never the policy an offense broke. Accepting it for
 * "performance concern" or "missing the woven deadline" wrote "Policy
 * reference: Disciplinary Action" onto the turn: its alias picked the
 * Corrective Action Form over the Coaching Form the manager asked for, and
 * the card cited page 14 while the reply named Standards of Conduct (QA,
 * 24 Oct 2026).
 */
function isDisciplineProcedure(heading: string | null | undefined): boolean {
  return Boolean(heading) && /^disciplinary actions?(?: policy)?$/.test(headingKey(heading!));
}

function withoutDisciplineProcedure(state: ConversationFormState): ConversationFormState {
  const policy = isDisciplineProcedure(state.policyHeading);
  const incident = isDisciplineProcedure(state.incidentType);
  if (!policy && !incident) return state;
  return {
    ...state,
    policyHeading: policy ? null : state.policyHeading,
    policyPage: policy ? null : state.policyPage,
    incidentType: incident ? null : state.incidentType,
  };
}

/**
 * The manager's own turns, oldest first, this one last. Unlike managerTurns
 * (NOT_A_NAME_GUARD_ENABLED), the stored state's sentences are left out: they
 * carry the form already on the card, which must never choose the form.
 */
function managerSaidTurns(input: IntentTurnInput): string[] {
  return [...input.history.filter((turn) => turn.role === "user").map((turn) => turn.content), input.question].filter(
    (part) => part.trim() !== "",
  );
}

/**
 * FORM_CHOICE_STATED_ENABLED. The form the manager named, newest turn first.
 *
 * Read from their own words only. The assistant's "**Corrective Action
 * Form**", the stored state's sentences and the model's formType (which
 * copies either) never choose it: "Create a coaching form for a performance
 * concern" stayed a Corrective Action for every later turn because the blob
 * held the assistant's reply (QA, 24 Oct 2026). A turn that names no form
 * ("Create a form from this conversation") looks further back; a turn that
 * names one replaces the stored form. When no manager turn names a form, the
 * stored form stays, and only then does the model's formType count — read as
 * a template name, never from the blob.
 *
 * In a coaching conversation the model's formType never picks the Corrective
 * Action Form; the manager asks for one in their own words ("create a CA", "a
 * verbal warning", "write her up" — formNamedIn reads those). QA round 12, 25
 * Oct 2026 (conv_mvnmetao241awxn): "Help me prepare for a coaching
 * conversation." then "I have an employee that is not verifying documents are
 * signed" was a Corrective Action card on every turn, though the manager only
 * ever asked for coaching and a Policy Review.
 *
 * One turn carries one card. A turn that names two forms ("a coaching form
 * and a policy review? I'd like to see both") asks which to start with; the
 * stored form, once the manager picks, answers that turn from then on.
 */
function groundStatedForm(
  chosen: string | null,
  turns: readonly string[],
  templates: readonly TemplateRow[],
  modelForm: string | null,
  storedKey: string | null,
): { key: string | null; ambiguous: readonly TemplateRow[]; together?: boolean } {
  const picked = chosen ? matchTemplates(chosen, templates) : [];
  if (picked.length === 1) return { key: picked[0]!.key, ambiguous: [] };
  for (let at = turns.length - 1; at >= 0; at -= 1) {
    const several = formsNamedTogether(turns[at]!, templates);
    if (several.length > 1) {
      if (at < turns.length - 1 && storedKey) return { key: null, ambiguous: [] };
      return { key: null, ambiguous: several, together: true };
    }
    const key = formNamedIn(turns[at]!, templates);
    if (key) return { key, ambiguous: [] };
  }
  const typed = modelForm?.trim() ? matchTemplates(modelForm.trim(), templates) : [];
  const key = typed.length === 1 && !(typed[0]!.key === "dpoa" && coachingConversation(turns)) ? typed[0]!.key : null;
  return { key, ambiguous: [] };
}

/**
 * FORM_CHOICE_STATED_ENABLED. The manager is talking about coaching ("a
 * coaching conversation", "coach an employee") and mentions no coaching that
 * already happened. The model's Corrective Action Form does not count here.
 */
function coachingConversation(turns: readonly string[]): boolean {
  return turns.some((turn) => /\bcoach(?:ing)?\b/i.test(turn)) && !turns.some((turn) => mentionsEarlierCoaching(turn));
}

/**
 * FORM_CHOICE_STATED_ENABLED. The forms one turn asks for together: "a
 * coaching form and a policy review", "a coaching form, plus a policy
 * review". Each part is read on its own; fewer than two forms is none.
 */
function formsNamedTogether(text: string, templates: readonly TemplateRow[]): TemplateRow[] {
  const parts = text.split(/,|&|\band\b|\bplus\b|\bas well as\b/i).filter((part) => part.trim() !== "");
  if (parts.length < 2) return [];
  const keys = new Set<string>();
  for (const part of parts) {
    const key = formNamedIn(part, templates);
    if (key) keys.add(key);
  }
  return keys.size > 1 ? templates.filter((template) => keys.has(template.key)) : [];
}

/**
 * FORM_CHOICE_STATED_ENABLED. The Follow-Up Coaching Form only when a manager
 * turn mentions coaching that already happened or a follow-up; otherwise the
 * Coaching Form. A stored follow-up key from an earlier turn is corrected the
 * same way (QA, 25 Oct 2026: conv_mvnbbhdq2a8t7nk).
 */
function firstCoachingUnlessEarlier(
  state: ConversationFormState,
  turns: readonly string[],
  templates: readonly TemplateRow[],
): ConversationFormState {
  if (state.templateKey !== "follow-up-coaching") return state;
  if (turns.some((turn) => mentionsEarlierCoaching(turn))) return state;
  return templates.some((template) => template.key === "coaching") ? { ...state, templateKey: "coaching" } : state;
}

function formNamedIn(text: string, templates: readonly TemplateRow[]): string | null {
  const intent = detectTemplateIntent(text);
  const named = publishedKey(intent, templates);
  if (named) return named;
  // "create a CA", "create a Verbal CA for …": a corrective action asked for
  // in this turn is the Corrective Action Form, as the proposal reads it.
  if (intent.kind === "corrective_action" && intent.requestedCreation) {
    return templates.some((template) => template.key === "dpoa") ? "dpoa" : null;
  }
  if (intent.kind !== "none") return null;
  const lower = text.toLowerCase();
  const byName = templates.filter((template) => lower.includes(template.name.toLowerCase()));
  return byName.length === 1 ? byName[0]!.key : null;
}

function parseReading(raw: unknown): IntentSlotReading | null {
  const parsed = intentSlotSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/**
 * The manager's own words this conversation. The assistant's turns quote
 * policy figures that the manager never stated, and the saved state may
 * already hold one of those figures.
 */
function managerBlob(input: IntentTurnInput): string {
  const said = input.history.filter((turn) => turn.role === "user").map((turn) => turn.content);
  return [...said, input.question].filter((part) => part.trim() !== "").join("\n");
}

/**
 * The latest amount the manager stated for the deduction itself ("payroll
 * deduct $25", "deduct $40", "$25 will be payroll deducted"). A shortage
 * ("register short $40") is not a deduction.
 */
function payrollClauseAmount(input: IntentTurnInput): string | null {
  const said = [...input.history.filter((turn) => turn.role === "user").map((turn) => turn.content), input.question];
  for (let at = said.length - 1; at >= 0; at -= 1) {
    const stated = payrollDeductAmount(said[at] ?? "");
    if (stated) return canonicalAmount(stated);
  }
  return null;
}

/**
 * NOT_A_NAME_GUARD_ENABLED: a saved employee that came from a reply is not
 * kept. QA L23 (conv_mvnjp3362vbremz): "One Tanner", read from the manual
 * heading in an assistant reply, was saved, and "The employee is One
 * Tanner." then outvoted "Test Employee" on every later turn.
 *
 * Only on evidence: the name is not a name at all ("blank"), or an
 * assistant turn in the window says it (other than as a card's subject,
 * `saidInReply`) and none of the manager's turns do. History is
 * capped (`HISTORY_CAP`), so a name typed long ago may be outside the window;
 * with no evidence either way the saved name stays. A roster pick (it
 * carries the directory id) is the manager's choice and stays.
 */
function withoutUntypedSavedName(input: IntentTurnInput): IntentTurnInput {
  const name = input.saved?.employeeName ?? null;
  if (!notANameGuardEnabled() || !input.saved || !name || input.saved.employeeId) return input;
  const said = [...input.history.filter((turn) => turn.role === "user").map((turn) => turn.content), input.question];
  const replies = input.history.filter((turn) => turn.role === "assistant").map((turn) => turn.content);
  const fromReply = !saidBy(said, name) && saidInReply(replies, name);
  if (!isNotAName(name) && !fromReply) return input;
  return { ...input, saved: { ...input.saved, employeeName: null, keptTypedName: null } };
}

/**
 * NOT_A_NAME_GUARD_ENABLED: the turns a name may come from — the manager's
 * own, one at a time, and the stored state. The assistant's replies are not
 * the manager's words: its "…require practice, set a follow-up…" became the
 * employee, and a turn ending "…EFT's and spa" joined to the reply's "Here is
 * what I would put…" read as "spa Here" (QA round 4, 24 Oct 2026).
 */
function managerTurns(input: IntentTurnInput): string[] {
  const said = input.history.filter((turn) => turn.role === "user").map((turn) => turn.content);
  const saved = input.saved ? stateSentences(input.saved).join(" ") : "";
  return [...said, input.question, saved].filter((part) => part.trim() !== "");
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
  salons: readonly SalonRow[] = [],
  manager: readonly string[] | null = null,
): { person: GroundedPerson | null; name: string | null; ambiguous: readonly GroundedPerson[]; typed: string | null } {
  const fromText = peopleNamedIn(blob, people);
  // The guard keeps a name the model copied from an assistant reply, or a
  // placeholder like "blank", off the card: it must be in the manager's words.
  if (manager && typed?.trim() && (isNotAName(typed) || !saidBy(manager, typed))) typed = null;
  const extracted = typed?.trim()
    ? []
    : (manager ? namesInTurns(manager) : extractEmployeeNames(blob)).filter(
        (name) =>
          name.trim().split(/\s+/).length >= 2 && !isDocumentName(name) && !isRosterStateName(name),
      );
  const rawProbe = typed?.trim() || (fromText.length === 1 ? displayName(fromText[0]!) : null) || (extracted.length === 1 ? extracted[0]! : null);
  const probe = rawProbe ? stripFieldLabels(rawProbe) : null;
  if (!probe) {
    if (fromText.length > 1) {
      const toldApart = personAtNamedSalon(fromText, blob, salons);
      if (toldApart) return { person: toldApart, name: displayName(toldApart), ambiguous: [], typed: displayName(toldApart) };
      return { person: null, name: null, ambiguous: fromText, typed: displayName(fromText[0]!) };
    }
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
    // One close roster match can still supply the salon. The name stays as typed.
    if (typedNameProceedsEnabled()) {
      return { person: rows.length === 1 ? rows[0]! : null, name: probe, ambiguous: [], typed: probe };
    }
    const words = probe.split(/\s+/).filter(Boolean);
    if (rows.length === 1 && words.length > 1) {
      return { person: rows[0]!, name: displayName(rows[0]!), ambiguous: [], typed: probe };
    }
    const toldApart = personAtNamedSalon(rows, blob, salons);
    if (toldApart) return { person: toldApart, name: displayName(toldApart), ambiguous: [], typed: probe };
    return { person: null, name: null, ambiguous: rows, typed: probe };
  }
  if (match.kind === "unchecked") return { person: null, name: probe, ambiguous: [], typed: probe };
  // Nobody on the roster is close. The name the manager typed still stands.
  return { person: null, name: probe, ambiguous: [], typed: probe };
}

/** The name is in the manager's words, outside a bulleted or priced offer list. */
function saidBy(turns: readonly string[], name: string): boolean {
  const needle = name.trim().toLowerCase().replace(/\s+/g, " ");
  return turns.some((turn) => maskNotANameText(turn).toLowerCase().replace(/\s+/g, " ").includes(needle));
}

/** Each turn read on its own, so two turns never join into one name. One spelling each. */
function namesInTurns(turns: readonly string[]): string[] {
  const found: string[] = [];
  for (const turn of turns) {
    for (const name of extractEmployeeNames(turn)) {
      if (!found.some((kept) => kept.toLowerCase() === name.toLowerCase())) found.push(name);
    }
  }
  return found;
}

/** One salon named in the account picks the one person who works there. */
function personAtNamedSalon(
  people: readonly GroundedPerson[],
  blob: string,
  salons: readonly SalonRow[],
): GroundedPerson | null {
  const named = matchSalonsInText(blob, salons);
  if (named.length !== 1) return null;
  const salonId = named[0]!.id;
  const at = people.filter((person) => person.salonIds.includes(salonId) || person.primarySalonId === salonId);
  return at.length === 1 ? at[0]! : null;
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
  return people.find((person) => person.id === employee.id) ?? { ...employee, title: null, primaryLocationName: null, primarySalonId: null };
}

/*
 * PLACE_SPAN_GUARD_ENABLED. The salon this turn names wins over the one the
 * conversation saved: "location st joe" after "salon is wornall" is St
 * Joseph (QA Round 4, 24 Oct 2026). A field label counts as the place cue
 * (`salon-cue.ts`). Off, or when this turn names no single salon, the
 * salon is grounded as before.
 */
function newestTurnSalon(
  question: string,
  salons: readonly SalonRow[],
): { id: string; name: string; ambiguous: readonly SalonRow[] } | null {
  if (!placeSpanGuardEnabled()) return null;
  const ids = labelledSalonIds(question);
  if (ids.length !== 1) return null;
  const row = salons.find((salon) => salon.id === ids[0]);
  return row ? { id: row.id, name: row.name, ambiguous: [] } : null;
}

function groundSalon(
  typed: string | null,
  blob: string,
  salons: readonly SalonRow[],
  person: GroundedPerson | null,
): { id: string | null; name: string | null; ambiguous: readonly SalonRow[] } {
  // "at Dodge, NE" is the one salon in that state whose name contains the
  // place. A place in a roster state that matches none is unknown: do not
  // fall through to the Woven primary.
  const place = readPlaceState(blob);
  if (place.kind === "one") return { id: place.salon.id, name: place.salon.name, ambiguous: [] };
  // The salon the manager named wins over a model slot and over the Woven
  // primary. "Primary salon is …" names the home salon; the other salon in
  // that same account is where it happened.
  const incident = salonBesidesPrimary(blob, salons);
  if (incident) return { id: incident.id, name: incident.name, ambiguous: [] };
  const named = matchSalonsInText(blob, salons);
  if (named.length === 1) return { id: named[0]!.id, name: named[0]!.name, ambiguous: [] };
  if (named.length > 1) {
    const latest = latestUniqueSalon(blob, salons);
    if (latest) return { id: latest.id, name: latest.name, ambiguous: [] };
    return { id: null, name: null, ambiguous: named };
  }
  // The model slot and the Woven primary are not a store the manager named.
  if (place.kind === "unknown") return { id: null, name: null, ambiguous: [] };
  const probed = typed?.trim() || null;
  if (probed) {
    const matched = matchSalons(probed, salons);
    if (matched.length === 1) return { id: matched[0]!.id, name: matched[0]!.name, ambiguous: [] };
    if (matched.length > 1) return { id: null, name: null, ambiguous: matched };
  }
  if (!person) return { id: null, name: null, ambiguous: [] };
  const primary = wovenPrimary(person, salons);
  if (primary) return { id: primary.id, name: primary.name, ambiguous: [] };
  if (person.salonIds.length === 1) {
    const only = salons.find((salon) => salon.id === person.salonIds[0]);
    if (only) return { id: only.id, name: only.name, ambiguous: [] };
    if (person.primaryLocationName) return { id: person.salonIds[0]!, name: person.primaryLocationName, ambiguous: [] };
  }
  return { id: null, name: null, ambiguous: [] };
}

/** The salon that is not the one introduced as "primary salon is …". */
function salonBesidesPrimary(text: string, salons: readonly SalonRow[]): SalonRow | null {
  const stripped = text.replace(/\bprimary\s+salon\s+is\s+[^.\n]+/gi, " ");
  if (stripped === text) return null;
  const hits = matchSalonsInText(stripped, salons);
  return hits.length === 1 ? hits[0]! : null;
}

function wovenPrimary(person: GroundedPerson, salons: readonly SalonRow[]): SalonRow | null {
  if (person.primarySalonId) {
    const row = salons.find((salon) => salon.id === person.primarySalonId);
    if (row) return row;
  }
  if (!person.primaryLocationName) return null;
  const hits = matchSalons(person.primaryLocationName, salons);
  return hits.length === 1 ? hits[0]! : null;
}

function matchSalons(typed: string, salons: readonly SalonRow[]): SalonRow[] {
  const needle = wordsOf(typed);
  if (needle.length === 0) return [];
  const hits = salons.filter((salon) => wordsCover(needle, wordsOf(salon.name)));
  return hits;
}

function latestUniqueSalon(text: string, salons: readonly SalonRow[]): SalonRow | null {
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  // The blob is the current question, then older history. The question is the
  // latest line, so it is checked first.
  const chronological = lines.length > 1 ? [...lines.slice(1), lines[0]!] : lines;
  for (let index = chronological.length - 1; index >= 0; index -= 1) {
    const matched = matchSalonsInText(chronological[index]!, salons);
    if (matched.length === 1) return matched[0]!;
  }
  return null;
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
  employeeName: string | null = null,
): string | null {
  // The title reader is most-specific first. A roster title contained in a
  // longer one ("salon director" inside "assistant salon director") is not
  // what the manager stated.
  const labelled = titleAfterJobTitleLabel(blob);
  if (labelled) return extractJobTitle(labelled) ?? labelled;
  const stated = extractJobTitle(blob);
  if (stated) return stated;
  if (person?.title) return person.title;
  const titles = [...new Set(people.map((row) => row.title).filter((title): title is string => Boolean(title?.trim())))];
  // TITLE_WHOLE_WORD_ENABLED: a directory title is stated only as a whole
  // word in the manager's turns, and a title the model typed only when those
  // turns carry it (see `titleInWords`).
  const wholeWord = titleWholeWordEnabled();
  const inWords = (title: string) => !wholeWord || titleInWords(title, blob);
  const probe = typed?.trim() && inWords(typed.trim()) ? typed.trim() : null;
  if (probe) {
    const hit = titles.find((title) => title.toLowerCase() === probe.toLowerCase() && inWords(title));
    if (hit) return hit;
    const close = titles.filter((title) => editDistance(title.toLowerCase(), probe.toLowerCase()) <= 1);
    if (close.length === 1) return close[0]!;
  }
  const inText = titles.filter((title) =>
    wholeWord ? titleInWords(title, blob) : blob.toLowerCase().includes(title.toLowerCase()),
  );
  if (inText.length === 1) return inText[0]!;
  // A title the manager stated stays, even when this person is not on the roster.
  if (probe && managerWordsOnlyEnabled()) {
    return readsAsStatedTitle({ probe, text: blob, employeeName, knownTitle: extractJobTitle }) ? probe : null;
  }
  if (probe && blob.toLowerCase().includes(probe.toLowerCase())) return probe;
  return null;
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

/**
 * "today" is the form's date when the other dates are earlier steps. A prior
 * step's date, and any date listed after it in that same account, is history.
 */
function dateSaidAsToday(text: string, question: string, today: string): string | null {
  if (!/\btodays?\b/i.test(question)) return null;
  const steps = priorSteps(text, today);
  if (steps.length === 0) {
    if (listIncidentDates(text, today).length === 0 && datesInText(question, today).length === 0) return today;
    return null;
  }
  const foundAt = steps
    .map((step) => text.toLowerCase().indexOf(step.named.toLowerCase()))
    .filter((index) => index >= 0);
  if (foundAt.length === 0) return null;
  const first = Math.min(...foundAt);
  const later = new Set(datesInText(text, today).filter((found) => found.index > first).map((found) => found.iso));
  const prior = new Set(steps.map((step) => step.iso));
  const live = listIncidentDates(text, today).filter((found) => !prior.has(found.iso) && !later.has(found.iso));
  return live.length === 0 ? today : null;
}

function groundDate(
  typed: string | null,
  question: string,
  blob: string,
  today: string,
): { iso: string | null; ambiguous: readonly string[] } {
  // Follow-up dates stay off this list. One incident date is the form's date
  // even when a follow-up date is written beside it.
  const inText = [...new Set(listIncidentDates(blob, today).map((item) => item.iso))];
  const normalized = typed ? normalizeIncidentDate(typed, today) : null;
  if (normalized && inText.includes(normalized)) return { iso: normalized, ambiguous: [] };
  if (inText.length === 1) return { iso: inText[0]!, ambiguous: [] };
  if (inText.length > 1) {
    const todayDate = dateSaidAsToday(blob, question, today);
    if (todayDate) return { iso: todayDate, ambiguous: [] };
    return { iso: null, ambiguous: inText };
  }
  // "1 October 2026" is a real date the day-first reader accepts and the
  // incident list does not. It counts only when those words are in the
  // conversation, so a date the tool invented still drops.
  const said = typed ? blob.toLowerCase().includes(typed.trim().toLowerCase()) : false;
  if (normalized && said) return { iso: normalized, ambiguous: [] };
  // "todays date" is the form's date. "today" without the s is the same
  // word; a later turn keeps it because the stored date is already set.
  if (inText.length === 0) {
    const saidToday = dateSaidAsToday(blob, question, today);
    if (saidToday) return { iso: saidToday, ambiguous: [] };
  }
  return { iso: null, ambiguous: [] };
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
  // A prior "Verbal CA" beside the level being issued is history. Both words
  // in the account are not a question, and the card is not held for one.
  const turns = blob.split("\n").map((line) => line.trim()).filter(Boolean);
  const stated = warningLevelFromTurns(turns);
  if (stated) return { value: stated, ambiguous: false };
  if (typed === "verbal" || typed === "written") return { value: typed, ambiguous: false };
  const verbal = /\bverbal\b/i.test(blob);
  const written = /\bwritten\b/i.test(blob);
  if (verbal && !written) return { value: "verbal", ambiguous: false };
  if (written && !verbal) return { value: "written", ambiguous: false };
  return { value: null, ambiguous: false };
}

function groundForm(
  typed: string | null,
  blob: string,
  templates: readonly TemplateRow[],
  turn?: { readonly question: string; readonly managerText: string },
): { key: string | null; ambiguous: readonly TemplateRow[] } {
  const probed = typed?.trim() || null;
  const fromTyped = probed ? matchTemplates(probed, templates) : [];
  if (fromTyped.length === 1) return { key: fromTyped[0]!.key, ambiguous: [] };
  if (fromTyped.length > 1) return { key: null, ambiguous: fromTyped };
  const requested = turn && caTemplateMapEnabled() ? correctiveActionRequestKey(turn, templates) : null;
  if (requested) return { key: requested, ambiguous: [] };
  // "CA", "coaching", and "exit" are the words managers type. The form
  // reader already maps those onto a published template. A short word is
  // not a reason to ask which form again.
  const fromShorthand = publishedKey(detectTemplateIntent(probed || blob), templates)
    ?? publishedKey(detectTemplateIntent(blob), templates);
  if (fromShorthand) return { key: fromShorthand, ambiguous: [] };
  const fromText = templates.filter((template) => blob.toLowerCase().includes(template.name.toLowerCase()));
  if (fromText.length === 1) return { key: fromText[0]!.key, ambiguous: [] };
  if (fromText.length > 1) return { key: null, ambiguous: fromText };
  return { key: null, ambiguous: [] };
}

/** The Corrective Action Form's library key; the template reader names it the same way. */
const CORRECTIVE_ACTION_KEY = "dpoa";

/**
 * CA_TEMPLATE_MAP_ENABLED (QA F4, 24 Oct 2026). "create a Verbal CA for …",
 * "I need a CA for someone opening the salon late": this turn asks for a
 * corrective action to be started. The template reader calls that the
 * progression, and `publishedKey` keeps only a named form, so the slot stayed
 * empty whenever the model reading was absent. The form that records it is
 * the published Corrective Action Form. A question about corrective action
 * starts nothing, and a metric with no behaviour is the progression, as the
 * form proposal reads it.
 */
function correctiveActionRequestKey(
  turn: { readonly question: string; readonly managerText: string },
  templates: readonly TemplateRow[],
): string | null {
  const intent = detectTemplateIntent(turn.question);
  if (intent.kind !== "corrective_action" || !intent.requestedCreation) return null;
  if (correctiveActionBasis(turn.managerText) === "metric_only") return null;
  return templates.some((template) => template.key === CORRECTIVE_ACTION_KEY) ? CORRECTIVE_ACTION_KEY : null;
}

function publishedKey(
  intent: ReturnType<typeof detectTemplateIntent>,
  templates: readonly TemplateRow[],
): string | null {
  if (intent.kind !== "explicit" && intent.kind !== "clarify") return null;
  return templates.some((template) => template.key === intent.templateKey) ? intent.templateKey : null;
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
    /** The manager's Yes/No, when INTENT_PAYROLL_MANAGER_ONLY_ENABLED is on. */
    payrollAnswer?: PayrollDeductAnswer | null;
    /** INTENT_PAYROLL_MANAGER_ONLY_ENABLED: Yes/No only from the manager's answer, never from an amount alone. */
    managerOnly?: boolean;
    /** LATE_OPEN_DATE_ENABLED: the manager's stated Yes/No is kept, ahead of an amount's Yes. */
    managerAnswer?: boolean;
    warningLevel: "verbal" | "written" | null;
    formType: string | null;
    policyHeading: string | null;
    policyPage: number | null;
  },
): ConversationFormState {
  const named = slots.employee.name ?? slots.employee.typed;
  const directoryName = slots.employee.person ? displayName(slots.employee.person) : null;
  const keepTyped =
    typedNameProceedsEnabled() && named && directoryName && named.toLowerCase() !== directoryName.toLowerCase();
  return {
    ...prior,
    employeeId: slots.employee.person?.id ?? (named && !slots.employee.person ? null : prior.employeeId),
    employeeName: keepTyped ? named : directoryName ?? named ?? prior.employeeName,
    salonId: slots.salon.id ?? prior.salonId,
    title: slots.title ?? prior.title,
    formDate: slots.date ?? prior.formDate,
    warningLevel: slots.warningLevel ?? prior.warningLevel,
    payrollDeduct: slots.managerOnly
      ? (slots.payrollAnswer ?? prior.payrollDeduct)
      : slots.managerAnswer && slots.payrollAnswer
        ? slots.payrollAnswer
        : slots.payrollAmount
          ? "yes"
          : prior.payrollDeduct,
    templateKey: slots.formType ?? prior.templateKey,
    incidentType: slots.incidentType ?? prior.incidentType,
    payrollAmount: slots.payrollAnswer === "no" ? null : slots.payrollAmount ?? prior.payrollAmount,
    policyHeading: slots.policyHeading ?? prior.policyHeading,
    policyPage: slots.policyPage ?? prior.policyPage,
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
  formType: { key: string | null; ambiguous: readonly TemplateRow[]; together?: boolean };
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
  if (input.formType.ambiguous.length > 1 && input.formType.together) return startWithQuestion(input.formType.ambiguous);
  if (input.formType.ambiguous.length > 1) return formQuestion(input.formType.ambiguous);
  if (input.warningLevel.ambiguous) {
    return "Which warning level did you mean? Reply with the number.\n1. **verbal**\n2. **written**";
  }
  // A missing slot is filled on the proposal card. Returning "I still need …"
  // here replaced the card on every live replay (23 Oct 2026), including
  // turns that had already named the employee, the salon, the form, and the
  // date. Warning level, title, what happened, and which form are optional.
  // A name that is not on the roster stays on the card. It is not announced.
  return null;
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

/** FORM_CHOICE_STATED_ENABLED: two forms asked for in one turn; one card at a time. */
function startWithQuestion(templates: readonly TemplateRow[]): string {
  const options = templates.map((template, index) => `${index + 1}. **${template.name}**`);
  return `Which form should I start with? I'll draft one at a time — ask for the other once this one is done. Reply with the number or the form.\n${options.join("\n")}`;
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

function blank(value: string | null | undefined): string | null {
  const text = value?.trim() ?? "";
  return text ? text : null;
}
