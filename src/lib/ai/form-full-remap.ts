import "server-only";

import { randomUUID } from "node:crypto";

import { CLAUDE_HAIKU_MODEL } from "@/lib/config/models";
import {
  actionPlanManagerOnlyEnabled,
  formFullRemapEnabled,
  notANameGuardEnabled,
  priorActionsParseEnabled,
  remapIncidentFixEnabled,
  newestPlaceTurnEnabled,
  formEditDateRulesEnabled,
  formDateIncidentOnlyEnabled,
} from "@/lib/config/chat-quality-flags";
import { managerTypedActionPlan } from "@/lib/forms/manager-action-plan";
import { CA_POLICY_LABEL, readCaPolicy } from "@/lib/forms/ca-policy";
import { lateOpenOn } from "@/lib/forms/late-open";
import { withoutAttendanceForLateOpening } from "@/lib/forms/official-policy-manual";
import { matchEmployeeName, type RosterEmployee } from "@/lib/forms/employee-match";
import { datesInText, datesInTextWithYearless, listIncidentDates } from "@/lib/forms/form-date-answer";
import { incidentOnly } from "@/lib/forms/form-date-incident-only";
import { isNotAName, maskNotANameText } from "@/lib/forms/not-a-name";
import { supportsInlineDraft } from "@/lib/forms/inline-draft";
import { TEMPLATE_SEEDS } from "@/lib/forms/library";
import { statedPriorActions } from "@/lib/forms/prior-actions";
import { newestManagerTurnSalon } from "@/lib/forms/newest-place-turn";
import { readSalonMentions, rosterSalonName } from "@/lib/forms/salon-mention";
import { payrollDeductAmount, payrollDeductFromConversation } from "@/lib/forms/payroll-deduct";
import { extractEmployeeNames, extractJobTitle, titleAfterJobTitleLabel } from "@/lib/forms/proposal";
import { detectTemplateIntent } from "@/lib/forms/template-intent";
import { inlineCloseMatch } from "@/lib/forms/typed-name-proceeds";
import { warningLevelFromTurns } from "@/lib/forms/warning-level";
import type { AskResponse } from "./types";
import {
  currentRequestStart,
  HAS_WORD,
  hasCutDate,
  isAmbiguousAnswer,
  isEditTurn,
  isRequestLeftover,
  mergePriorActions,
  namedPolicy,
  priorListActions,
  remapCitations,
  remapManualHeadings,
  remapManualSections,
  remapPolicyLine,
  placeSpans,
  requestIncident,
  saidInWords,
  statedActionPlan,
  withoutAmbiguousAnswers,
  withoutPriorList,
  withoutStateCodes,
  type RemapManual,
} from "./remap-incident";
import type { ChatFormProposal } from "@/types";

import { callClaudeTool } from "./call-claude";
import { formDateByRules, managerWords, remapEditLine, remapObservation, withoutSetAsidePolicies } from "./edit-date-rules";
import { chatTraceDraft } from "./chat-trace-store";

/**
 * One structured read of the whole conversation, mapped onto the form.
 *
 * The model proposes slots. A slot is kept only when the manager's own
 * turns support it. A later turn replaces an earlier one. A blank required
 * field is one short question, and a question already asked is not asked
 * again. An edit continues the same form. A name Woven does not list stays
 * as typed. One close roster name is "Woven has …" under the card.
 *
 * The flag off does not call the model. This app says salon, not store.
 */

const TEMPLATES = ["dpoa", "coaching", "follow-up-coaching", "policy-review"] as const;
type TemplateKey = (typeof TEMPLATES)[number];

const TOOL_NAME = "extract_form_fields";
const MAX_TOKENS = 900;

const POLICY_QUOTE = /\$25\.00\s+via\s+payroll\s+deduction/i;

const PAYROLL_AMOUNT_QUESTION =
  "One more question: **Payroll deduction amount?** Tell me the amount here, or fill it on the form — I won't choose it for you.";

const QUESTIONS: Record<string, string> = {
  employeeName: "Who is this for?",
  jobTitle: "What is their job title?",
  store: "Which salon?",
  incidentDateIso: "Which date should go on the form?",
  observation: "What happened?",
  warningLevel: "Verbal or written?",
  payrollDeduct: "Is payroll deduct applicable?",
  payrollAmount: PAYROLL_AMOUNT_QUESTION,
  templateKey: "Which form is this?",
};

const SYSTEM = `You read a salon manager's whole conversation and call extract_form_fields once.

Fill a field only from what the manager said. Leave it null when they did not say it.
A later message overwrites an earlier one. Do not restart the form.
Copy the employee name exactly as typed. Do not replace it with a roster spelling.
incidentDateIso is YYYY-MM-DD only when they stated a calendar date. "today" is useToday, not a guessed date.
warningLevel is verbal or written only when they said that level. "write up" and "written up" are the form, not a level.
payrollDeduct is yes or no only when they said so. A shortage is not a deduction. payrollAmount is a dollar amount they stated for the deduction, or null. Never copy "$25.00 via payroll deduction" from a policy.
observation and actionPlan are short summaries of what they described. Do not paste their message. Do not add facts, a policy, or the words "as you said". The action plan does not include a dollar amount.
Do not invent a job title, salon, policy, or date.`;

export interface FormRemapSlots {
  readonly templateKey: TemplateKey | null;
  readonly employeeName: string | null;
  readonly jobTitle: string | null;
  readonly store: string | null;
  readonly locationId: string | null;
  readonly incidentDateIso: string | null;
  readonly incidentTime: string | null;
  readonly warningLevel: "verbal" | "written" | null;
  readonly payrollDeduct: "yes" | "no" | null;
  readonly payrollAmount: string | null;
  readonly policySection: string | null;
  readonly observation: string | null;
  readonly priorActions: string | null;
  readonly actionPlan: string | null;
  readonly closeMatchNote: string | null;
}

export interface FormRemapCallerResult {
  readonly raw: unknown;
  readonly model: string;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
}

export type FormRemapCaller = (input: {
  readonly model: string;
  readonly system: string;
  readonly user: string;
}) => Promise<FormRemapCallerResult>;

type Turn = { readonly role: string; readonly content: string };

export function groundFormSlots(input: {
  readonly raw: unknown;
  readonly history: readonly Turn[];
  readonly question: string;
  readonly today: string;
  readonly people: readonly RosterEmployee[];
  readonly continueTemplateKey?: string | null;
  /** Slots already kept for this conversation. A null read must not erase them. */
  readonly saved?: Partial<FormRemapSlots> | null;
  /** The JBA Policy Manual, read only with REMAP_INCIDENT_FIX_ENABLED on. */
  readonly manual?: RemapManual | null;
}): { slots: FormRemapSlots; response: AskResponse } {
  const fixed = remapIncidentFixEnabled();
  const conversation = turnsWithQuestion(input.history, input.question);
  const users = conversation.filter((turn) => turn.role === "user").map((turn) => turn.content);
  const said = users.join("\n");
  const raw = parseRaw(input.raw);
  const templateKey =
    templateFromUser(said) ??
    (isTemplate(input.continueTemplateKey) ? input.continueTemplateKey : null) ??
    (isTemplate(raw.templateKey) ? raw.templateKey : null);
  const employeeName = groundedName(raw.employeeName, users);
  const jobTitle = groundedTitle(fixed ? users.map(withoutStateCodes) : users);
  // NEWEST_PLACE_TURN_ENABLED: the newest manager turn that names one salon wins.
  const newest = newestPlaceTurnEnabled() ? newestManagerTurnSalon([...users].reverse()) : null;
  const newestName = newest ? rosterSalonName(newest.id) : null;
  const store =
    (newest && newestName ? { id: newest.id, name: newestName } : null) ??
    groundedStore(said) ??
    (fixed ? placeStore(said) : null);
  const incidentDateIso = groundedDate(said, input.today);
  const warningLevel = explicitWarning(users);
  // A bare "Yes" after a list of questions answers none of them (REMAP_INCIDENT_FIX_ENABLED).
  const payrollDeduct = payrollDeductFromConversation(fixed ? withoutAmbiguousAnswers(conversation) : conversation);
  const payrollAmount = payrollDeduct === "yes" ? managerPayrollAmount(said) : null;
  // A later create request with its own incident starts a new form: What
  // happened, the policy, the prior actions and the plan are read from there.
  const start = fixed ? currentRequestStart({ turns: users, employeeName, slotClause }) : 0;
  const scoped = users.slice(start).join("\n");
  const named = fixed ? namedPolicy(withoutPriorList(scoped)) : null;
  // LATE_OPEN_DATE_ENABLED with REMAP_INCIDENT_FIX_ENABLED: a described late
  // opening ("late to open 10-19") is still the Late Opening policy when no
  // policy is named and the manual gives no section for it.
  const lateOpening = fixed && !named ? describedLateOpening(withoutPriorList(scoped)) : null;
  const policySection = fixed ? (named ?? lateOpening) : groundedPolicy(said);
  const incidentRead = fixed
    ? (requestIncident({ text: scoped, employeeName, slotClause }) ??
      (isRequestLeftover(raw.observation, employeeName) || hasCutDate(raw.observation, said)
        ? null
        : acceptSummary(raw.observation, scoped)))
    : (statedIncident(said, employeeName) ?? acceptSummary(raw.observation, said));
  // A stray quote or other punctuation alone is never What happened (sibling app conv_mvnu3j932gpohx4).
  const observation = incidentRead && HAS_WORD.test(incidentRead) ? incidentRead : null;
  // Both readers contribute, each behind its own flag: the "previous coaching: …"
  // list (REMAP_INCIDENT_FIX_ENABLED) and the intent path's step reader
  // (PRIOR_ACTIONS_PARSE_ENABLED). With both on, a list item whose date a
  // parsed step already holds is the same step and is not listed twice.
  const priorList = fixed ? priorListActions(said) : [];
  const priorActions = priorActionsParseEnabled()
    ? remapPriorActions(said, input.today, priorList)
    : fixed
      ? mergePriorActions(statedPrior(said), priorList)
      : statedPrior(said);
  const incidentTime = statedTime(said);
  // The action plan is the manager's, or blank. The model's summary and
  // "previous coaching …" are not a plan.
  const plan = fixed ? statedActionPlan(scoped) : acceptSummary(stripMoney(raw.actionPlan ?? ""), said);
  // PRIOR_ACTIONS_PARSE_ENABLED: a plan that is only the history label is not a plan.
  const remapPlan = priorActionsParseEnabled() && plan && HISTORY_LABEL_ONLY.test(plan) ? null : plan;
  // Manager-only: the plan they typed, word for word, or none. Never the model's summary.
  // With REMAP_INCIDENT_FIX_ENABLED it is read from the current request's turns only.
  const planManagerOnly = actionPlanManagerOnlyEnabled();
  const actionPlan = planManagerOnly ? managerTypedActionPlan(fixed ? users.slice(start) : users) : remapPlan;
  const closeMatchNote = employeeName ? closeNote(employeeName, input.people) : null;

  const read: FormRemapSlots = {
    templateKey,
    employeeName,
    jobTitle,
    store: store?.name ?? null,
    locationId: store?.id ?? null,
    incidentDateIso,
    incidentTime,
    warningLevel: warningLevel === "verbal" || warningLevel === "written" ? warningLevel : null,
    payrollDeduct,
    payrollAmount,
    policySection,
    observation,
    priorActions,
    actionPlan,
    closeMatchNote,
  };
  const saved = fixed ? withoutLeftovers(input.saved ?? null, employeeName, start > 0, said) : (input.saved ?? null);
  let slots = finishSlots(mergeSlots(read, saved), said);
  // FORM_EDIT_DATE_RULES_ENABLED: an edit replaces, adds to, or never becomes What happened; the Date follows the incident.
  if (formEditDateRulesEnabled()) {
    slots = withEditDateRules(slots, {
      users,
      question: input.question,
      today: input.today,
      reread: (account) => (fixed ? requestIncident({ text: account, employeeName, slotClause }) : statedIncident(account, employeeName)),
    });
  }
  const sections =
    fixed && input.manual
      ? // LATE_OPEN_DATE_ENABLED: a late opening cites Late Opening, not Attendance too.
        withoutAttendanceForLateOpening(
          remapManualSections({
            // FORM_EDIT_DATE_RULES_ENABLED: "INSTEAD of the attendance policy" cites no Attendance.
            said: formEditDateRulesEnabled() ? withoutSetAsidePolicies(scoped) : scoped,
            chunks: input.manual.chunks,
            incident: slots.observation,
            modelHeading: raw.policySection,
          }),
          scoped,
        )
      : [];
  if (fixed) slots = { ...slots, policySection: named ?? sections[0]?.heading ?? lateOpening ?? null };
  // A saved summary from an earlier turn does not come back either.
  if (planManagerOnly) slots = { ...slots, actionPlan };

  const assistants = conversation.filter((turn) => turn.role === "assistant").map((turn) => turn.content);
  // An ambiguous "Yes" answered nothing, so the questions before it are asked again.
  if (fixed && isAmbiguousAnswer(conversation, conversation.length - 1)) assistants.pop();
  const questions = questionsFor(slots, assistants);
  const content = renderReply(
    slots,
    questions,
    fixed
      ? {
          policyLine:
            remapPolicyLine(named, sections) ??
            (lateOpening && slots.policySection === lateOpening ? `**Policy:** ${lateOpening}` : null),
          storeSaid: slots.store ? saidInWords(slots.store, said) : false,
          titleSaid: slots.jobTitle ? saidInWords(slots.jobTitle, said) : false,
        }
      : null,
  );
  // FORM_EDIT_DATE_RULES_ENABLED: the reply says what an edit did.
  const editLine = formEditDateRulesEnabled() ? remapEditLine(managerWords(input.question)) : null;
  const response: AskResponse = {
    content: editLine ? `${content}\n\n${editLine}` : content,
    citations: fixed && input.manual ? remapCitations(input.manual, sections) : [],
    recommendedVideoIds: [],
    ...(slots.templateKey ? { formProposal: proposalFor(slots) } : {}),
  };
  return { slots, response };
}

/**
 * A form turn is one the library already calls a form, or field notes
 * ("verbal", "no payroll", "prior ="). A question about the policy is not.
 *
 * ONLY THE FOUR FORMS THIS READ FILLS (ported from the sibling app, 25 Oct
 * 2026). There, "Create an exit form for <name> at <location>, she resigned
 * and her last day was 10-20" came back as the Corrective Action Form with
 * "Verbal or written?" and "Is payroll deduct applicable?", and the next "Yes"
 * set payroll deduct: the extraction can only choose among `TEMPLATES`, so a
 * form outside them fell onto the Corrective Action Form. When the manager's
 * own latest naming is a library form outside `TEMPLATES` (the
 * Resignation/Exit Form, a demotion, an EPP, …), or none is named and the open
 * card is one, this read does not run and the proposal flow serves the turn.
 * Sunny's replies never count, and a Corrective Action that mentions "she
 * resigned" is still a Corrective Action.
 */
export function remapShouldRun(input: {
  readonly question: string;
  readonly history: readonly { role: string; content: string }[];
  readonly formsTurn: boolean;
  /** The template of the card already open in this chat, if any. */
  readonly continueTemplateKey?: string | null;
}): boolean {
  if (asksAboutCorrectiveAction(input.question)) return false;
  const named = managerNamedTemplate(input.question, input.history);
  if (named !== null && !isTemplate(named)) return false;
  if (named === null && input.continueTemplateKey && !isTemplate(input.continueTemplateKey)) return false;
  if (input.formsTurn) return true;
  if (asksAQuestion(input.question)) return false;
  const text = [input.question, ...input.history.filter((turn) => turn.role === "user").map((turn) => turn.content)].join("\n");
  return /\b(?:verbal|written|warning|corrective|write-?ups?|payroll|prior\s*=)\b/i.test(text);
}

function asksAQuestion(question: string): boolean {
  return /\?\s*$/.test(question.trim()) && /\b(?:what|how|when|where|who|why|can|does|do|is)\b/i.test(question);
}

/**
 * "what does a verbal CA mean?" names the form and asks about it. The spoken
 * intent made it a forms turn, and the remap answered with a Corrective
 * Action Form whose "What happened" was the question (QA F4, 24 Oct 2026;
 * found in Ask Bubbles, where the remap is on). The template reader already
 * says nothing is to be started, so the turn goes to the form proposal,
 * which hands it to the knowledge base.
 */
function asksAboutCorrectiveAction(question: string): boolean {
  if (!asksAQuestion(question)) return false;
  const intent = detectTemplateIntent(question);
  return intent.kind === "corrective_action" && !intent.requestedCreation;
}

/**
 * The library form the manager last asked for, newest manager turn first, or
 * null when no manager turn names one.
 */
function managerNamedTemplate(question: string, history: readonly { role: string; content: string }[]): string | null {
  const managerTurns = [
    question,
    ...history
      .filter((turn) => turn.role === "user")
      .map((turn) => turn.content)
      .reverse(),
  ];
  for (const text of managerTurns) {
    if (!text.trim()) continue;
    const intent = detectTemplateIntent(text);
    if (intent.kind === "explicit" || intent.kind === "clarify") return intent.templateKey;
    if (intent.kind === "corrective_action" && intent.requestedCreation) return "dpoa";
  }
  return null;
}

export async function remapFormTurn(
  input: {
    readonly history: readonly Turn[];
    readonly question: string;
    readonly today: string;
    readonly people: readonly RosterEmployee[];
    readonly continueTemplateKey?: string | null;
    readonly saved?: Partial<FormRemapSlots> | null;
    /** Read only with REMAP_INCIDENT_FIX_ENABLED on. A failed read cites nothing. */
    readonly policyManual?: () => Promise<RemapManual | null>;
  },
  call: FormRemapCaller = defaultCall,
): Promise<AskResponse | null> {
  if (!formFullRemapEnabled()) return null;
  const started = Date.now();
  let manual: RemapManual | null = null;
  if (remapIncidentFixEnabled() && input.policyManual) {
    try {
      manual = await input.policyManual();
    } catch {
      manual = null;
    }
  }
  const headings = manual ? remapManualHeadings(manual.chunks) : [];
  let result: FormRemapCallerResult;
  try {
    result = await call({
      model: CLAUDE_HAIKU_MODEL,
      system: headings.length > 0 ? `${SYSTEM}\n${SYSTEM_POLICY_HEADING}` : SYSTEM,
      user: headingsBlock(headings) + conversationText(input.history, input.question, input.today),
    });
  } catch {
    return null;
  }
  const grounded = groundFormSlots({ ...input, raw: result.raw, saved: input.saved ?? null, manual });
  noteExtraction({
    model: result.model,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    latencyMs: Date.now() - started,
    slots: grounded.slots,
  });
  return grounded.response;
}

function noteExtraction(input: {
  readonly model: string;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly latencyMs: number;
  readonly slots: FormRemapSlots;
}): void {
  const draft = chatTraceDraft();
  if (!draft) return;
  const slots = { ...input.slots };
  draft.slots = slots;
  draft.formExtraction = {
    model: input.model,
    inputTokens: input.inputTokens,
    outputTokens: input.outputTokens,
    slots,
  };
  if (!draft.modelCall) {
    draft.modelCall = {
      model: input.model,
      maxTokens: MAX_TOKENS,
      stopReason: "tool_use",
      latencyMs: input.latencyMs,
      inputTokens: input.inputTokens,
      outputTokens: input.outputTokens,
      thinkingTokens: null,
      cacheCreationInputTokens: null,
      cacheReadInputTokens: null,
      firstTokenMs: null,
      e2eLatencyMs: null,
      errorSubtype: null,
      errorClass: null,
      errorStatus: null,
      retryable: false,
      retried: false,
    };
  }
}

async function defaultCall(input: { model: string; system: string; user: string }): Promise<FormRemapCallerResult> {
  const raw = await callClaudeTool({
    model: input.model,
    system: input.system,
    maxTokens: MAX_TOKENS,
    tool: { name: TOOL_NAME, description: "Form fields the manager has stated.", input_schema: TOOL_SCHEMA },
    messages: [{ role: "user", content: input.user }],
  });
  return { raw, model: input.model, inputTokens: null, outputTokens: null };
}

const SYSTEM_POLICY_HEADING =
  "policySection is the one heading from the manual list in the message that the incident is about, or null when none fits. Copy the heading exactly. Do not invent one.";

function headingsBlock(headings: readonly string[]): string {
  return headings.length > 0 ? `Manual headings:\n${headings.map((heading) => `- ${heading}`).join("\n")}\n\n` : "";
}

function conversationText(history: readonly Turn[], question: string, today: string): string {
  const turns = [...history, { role: "user", content: question }]
    .filter((turn) => turn.content.trim() !== "")
    .map((turn) => `${turn.role === "assistant" ? "Sunny" : "Manager"}: ${turn.content.trim().slice(0, 2000)}`);
  return `Today is ${today}.\n\n${turns.join("\n\n")}`;
}

/**
 * The current question is already the last user turn when the client or the
 * history table appended it before this read. Counting it twice stacked the
 * prior-action line on that turn. The next turn read the line once, and the
 * duplicate collapsed.
 */
function turnsWithQuestion(history: readonly Turn[], question: string): Turn[] {
  const turns = [...history, { role: "user", content: question }].filter((turn) => turn.content.trim() !== "");
  const last = turns.at(-1);
  const before = turns.at(-2);
  if (last && before && last.role === "user" && before.role === "user" && last.content === before.content) {
    turns.pop();
  }
  return turns;
}

interface RawSlots {
  readonly templateKey: string | null;
  readonly employeeName: string | null;
  readonly observation: string | null;
  readonly actionPlan: string | null;
  readonly policySection: string | null;
}

function parseRaw(input: unknown): RawSlots {
  const record = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  return {
    templateKey: str(record.templateKey),
    employeeName: str(record.employeeName),
    observation: str(record.observation),
    actionPlan: str(record.actionPlan),
    policySection: str(record.policySection),
  };
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function isTemplate(value: string | null | undefined): value is TemplateKey {
  return typeof value === "string" && (TEMPLATES as readonly string[]).includes(value);
}

function templateFromUser(text: string): TemplateKey | null {
  // A named form wins, last one typed. "Create a Coaching Form" stays that
  // form even if the note also says "verbal". "coached on the 2nd" is a prior
  // step, not a request for the Coaching Form.
  const named: { index: number; key: TemplateKey }[] = [];
  const add = (re: RegExp, key: TemplateKey) => {
    for (const match of text.matchAll(re)) named.push({ index: match.index ?? 0, key });
  };
  add(/\bfollow[- ]up coaching\b/gi, "follow-up-coaching");
  add(/\bpolicy review\b/gi, "policy-review");
  add(/\bcorrective actions?\b|\bwrite-?ups?\b|\bwritten up\b|\bca\b|\bc\/a\b|\bdpoa\b/gi, "dpoa");
  // "follow-up coaching form" names the Follow-Up Coaching Form, not a second
  // naming of the Coaching Form after it (25 Oct 2026).
  add(/(?<!follow[- ]up )\bcoaching form\b/gi, "coaching");
  if (named.length > 0) {
    named.sort((a, b) => a.index - b.index);
    return named.at(-1)!.key;
  }
  // No form was named. A discipline word is the Corrective Action Form.
  if (/\b(?:verbal|written|warnings?|final\s+warnings?|terminations?|demotions?)\b/i.test(text)) return "dpoa";
  if (/\bcoaching\b/i.test(text)) return "coaching";
  return null;
}

function groundedName(proposed: string | null, turns: readonly string[]): string | null {
  // NOT_A_NAME_GUARD_ENABLED: the model's name is looked for outside a
  // bulleted or priced offer list, so an offer it copied is not found.
  const spoken = notANameGuardEnabled() ? turns.map((turn) => maskNotANameText(turn)) : turns;
  const said = spoken.join("\n");
  const latest = spoken.at(-1) ?? "";
  // NOT_A_NAME_GUARD_ENABLED: "blank", a product, a salon's city or a verb
  // phrase is not the employee, even when the manager typed those words.
  if (proposed && isNotAName(proposed)) proposed = null;
  if (proposed) {
    const inLatest = exactSlice(latest, proposed);
    if (inLatest) return inLatest;
    const inSaid = exactSlice(said, proposed);
    if (inSaid) return inSaid;
  }
  let found: string | null = null;
  for (const turn of turns) {
    const person = personPhrase(notANameGuardEnabled() ? maskNotANameText(turn) : turn);
    if (person && !isNotAName(person)) found = person;
  }
  return found;
}

/** "for Test Employee" and "Test Employee at Grand Island". Not "Use Kearney as the location". */
function personPhrase(turn: string): string | null {
  if (/\bas the location\b/i.test(turn)) return null;
  const named = /\bfor\s+([A-Z][\w'.-]+(?:\s+[A-Z][\w'.-]+)*)/.exec(turn);
  if (named) return named[1]!;
  const leading = /^([A-Z][\w'.-]+(?:\s+[A-Z][\w'.-]+)+)\s+at\b/.exec(turn.trim());
  if (leading) return leading[1]!;
  const names = extractEmployeeNames(turn);
  if (names.length === 1) return exactSlice(turn, names[0]!) ?? names[0]!;
  return null;
}

function exactSlice(haystack: string, needle: string): string | null {
  const at = haystack.toLowerCase().indexOf(needle.toLowerCase());
  if (at < 0) return null;
  return haystack.slice(at, at + needle.length);
}

function groundedTitle(turns: readonly string[]): string | null {
  let title: string | null = null;
  for (const turn of turns) {
    if (/^(?:verbal|written|yes|no|yeah|nope)[.!\s]*$/i.test(turn.trim())) continue;
    const found = titleAfterJobTitleLabel(turn) ?? extractJobTitle(turn) ?? teamMemberTitle(turn);
    if (!found || /^(?:verbal|written)$/i.test(found)) continue;
    title = found;
  }
  return title;
}

/** "team member" is a title Sunny's abbreviation list does not spell out. */
function teamMemberTitle(turn: string): string | null {
  return /\bteam members?\b/i.test(turn) ? "Team Member" : null;
}

function groundedStore(text: string): { id: string; name: string } | null {
  const redirects: { index: number; place: string }[] = [];
  for (const match of text.matchAll(/\bchange (?:store|salon) to\s+([A-Za-z][A-Za-z .'-]{1,40})/gi)) {
    redirects.push({ index: match.index ?? 0, place: match[1]!.trim() });
  }
  for (const match of text.matchAll(/\buse\s+([A-Za-z][A-Za-z .'-]{1,40}?)\s+as the (?:location|salon|store)\b/gi)) {
    redirects.push({ index: match.index ?? 0, place: match[1]!.trim() });
  }
  redirects.sort((a, b) => a.index - b.index);
  const change = redirects.at(-1);
  const focus = change ? `at ${change.place}` : text;
  const mentions = readSalonMentions(focus).filter((mention) => mention.salonIds.length === 1);
  const last = mentions.at(-1);
  if (!last) return null;
  const id = last.salonIds[0]!;
  const name = rosterSalonName(id);
  return name ? { id, name } : null;
}

function groundedDate(text: string, today: string): string | null {
  const found = incidentOnly(text, today, listIncidentDates(text, today)).filter((item) => !dateIsPrior(text, item.index));
  const calendar = [...new Set(found.map((item) => item.iso))];
  // One incident date, or the later one when they correct it. A prior step's
  // date ("manual ack 9/01") is not this form's date and must not wipe it.
  if (calendar.length >= 1) return calendar.at(-1)!;
  // "10-20" with no year is 20 October when it is not a duration ("10-20 min").
  const dashed = dashedMonthDay(text, today);
  if (dashed) return dashed;
  if (/\b(?:use\s+)?today'?s\s+date\b/i.test(text)) return today;
  // A relative day ("yesterday", "last Friday"). A calendar phrase was already
  // decided above, including a prior-step date that must stay off the form.
  const spoken = [
    ...new Set(
      relativeDates(text, today)
        .filter((item) => {
          if (!item.iso || item.iso === today || dateIsPrior(text, item.index)) return false;
          return !calendarPhrase(item.phrase);
        })
        .map((item) => item.iso as string),
    ),
  ];
  return spoken.length === 1 ? spoken[0]! : null;
}

/** "9/01" and "October 20". Not "yesterday" or "2 days ago". */
function calendarPhrase(phrase: string): boolean {
  return /\d{4}-\d{2}-\d{2}|\d{1,2}[/. -]\d{1,2}|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\b/i.test(
    phrase,
  );
}

/** A date that belongs to an earlier step, not the form being written. */
const PRIOR_STEP_JUST_BEFORE =
  /\b(?:coached|coaching\s+(?:was\s+)?(?:given|held|done))\s+(?:(?:her|him|them|[a-z]+)\s+)?on\s*$|\b(?:gave|given|issued|had|got|received)\s+(?:(?:her|him|them)\s+)?(?:a\s+|an\s+)?(?:final\s+)?(?:verbal|written|warning|coaching|ca|c\/a|corrective\s+action|write[- ]?up)\b[^.;\n]{0,20}?\bon\s*$/i;

/*
 * A step "given on <date>" is an earlier one only when the turn dates the
 * incident some other way ("no call no show today. … gave a verbal on 10-21").
 * "write up <name>, i gave her a verbal on 10-21 for being late" is the
 * verbal this form documents, dated 10-21 (dispatcher probe, 26 Oct 2026).
 */
const DAY_WORD = /\b(?:today|yesterday|this\s+morning|last\s+night|tonight)\b/i;
const DATE_TOKEN = /\b\d{1,2}[-/]\d{1,2}(?:[-/]\d{2,4})?\b/g;

function incidentDatedElsewhere(text: string, index: number): boolean {
  if (DAY_WORD.test(text)) return true;
  for (const match of text.matchAll(DATE_TOKEN)) {
    const at = match.index ?? 0;
    if (at === index) continue;
    if (!PRIOR_STEP_JUST_BEFORE.test(text.slice(Math.max(0, at - 80), at))) return true;
  }
  return false;
}

function dateIsPrior(text: string, index: number): boolean {
  const before = text.slice(Math.max(0, index - 80), index);
  const clause = before.slice(Math.max(before.search(/[^.;\n]*$/), 0));
  if (/\b(?:prior|previous|coached\s+on|manual\s+ack|already|got|received)\b/i.test(clause)) return true;
  /*
   * FORM_DATE_INCIDENT_ONLY_ENABLED (QA, 26 Oct 2026, conv_mvolwmup27zde0x):
   * "I coached her on 10-16 and gave a verbal on 10-21" are earlier steps,
   * never the form's date.
   */
  if (formDateIncidentOnlyEnabled() && PRIOR_STEP_JUST_BEFORE.test(before) && incidentDatedElsewhere(text, index)) return true;
  // REMAP_INCIDENT_FIX_ENABLED: "jba manual 11-1-25" dates the manual acknowledgement, not this form.
  return remapIncidentFixEnabled() && /\b(?:jba\s+(?:policy\s+)?manual|policy\s+manual)\b/i.test(clause);
}

function explicitWarning(turns: readonly string[]): "verbal" | "written" | null {
  const cleaned = turns.map((turn) => turn.replace(/\bwrit(?:e|ing|ten)\s+ups?\b/gi, " "));
  const fromReader = warningLevelFromTurns(cleaned);
  if (fromReader === "verbal" || fromReader === "written") return fromReader;
  let level: "verbal" | "written" | null = null;
  for (const turn of cleaned) {
    for (const sentence of turn.split(/[.\n;]+/)) {
      for (const clause of sentence.split(",")) {
        if (!/^\s*(?:a\s+)?(verbal|written)\s+warnings?\s*$/i.test(clause) && !/^\s*(verbal|written)\s*$/i.test(clause)) {
          continue;
        }
        level = /written/i.test(clause) ? "written" : "verbal";
      }
    }
  }
  return level;
}

/** "10-20" is 20 October. "10-20 min" and "time 10-20" are not dates. */
function dashedMonthDay(text: string, today: string): string | null {
  const year = Number(/^(\d{4})-/.exec(today)?.[1]);
  if (!Number.isFinite(year)) return null;
  let found: string | null = null;
  for (const match of text.matchAll(/(?<![\d-])(\d{1,2})-(\d{1,2})(?![\d-])/g)) {
    const index = match.index ?? 0;
    const after = text.slice(index + match[0].length, index + match[0].length + 16);
    if (/^\s*(?:min|mins|minutes|hrs|hours|hr)\b/i.test(after)) continue;
    const before = text.slice(Math.max(0, index - 16), index);
    if (/\btime\s*[:=]?\s*$/i.test(before)) continue;
    if (dateIsPrior(text, index)) continue;
    const iso = monthDayIso(year, Number(match[1]), Number(match[2]));
    if (iso) found = iso;
  }
  return found;
}

function monthDayIso(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

function shiftDays(today: string, days: number): string {
  const [year, month, day] = today.split("-").map(Number);
  const date = new Date(Date.UTC(year!, (month ?? 1) - 1, (day ?? 1) + days));
  return date.toISOString().slice(0, 10);
}

function weekdayOf(iso: string): number {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(Date.UTC(year!, (month ?? 1) - 1, day ?? 1)).getUTCDay();
}

function relativeDates(text: string, today: string): { iso: string | null; phrase: string; index: number }[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) return [];
  const found: { iso: string | null; phrase: string; index: number }[] = [];
  const add = (pattern: RegExp, resolve: (match: RegExpMatchArray) => string | null) => {
    for (const match of text.matchAll(pattern)) {
      found.push({ iso: resolve(match), phrase: match[0], index: match.index ?? 0 });
    }
  };
  add(/\byesterday\b/gi, () => shiftDays(today, -1));
  add(/\btomorrow\b/gi, () => shiftDays(today, 1));
  add(/\b(\d+)\s+days?\s+ago\b/gi, (match) => shiftDays(today, -Number(match[1])));
  add(new RegExp(String.raw`\b(?:last|this past|past)\s+(${WEEKDAYS.join("|")})\b`, "gi"), (match) => {
    const target = WEEKDAYS.indexOf(match[1]!.toLowerCase());
    const back = ((weekdayOf(today) - target + 7) % 7) || 7;
    return shiftDays(today, -back);
  });
  add(new RegExp(String.raw`\bnext\s+(${WEEKDAYS.join("|")})\b`, "gi"), (match) => {
    const target = WEEKDAYS.indexOf(match[1]!.toLowerCase());
    const ahead = ((target - weekdayOf(today) + 7) % 7) || 7;
    return shiftDays(today, ahead);
  });
  return found;
}

function managerPayrollAmount(text: string): string | null {
  const stripped = text.replace(POLICY_QUOTE, " ");
  return payrollDeductAmount(stripped) ?? clausePayrollAmount(stripped);
}

function clausePayrollAmount(text: string): string | null {
  let found: string | null = null;
  for (const clause of text.split(/[.;\n]|\s+but\s+/i)) {
    if (!/\bpayroll\b|\bdeduct/i.test(clause)) continue;
    const amounts = [...clause.matchAll(/\$\s?(\d+(?:,\d{3})*(?:\.\d{2})?)/g)];
    const last = amounts.at(-1);
    if (!last) continue;
    const amount = last[0]!.replace(/\s+/g, "");
    if (Number(amount.replace(/[$,]/g, "")) === 0) continue;
    found = amount.startsWith("$") ? amount : `$${amount}`;
  }
  return found;
}

/** LATE_OPEN_DATE_ENABLED: "late to open", "opened the salon late" read as the Late Opening policy. */
function describedLateOpening(text: string): string | null {
  return lateOpenOn() && readCaPolicy(text).stated === "late_opening" ? CA_POLICY_LABEL.late_opening : null;
}

function groundedPolicy(text: string): string | null {
  const reading = readCaPolicy(text);
  return reading.stated ? CA_POLICY_LABEL[reading.stated] : null;
}

function acceptSummary(summary: string | null, said: string): string | null {
  if (!summary) return null;
  const clean = summary.replace(/\s+/g, " ").trim();
  if (!clean || /as you said/i.test(clean)) return null;
  const norm = (value: string) => value.toLowerCase().replace(/\s+/g, " ").trim();
  const summaryNorm = norm(clean);
  const saidNorm = norm(said);
  if (!summaryNorm || summaryNorm === saidNorm) return null;
  if (saidNorm.split("\n").some((line) => norm(line) === summaryNorm)) return null;
  const words = summaryNorm.split(/[^a-z0-9$]+/).filter((word) => word.length > 4);
  if (words.some((word) => !saidNorm.includes(word))) return null;
  return clean;
}

function stripMoney(text: string): string {
  return text.replace(/\$\s?\d[\d,]*(?:\.\d{2})?/g, " ").replace(/\s{2,}/g, " ").trim();
}

function closeNote(name: string, people: readonly RosterEmployee[]): string | null {
  const match = matchEmployeeName(name, people);
  if (match.kind === "confirm" && match.candidates.length === 1) return inlineCloseMatch(name, [match.candidates[0]!.name]);
  return null;
}

/**
 * The offense, once the name, salon, date, and slot answers are out of the way.
 * A full sentence ("She left the register drawer open") stays with the model's
 * summary. A note ("out of dress code 3 shifts", "on cell phone 30+ min") is
 * the issue itself.
 */
function statedIncident(text: string, employeeName: string | null): string | null {
  const clauses = text.split(/[\n,;]+/).map((clause) => clause.trim()).filter(Boolean);
  let found: string | null = null;
  for (const clause of clauses) {
    if (slotClause(clause)) continue;
    const offense = phraseOffense(stripSlots(clause, employeeName));
    if (offense) found = offense;
  }
  return found;
}

function stripSlots(clause: string, employeeName: string | null): string {
  let text = clause;
  text = text.replace(/\b(?:verbal|written)\s+(?:ca|c\/a|corrective actions?)\b/gi, " ");
  text = text.replace(/\b(?:create\s+a\s+)?(?:corrective actions?|coaching form|write-?ups?|ca|c\/a)\s+for\s+/gi, " ");
  if (employeeName) {
    text = text.replace(new RegExp(employeeName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "ig"), " ");
  }
  text = text.replace(/^\s*[A-Z][\w'.-]+\s+[A-Z][\w'.-]+\s+(?=at\b|out of\b)/, "");
  text = text.replace(/\bat\s+[A-Z][\w'.-]*(?:\s+[A-Z][\w'.-]*){0,3}/g, " ");
  text = text.replace(/\buse\s+[A-Z][\w'.-]*(?:\s+[A-Z][\w'.-]*){0,3}\s+as the (?:location|salon|store)\b/gi, " ");
  text = text.replace(/\bprior\s*=\s*[^,]+/gi, " ");
  text = text.replace(/\bcoached on\s+\S+/gi, " ");
  text = text.replace(/\bno payroll\b/gi, " ");
  return text;
}

function phraseOffense(clause: string): string | null {
  // A whole date first: "10-1" inside "10-15-26" is not a date of its own.
  let text = clause.replace(/(?<![\d/-])\d{1,2}[/-]\d{1,2}[/-]\d{2,4}(?![\d/-])/g, " ");
  text = text.replace(/\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/g, " ");
  text = text.replace(/(?<![\d-])\d{1,2}-\d{1,2}(?![\d-])(?!\s*(?:min|mins|minutes|hrs|hours|hr)\b)/g, " ");
  text = text.replace(/\s+/g, " ").trim().replace(/^[,\s]+|[,\s.]+$/g, "");
  // "register short $40 on 10-20" leaves "on" behind once the date is lifted.
  text = text.replace(/\s+(?:on|at)$/i, "");
  if (!text || text.length > 80) return null;
  if (/\b(?:she|he|they|i|we)\b/i.test(text)) return null;
  const title = titleAfterJobTitleLabel(text) ?? extractJobTitle(text) ?? teamMemberTitle(text);
  if (title && title.toLowerCase() === text.toLowerCase()) return null;
  const onDuration = /^on\s+(.+?)\s+(\d+\+?\s*(?:min|mins|minutes|hrs|hours))\b/i.exec(text);
  if (onDuration) {
    const thing = onDuration[1]!.replace(/\s+/g, " ").trim();
    const duration = onDuration[2]!.replace(/\s+/g, "");
    const spaced = duration.replace(/(\d\+?)(?=[a-z])/i, "$1 ");
    return /\buse\b/i.test(thing) ? `${thing} ${spaced}` : `${thing} use ${spaced}`;
  }
  const outOf = /^out of\s+(.+)$/i.exec(text);
  if (outOf) {
    const rest = outOf[1]!.trim();
    const counted = /^(.+?)\s+(\d+)\s+([a-z]+)$/i.exec(rest);
    if (counted) return `${counted[1]}, ${counted[2]} ${counted[3]}`;
    return rest;
  }
  return text;
}

const PAYROLL_ANSWER_ONLY =
  /^(?:(?:yes|no|yeah|nope|y|n)\b[\s,.!-]*)?payroll(?:\s+|-)deduct(?:ion|ed|s)?(?:\s+(?:of\s+)?\$?\d{1,6}(?:\.\d{1,2})?)?(?:\s+(?:applies|applicable|apply|is\s+applicable|does\s+not\s+apply|doesn'?t\s+apply|not\s+applicable|n\/?a|yes|no))?[\s.!]*$/i;

const STATE_NAMES =
  "alabama|alaska|arizona|arkansas|california|colorado|connecticut|delaware|florida|georgia|hawaii|idaho|illinois|indiana|iowa|kansas|kentucky|louisiana|maine|maryland|massachusetts|michigan|minnesota|mississippi|missouri|montana|nebraska|nevada|new hampshire|new jersey|new mexico|new york|north carolina|north dakota|ohio|oklahoma|oregon|pennsylvania|rhode island|south carolina|south dakota|tennessee|texas|utah|vermont|virginia|washington|west virginia|wisconsin|wyoming";
const STATE_ONLY = new RegExp(
  `^(?:A[LKZR]|C[AOT]|DE|FL|GA|HI|I[ADLN]|K[SY]|LA|M[ADEINOST]|N[CDEHJMVY]|O[HKR]|PA|RI|S[CD]|T[NX]|UT|V[AT]|W[AIVY]|${STATE_NAMES})\\.?$`,
  "i",
);

export function slotClause(clause: string): boolean {
  const text = clause.trim();
  if (/^(?:verbal|written|yes|no|yeah|nope)[.!]?\s*$/i.test(text)) return true;
  // "Create a Coaching Form" names the form. It is not what happened.
  if (
    /^(?:please\s+)?(?:create|make|start|open|do|file|write)\s+(?:a\s+|an\s+|the\s+)?(?:coaching form|corrective action(?: form)?|write-?up|ca|c\/a|dpoa|policy review|follow-?up coaching(?: form)?)\s*[.!]?\s*$/i.test(
      text,
    )
  ) {
    return true;
  }
  if (/^\s*coached on\b/i.test(text)) return true;
  if (/\bprior\s*=/i.test(text)) return true;
  if (/\bno payroll\b/i.test(text) && text.split(/\s+/).length <= 6) return true;
  // "payroll deduct $40 applies" and "yes payroll deduct" answer the payroll
  // question. Read as the incident, they replaced "register short $40". Only
  // a clause that is nothing but that answer: "falsified payroll deduct
  // paperwork" and "payroll deduct for missing cash $40" are offenses (QA).
  if (PAYROLL_ANSWER_ONLY.test(text)) return true;
  // "at Kearney, NE": a clause that is only the salon's state is not what happened.
  if (STATE_ONLY.test(text)) return true;
  if (/\buse\s+.+\bas the (?:location|salon|store)\b/i.test(text)) return true;
  return false;
}

/*
 * PRIOR_ACTIONS_PARSE_ENABLED. "previous coaching - jba policy manual
 * 1-20-26" put "Action plan: Previous coaching" on the card and no prior
 * action (conv_mvmzmhst2si3jfr). The history is read with the intent path's
 * reader (`statedPriorActions`), one line per step, after any "prior =" or
 * "coached on" line already read here; and an action plan that is only the
 * history label is not an action plan.
 */
const HISTORY_LABEL_ONLY =
  /^\s*(?:(?:the|her|his|their)\s+)?(?:previous|prior|past|earlier|last)\s+(?:coaching|coached|warnings?|verbal|written|final|corrective\s+actions?|cas?|c\/a|write[- ]?ups?|disciplin\w*|actions?)\b/i;

function remapPriorActions(said: string, today: string, listed: readonly string[] = []): string | null {
  const first = statedPrior(said);
  const stated = statedPriorActions(said, today);
  const lines = (first ? first.split("\n") : []).map((line) => sameCoachingLine(line, stated, today) ?? line);
  const dated = new Set(lines.flatMap((line) => datesInTextWithYearless(line, today).map((found) => found.iso)));
  for (const line of stated) {
    const own = datesInText(line, today).map((found) => found.iso);
    // A step a "prior =" line already dated is not listed twice; two steps on one day both are.
    if (own.some((iso) => dated.has(iso)) || lines.includes(line)) continue;
    lines.push(line);
  }
  /*
   * REMAP_INCIDENT_FIX_ENABLED's list items, after the parsed steps. An item
   * whose date a step above already holds is that step; the same month and day
   * counts too, since the reader above takes a corrected year ("jba manual
   * 11-1-26", then "jba manual 11-1-25") and the list keeps the first one.
   */
  const held = lines.flatMap((line) => datesInText(line, today).map((found) => found.iso));
  for (const item of listed) {
    const own = datesInText(item, today).map((found) => found.iso);
    const same = own.some((iso) => held.some((kept) => kept === iso || kept.slice(5) === iso.slice(5)));
    if (same || lines.some((line) => line.toLowerCase() === item.toLowerCase())) continue;
    lines.push(item);
    held.push(...own);
  }
  return lines.length > 0 ? lines.join("\n") : null;
}

/**
 * "coached on 9-15" read here and "Coaching for being late — signed
 * 09/15/2026" read by the intent path's reader are one step: the card keeps
 * the dated line, with what it was for (QA, 25 Oct 2026, conv_mvnoiw8n2kfbcvc).
 */
function sameCoachingLine(line: string, stated: readonly string[], today: string): string | null {
  if (!/^coached on\b/i.test(line)) return null;
  const day = datesInTextWithYearless(line, today)[0]?.iso.slice(5);
  if (!day) return null;
  return stated.find((entry) => /^Coaching\b/.test(entry) && datesInText(entry, today).some((found) => found.iso.slice(5) === day)) ?? null;
}

function statedPrior(text: string): string | null {
  const hits: string[] = [];
  const seen = new Set<string>();
  const push = (line: string) => {
    const clean = line.replace(/\s+/g, " ").trim();
    const key = clean.toLowerCase();
    if (!clean || seen.has(key)) return;
    seen.add(key);
    hits.push(clean);
  };
  for (const match of text.matchAll(/\bprior\s*=\s*([^,\n.]+)/gi)) {
    push(match[1]!.replace(/\back\b/gi, "acknowledgement"));
  }
  for (const match of text.matchAll(/\bcoached on\s+(\S+)/gi)) push(`coached on ${match[1]}`);
  return hits.length > 0 ? hits.join("\n") : null;
}

/** A labelled time ("time 10:20"). A bare "10-20" is a month and day. */
function statedTime(text: string): string | null {
  const labelled = /\btime\s*[:=]?\s*(\d{1,2}[:.-]\d{2})\b/i.exec(text);
  return labelled?.[1] ?? null;
}

const SLOT_KEYS = [
  "templateKey",
  "employeeName",
  "jobTitle",
  "store",
  "locationId",
  "incidentDateIso",
  "incidentTime",
  "warningLevel",
  "payrollDeduct",
  "payrollAmount",
  "policySection",
  "observation",
  "priorActions",
  "actionPlan",
  "closeMatchNote",
] as const satisfies readonly (keyof FormRemapSlots)[];

/**
 * A saved What happened that was only the request or an edit ("change the
 * date to", "name is", "show draft"), what was left of the request ("create
 * a for for …") or a date cut short ("5-26" of "10-15-26") is not kept, and
 * neither is a saved
 * action plan: the plan is read from the manager's words each turn. A new
 * request drops the old form's incident and policy.
 */
function withoutLeftovers(
  saved: Partial<FormRemapSlots> | null,
  employeeName: string | null,
  newRequest: boolean,
  said: string,
): Partial<FormRemapSlots> | null {
  if (!saved) return saved;
  const name = employeeName ?? saved.employeeName ?? null;
  const observation = saved.observation ?? null;
  const leftover =
    !observation ||
    isRequestLeftover(observation, name) ||
    hasCutDate(observation, said) ||
    isEditTurn(observation) ||
    /^it\s+happened\b/i.test(observation);
  return {
    ...saved,
    observation: newRequest || leftover ? null : observation,
    actionPlan: null,
    ...(newRequest ? { policySection: null } : {}),
  };
}

/** The capitalized place after "at", read alone: "at Grand Island used her cell phone". */
function placeStore(text: string): { id: string; name: string } | null {
  let found: { id: string; name: string } | null = null;
  for (const span of placeSpans(text)) found = groundedStore(span) ?? found;
  return found;
}

/** A later value replaces the same field. A blank read leaves the saved one. */
function mergeSlots(next: FormRemapSlots, saved: Partial<FormRemapSlots> | null): FormRemapSlots {
  if (!saved) return next;
  const merged: Record<string, FormRemapSlots[keyof FormRemapSlots]> = { ...next };
  for (const key of SLOT_KEYS) {
    if (merged[key] == null && saved[key] != null) merged[key] = saved[key];
  }
  return merged as unknown as FormRemapSlots;
}

function finishSlots(slots: FormRemapSlots, said: string): FormRemapSlots {
  if (slots.templateKey !== "dpoa") {
    return { ...slots, warningLevel: null, payrollDeduct: null, payrollAmount: null };
  }
  return {
    ...slots,
    payrollAmount: slots.payrollDeduct === "yes" ? (slots.payrollAmount ?? managerPayrollAmount(said)) : null,
  };
}

function questionsFor(slots: FormRemapSlots, assistants: readonly string[]): string[] {
  const needed: string[] = [];
  if (!slots.templateKey) needed.push("templateKey");
  else {
    for (const key of ["employeeName", "jobTitle", "store", "incidentDateIso", "observation"] as const) {
      if (!slots[key]) needed.push(key);
    }
    if (slots.templateKey === "dpoa") {
      if (!slots.warningLevel) needed.push("warningLevel");
      if (!slots.payrollDeduct) needed.push("payrollDeduct");
      if (slots.payrollDeduct === "yes" && !slots.payrollAmount) needed.push("payrollAmount");
    }
  }
  return needed
    .map((key) => QUESTIONS[key]!)
    .filter((question) => !assistants.some((message) => message.includes(question)));
}

function renderReply(
  slots: FormRemapSlots,
  questions: readonly string[],
  fixed: { readonly policyLine: string | null; readonly storeSaid: boolean; readonly titleSaid: boolean } | null = null,
): string {
  const lines: string[] = [];
  if (slots.templateKey) {
    const name = TEMPLATE_SEEDS.find((seed) => seed.key === slots.templateKey)?.name ?? "form";
    lines.push(`Here is the ${name}.`);
  }
  if (slots.employeeName) lines.push(`**Employee:** ${slots.employeeName}`);
  const saidTitle = !fixed || fixed.titleSaid ? ", as you said" : "";
  const saidStore = !fixed || fixed.storeSaid ? ", as you said" : "";
  if (slots.jobTitle) lines.push(`**Job title:** ${slots.jobTitle}${saidTitle}`);
  if (slots.store) lines.push(`**Salon:** ${slots.store}${saidStore}`);
  if (slots.incidentDateIso) lines.push(`**Date:** ${slots.incidentDateIso}`);
  if (slots.incidentTime) lines.push(`**Time:** ${slots.incidentTime}`);
  if (slots.observation) lines.push(`**What happened:** ${slots.observation}`);
  // The card is the one prior-action line. Repeating it in the reply painted
  // the acknowledgement twice on the turn that first stated it. With the fix
  // flag the reply lists it once on every turn, as the intent path does
  // (Ask Bubbles conv_mvmz9j6n2jyzl4o lost it from the reply after turn 2).
  if (fixed && slots.priorActions) lines.push(`**Prior actions:** ${slots.priorActions.split("\n").join("; ")}`);
  if (fixed) {
    if (fixed.policyLine) lines.push(fixed.policyLine);
  } else if (slots.policySection) lines.push(`**Policy:** ${slots.policySection}, as you said`);
  if (slots.warningLevel) {
    const label = slots.warningLevel === "verbal" ? "Verbal Warning" : "Written Warning";
    lines.push(`**Type of warning:** ${label}, as you said`);
  }
  if (slots.payrollDeduct) lines.push(`**Payroll deduct:** ${slots.payrollDeduct === "yes" ? "Yes" : "No"}, as you said`);
  if (slots.payrollAmount) lines.push(`**Payroll deduction amount:** ${slots.payrollAmount}`);
  if (slots.actionPlan) lines.push(`**Action plan:** ${slots.actionPlan}`);
  const body = lines.join("\n");
  const asked = questions.join("\n");
  return [body, asked].filter((part) => part.trim() !== "").join("\n\n");
}

/**
 * FORM_EDIT_DATE_RULES_ENABLED: What happened under the three edit kinds, and
 * the Date read past a prior step's date (see `edit-date-rules.ts`).
 */
function withEditDateRules(
  slots: FormRemapSlots,
  input: {
    readonly users: readonly string[];
    readonly question: string;
    readonly today: string;
    readonly reread: (account: string) => string | null;
  },
): FormRemapSlots {
  const users = input.users.map(managerWords).filter((turn) => turn.trim());
  const observation = remapObservation({ users, current: slots.observation, reread: input.reread });
  const date = formDateByRules({
    managerTurns: users,
    question: managerWords(input.question),
    today: input.today,
    current: slots.incidentDateIso,
  });
  const incidentDateIso = date === undefined ? slots.incidentDateIso : date;
  return observation === slots.observation && incidentDateIso === slots.incidentDateIso
    ? slots
    : { ...slots, observation, incidentDateIso };
}

function proposalFor(slots: FormRemapSlots): ChatFormProposal {
  const templateKey = slots.templateKey!;
  const named = Boolean(slots.employeeName);
  const located = Boolean(slots.locationId);
  const status = !named ? "needs_employee" : located ? "ready" : "needs_location";
  return {
    /*
     * ONE ID PER CARD, generated here as the proposal flow does. A proposal id
     * names one card: the create route's card-id match returns the draft that
     * card already made, and `createInstance` files a card's form under an id
     * derived from the manager, the form and the card id (`cardInstanceId`).
     * A fixed "form-remap" made every remap card of a manager the same card,
     * so a new chat about a different incident got the first chat's draft
     * back (sibling app B18, 25 Oct 2026).
     */
    proposalId: randomUUID(),
    templateKey,
    templateName: TEMPLATE_SEEDS.find((seed) => seed.key === templateKey)?.name ?? templateKey,
    supportsInlineDraft: status === "ready" && supportsInlineDraft(templateKey, []),
    variantKey: null,
    employeeName: slots.employeeName,
    employeeRole: slots.jobTitle,
    ...(slots.closeMatchNote ? { wovenCloseMatch: slots.closeMatchNote } : {}),
    formDate: slots.incidentDateIso,
    incidentTime: slots.incidentTime,
    payrollDeduct: slots.payrollDeduct,
    payrollDeductAmount: slots.payrollAmount,
    warningLevel: slots.warningLevel,
    issue: slots.observation,
    priorActions: slots.priorActions,
    locationId: slots.locationId,
    locationName: slots.store,
    locationResolution: located ? "resolved" : "needs_selection",
    authorizedLocationIds: slots.locationId ? [slots.locationId] : [],
    status,
    sourceMessageIds: [],
  };
}

const TOOL_SCHEMA = {
  type: "object" as const,
  additionalProperties: false,
  required: ["templateKey", "employeeName", "observation", "actionPlan"],
  properties: {
    templateKey: { type: ["string", "null"], enum: [...TEMPLATES, null] },
    employeeName: { type: ["string", "null"] },
    jobTitle: { type: ["string", "null"] },
    store: { type: ["string", "null"] },
    incidentDateIso: { type: ["string", "null"] },
    useToday: { type: "boolean" },
    warningLevel: { type: ["string", "null"], enum: ["verbal", "written", null] },
    payrollDeduct: { type: ["string", "null"], enum: ["yes", "no", null] },
    payrollAmount: { type: ["string", "null"] },
    policySection: { type: ["string", "null"] },
    observation: { type: ["string", "null"] },
    actionPlan: { type: ["string", "null"] },
  },
};
