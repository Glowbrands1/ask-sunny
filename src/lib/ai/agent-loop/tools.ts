import "server-only";

import { randomUUID } from "node:crypto";

import { DEFAULT_PERMISSION_MATRIX, hasPermission } from "@/lib/permissions";
import { businessToday } from "@/lib/business-date";
import { candidateNameWords, chatFormsActor } from "@/lib/forms/chat-form-records";
import { displayName, matchEmployeeName, nameConfirmationQuestion, type RosterEmployee } from "@/lib/forms/employee-match";
import { offRosterOffer } from "@/lib/forms/off-roster-confirm";
import { rosterSalonName } from "@/lib/forms/salon-mention";
import { readScopedRoster } from "@/lib/forms/employee-roster";
import { inlineDraftVariantKey, supportsInlineDraft } from "@/lib/forms/inline-draft";
import { authorizeInstance, InstanceNotVisibleError, instanceListFilterFor, visibleInstances } from "@/lib/forms/instance-scope";
import { applyAssistantRevision, listInstances } from "@/lib/forms/instances";
import { formEditPlainWordsEnabled, formEditSingleWriterEnabled, formEditToolInStreamEnabled, formPatchReducerEnabled } from "@/lib/config/chat-quality-flags";
import type { AskResponse } from "@/lib/ai/types";
import { findManualSection, manualSectionHeadings, type ManualChunk } from "@/lib/forms/official-policy-manual";
import { sectionWording } from "@/lib/forms/policy-citation";
import { buildProposal, extractEmployeeNames, managerContext, samePerson, tidyTypedName } from "@/lib/forms/proposal";
import { cleaningUndonePhrase, namesCareAndCleaning } from "@/lib/forms/ca-policy";
import { turnsFromThisPersonsRequest } from "@/lib/forms/this-persons-turns";
import { closePolicyQuestion, namedPolicies } from "@/lib/forms/named-policy-section";
import { startsNewForm } from "@/lib/ai/remap-incident";
import { statedPayrollDeduct } from "@/lib/forms/payroll-deduct";
import { UNDER_PERFORMANCE_EXPLAINED } from "@/lib/ai/under-performance-explained";
import { listTemplateSummaries, type TemplateSummary } from "@/lib/forms/repository";
import { SupabaseKnowledgeProvider } from "@/lib/knowledge/providers/supabase";
import type { AccessScope, ChatFormProposal, ChatMessage, Role } from "@/types";

/**
 * ============================================================================
 * THE TOOL LOOP'S TOOLS (AGENT_LOOP_ENABLED)
 * ============================================================================
 *
 * Every tool runs as the signed-in manager, through the helpers the rest of
 * the app uses — nothing here widens access:
 *
 *   find_staff       the scoped roster (`readScopedRoster`: the manager's own
 *                    salons; district and region are unchecked, as everywhere)
 *   find_past_forms  Form Monitoring as this manager reads it (`chatFormsActor`,
 *                    `instanceListFilterFor`, `visibleInstances`)
 *   read_form        `authorizeInstance(…, "view")`
 *   propose_form     a card only (`buildProposal`); nothing is saved. Create
 *                    re-checks template, permission and salon, as for any card
 *   edit_form        `authorizeInstance(…, "edit")`, drafts only, through the
 *                    revision's writer (`writeRevisionEdits` with
 *                    FORM_EDIT_SINGLE_WRITER_ENABLED, else
 *                    `applyAssistantRevision`, as chat-revision.ts); both and
 *                    the database trigger refuse a finalized form
 *   read_policy      the pinned JBA Policy Manual's section, read-only
 *
 * A tool never throws to the model: a refusal or a failure is `{ error }`, in
 * words the model can pass on. Results carry roster spellings and form ids,
 * never more than the manager could already open.
 */

export interface ToolActor {
  readonly subject: string;
  readonly email: string;
  readonly displayName: string;
  readonly role: Role;
  readonly scope: AccessScope;
  readonly verified: boolean;
}

export interface ToolContext {
  readonly request: Request;
  readonly actor: ToolActor;
  readonly question: string;
  readonly questionMessageId?: string;
  readonly history: readonly ChatMessage[];
  readonly scopeId: string;
  /** The salon's local date (America/Chicago in production), `YYYY-MM-DD`. */
  readonly today: string;
  /** The form open on the manager's screen, if any: read_form of it is never gated. */
  readonly openFormId?: string | null;
}

/* ------------------------------------------------------ hard guard: privacy --- */

/**
 * PAST FORMS ONLY WHEN ASKED (Pau's privacy rule, 14 Nov 2026; a hard guard). Forms on file are looked at only when
 * the manager's own words ask about them: what is on file, history, an earlier form, "same as last time", "open my
 * last coaching". The manager's latest message, or the one before it when the latest is a short answer.
 */
/* A form or discipline word: what a request for forms on file names (QA's review, 14 Nov 2026). */
const FORM = String.raw`(?:c\.?a\.?s?|corrective(?:\s+actions?)?|write[- ]?ups?|written[- ]up|warnings?|coachings?|forms?|terminations?|disciplin\w*|verbals?|writtens?)`;
const WHOSE = String.raw`(?:her|his|their|my|\w+'s|\w+s')`;

/**
 * Each pattern names forms or discipline on file. Ordinary incident wording never opens the gate: "left before
 * closing", "didn't record the sales", "did she get a break", "a history of migraines", "told before", "last time I
 * told her" (QA's probe sentences, `privacy-gate.test.ts`).
 */
const ASKS_ABOUT_FORMS: readonly RegExp[] = [
  /\bon file\b|\bform monitoring\b/i,
  new RegExp(String.raw`\bon record\b|\b${WHOSE}\s+(?:disciplinary\s+|work\s+)?records?\b`, "i"),
  // "her history", "form history", "write-up history", never "history of <something that is not a form>".
  new RegExp(String.raw`\b(?:${WHOSE}|form|disciplinary|write[- ]?up|ca|coaching|corrective(?:\s+action)?)\s+history\b(?!\s+of\s+(?!${FORM}\b)\w)`, "i"),
  // "written up before", "had a CA before?", "coached her before for this"; never "before her shift / before she leaves".
  new RegExp(String.raw`\b(?:${FORM}|coached)\s+(?:\w+\s+){0,2}before(?=\s*(?:[?.!,;]|$)|\s+(?:too|already|this|that|for (?:this|that|the same))\b)`, "i"),
  new RegExp(String.raw`\b(?:previous(?:ly)?|prior|past|earlier|old|older|existing|finalized|finished|latest|last)\s+(?:\w+\s+)?${FORM}\b`, "i"),
  // "has she had any write ups", "did he ever get a CA", "have they been written up".
  // The subject is the employee, never "you / I / we" ("do you have a form for …"); "have to sign" is no question about files.
  new RegExp(String.raw`\b(?:has|have|had|did|does|do)\s+(?!(?:you|u|i|we)\b)(?:\w+\s+){1,4}?(?:had|gotten|got|have(?!\s+to\b)|get|been|received|given)\s+(?:\w+\s+){0,3}?${FORM}\b`, "i"),
  /\bsame as (?:last time|before|the last one|last one)\b/i,
  /*
   * "she already has a CA but the policy wasn't listed", "she already has a verbal, now do a written", or a form word
   * earlier in the SAME message ("a coachong document for <name>. She already has one …"). A bare "she already has
   * one" with no form word in that message stays closed (QA, 14 Nov 2026).
   */
  new RegExp(String.raw`\balready (?:has|had|got|have)\s+(?:a|an|her|his|their|one)?\s*(?:\w+\s+)?${FORM}\b`, "i"),
  new RegExp(String.raw`(?:${FORM}|coach\w*|document)\b[^?!\n]{0,160}?\balready (?:has|had|got|have) (?:one|it)\b`, "i"),
  // "edit <name>'s CA", "open her coaching", "pull up the write-up for <name>": a form on file, named.
  new RegExp(String.raw`\b(?:open|reopen|edit|pull up|bring up|show me|view)\b[^.?!\n]{0,40}?\b${FORM}\b`, "i"),
];

const asks = (text: string) => ASKS_ABOUT_FORMS.some((pattern) => pattern.test(text));

export function asksAboutPastForms(context: Pick<ToolContext, "question" | "history">): boolean {
  if (asks(context.question)) return true;
  if (context.question.trim().split(/\s+/).length > 6) return false;
  const earlier = [...context.history].reverse().find((message) => message.role === "user");
  return earlier ? asks(earlier.content) : false;
}

const NOT_ASKED = "The manager has not asked about forms on file, so they are not looked at (company privacy rule). Work from what the manager said; never mention other forms.";

/** What the turn's tools produced for the reply: the card and the edit, when there were any. */
export interface ToolEffects {
  proposal: ChatFormProposal | null;
  /** The card's "**Policy:**" line, after "**Policy:** ". */
  policyLine: string | null;
  formUpdate: { instanceId: string; updated: string[] } | null;
  /** CLOSE_SPELLING: "Did you mean **<heading>** (page N)?", asked instead of citing a policy spelled too far off. */
  confirmPolicy?: string | null;
  /** The open-form reader's own reply when edit_form changed the draft: the realized diff of what was saved. */
  revisedReply?: string | null;
  /** A new draft revising a finalized form, opened on the manager's screen (`editable-draft.ts`). */
  formOpened?: AskResponse["formOpened"] | null;
}

export type ToolResult = Record<string, unknown>;

/* ------------------------------------------------------------- roster --- */

type RosterRead = { readonly kind: "read"; readonly roster: readonly RosterEmployee[] } | { readonly kind: "unchecked" } | { readonly kind: "failed" };

async function rosterFor(scope: AccessScope): Promise<RosterRead> {
  if (scope.level === "district" || scope.level === "region") return { kind: "unchecked" };
  try {
    return { kind: "read", roster: await readScopedRoster(scope) };
  } catch {
    return { kind: "failed" };
  }
}

const ROSTER_FAILED = "The staff roster could not be loaded just now, so nobody could be looked up. Say so to the manager; do not guess a name.";
const ROSTER_UNCHECKED = "This login covers a district or region, so the roster cannot be searched here. Use the name exactly as the manager typed it.";

function words(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z\s'-]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 0);
}

/** Roster people the typed name could be: every typed word starts a first, preferred or last name. Several when names are shared. */
export function rosterMatches(typed: string, roster: readonly RosterEmployee[]): RosterEmployee[] {
  const wanted = words(typed);
  if (wanted.length === 0) return [];
  return roster.filter((person) => {
    const own = words([person.firstName, person.preferredFirstName ?? "", person.lastName].join(" "));
    return wanted.every((word) => own.some((name) => name === word || (word.length >= 3 && name.startsWith(word))));
  });
}

/** The salon's name as the manager knows it (never only its id). */
function salonLabel(id: string): string {
  return rosterSalonName(id) ?? id;
}

function staffRow(person: RosterEmployee) {
  return { employee_id: person.id, name: displayName(person), salons: person.salonIds.map(salonLabel) };
}

export async function findStaff(context: ToolContext, input: { name?: unknown }): Promise<ToolResult> {
  const typed = typeof input.name === "string" ? input.name.trim() : "";
  if (typed === "") return { error: "Give the name to look for." };
  const read = await rosterFor(context.actor.scope);
  if (read.kind === "failed") return { error: ROSTER_FAILED };
  if (read.kind === "unchecked") return { unchecked: true, note: ROSTER_UNCHECKED };
  let found = rosterMatches(typed, read.roster).slice(0, 10);
  /* The roster's exact full name wins over people whose names only start the same ("Test Employee" vs "Test Employee Two"). */
  const exact = found.filter((person) => samePerson(displayName(person), typed) && words(displayName(person)).length === words(typed).length);
  if (exact.length > 0) found = exact;
  if (found.length === 0) {
    /* Close spellings, as the app's own name check reads them ("Marnie Halloway" → Marnie Holloway). */
    const close = matchEmployeeName(typed, read.roster);
    if (close.kind === "confirm" && close.candidates.length > 0) {
      const names = close.candidates.map((candidate) => candidate.name);
      return {
        matches: [],
        did_you_mean: close.candidates.slice(0, 5).map((candidate) => staffRow(candidate.employee)),
        note: `Not on the roster as typed. Ask the manager, in these words: ${nameConfirmationQuestion(typed, names)}`,
      };
    }
    return {
      matches: [],
      note: `Nobody on this manager's roster has that name. It may be a salon, a place, a metric or a typo: never put a place or a metric on a form as a person. For a person's name, say: "I couldn't find **${typed}** in the Woven roster." and then: "${offRosterOffer(typed)}"`,
    };
  }
  /* A first name alone is confirmed before it goes on a form, as today ("Is this for **Rhea Calloway**?"). */
  if (found.length === 1 && words(typed).length === 1) {
    return { matches: found.map(staffRow), note: `Only a first name was given: ask "Is this for **${displayName(found[0]!)}**?" and wait for yes before proposing.` };
  }
  const shared = new Set(found.map((person) => displayName(person).toLowerCase())).size < found.length;
  return {
    matches: found.map(staffRow),
    ...(found.length > 1 ? { note: shared ? "Several people share this name: ask the manager which one (by salon) before proposing a form." : "Several people match: ask the manager which one." } : {}),
  };
}

/* ---------------------------------------------------------- past forms --- */

export async function findPastForms(context: ToolContext, input: { employee_name?: unknown }): Promise<ToolResult> {
  const typed = typeof input.employee_name === "string" ? input.employee_name.trim() : "";
  if (typed === "") return { error: "Give the employee's name." };
  if (!asksAboutPastForms(context)) return { error: NOT_ASKED };
  const actor = await chatFormsActor(context.actor).catch(() => undefined);
  if (actor === undefined) return { error: "Form Monitoring could not be read just now. Say so; do not say there are no forms." };
  if (actor === null) return { error: "This manager's role cannot view Form Monitoring, so past forms cannot be listed." };
  const nameWords = candidateNameWords(typed);
  if (nameWords.length === 0) return { forms: [] };
  try {
    const rows = visibleInstances(actor, await listInstances("all", 50, { ...instanceListFilterFor(actor), employeeNameWords: nameWords }));
    const forms = rows
      .filter((row) => samePerson(row.employeeName, typed) || words(row.employeeName).join(" ").includes(words(typed).join(" ")))
      .slice(0, 20)
      .map((row) => ({
        instance_id: row.id,
        form: row.templateName,
        template_key: row.templateKey,
        employee: row.employeeName,
        status: row.status,
        form_date: row.formDate,
        salon: row.locationId,
      }));
    return { forms };
  } catch {
    return { error: "Form Monitoring could not be read just now. Say so; do not say there are no forms." };
  }
}

/* ----------------------------------------------------------- read form --- */

const VALUES_LIMIT = 6_000;

export async function readForm(context: ToolContext, input: { instance_id?: unknown }): Promise<ToolResult> {
  const id = typeof input.instance_id === "string" ? input.instance_id.trim() : "";
  if (id === "") return { error: "Give the form's instance_id (from find_past_forms or the open form)." };
  if (id !== context.openFormId && !asksAboutPastForms(context)) return { error: NOT_ASKED };
  try {
    const { loaded } = await authorizeInstance(context.request, id, "view");
    const values: Record<string, string> = {};
    let size = 0;
    for (const row of loaded.values) {
      const text = row.value?.trim() ?? "";
      const ticked = row.checked.length > 0 ? row.checked.join(", ") : "";
      const shown = text || ticked;
      if (!shown) continue;
      size += shown.length;
      if (size > VALUES_LIMIT) break;
      values[row.fieldKey] = shown;
    }
    return {
      instance_id: loaded.instance.id,
      form: loaded.instance.templateName,
      template_key: loaded.instance.templateKey,
      employee: loaded.instance.employeeName,
      status: loaded.instance.status,
      editable: loaded.instance.status === "draft",
      form_date: loaded.instance.formDate,
      values,
    };
  } catch (error) {
    if (error instanceof InstanceNotVisibleError) return { error: "That form does not exist or this manager cannot open it." };
    return { error: "That form could not be read just now." };
  }
}

/* -------------------------------------------------------- policy manual --- */

type ManualRead = { readonly chunks: readonly ManualChunk[]; readonly headings: readonly string[] } | null;
const manualCache = new Map<string, Promise<ManualRead>>();

export function manualFor(scopeId: string): Promise<ManualRead> {
  const cached = manualCache.get(scopeId);
  if (cached) return cached;
  const pending = (async (): Promise<ManualRead> => {
    try {
      const manual = await new SupabaseKnowledgeProvider().fetchOfficialPolicyManual(scopeId);
      if (!manual.ok) return null;
      return { chunks: manual.chunks, headings: manualSectionHeadings(manual.chunks) };
    } catch {
      return null;
    }
  })();
  manualCache.set(scopeId, pending);
  // A failed read is not kept: the next turn tries again.
  void pending.then((read) => {
    if (read === null) manualCache.delete(scopeId);
  });
  return pending;
}

/** Tests only. */
export function forgetAgentLoopManualForTests(): void {
  manualCache.clear();
}

function headingOf(headings: readonly string[], asked: string): string | null {
  const key = (text: string) => text.toLowerCase().replace(/\bpolicy\b/g, "").replace(/[^a-z0-9]+/g, " ").trim();
  const wanted = key(asked);
  if (wanted === "") return null;
  return headings.find((heading) => key(heading) === wanted) ?? null;
}

export async function readPolicy(context: ToolContext, input: { heading?: unknown }): Promise<ToolResult> {
  const asked = typeof input.heading === "string" ? input.heading.trim() : "";
  const manual = await manualFor(context.scopeId);
  if (!manual) return { error: "The JBA Policy Manual could not be read just now. Say so; do not answer from memory." };
  const heading = headingOf(manual.headings, asked);
  if (!heading) return { error: "No section of the manual has that heading. Use one of these exactly.", headings: manual.headings };
  const section = findManualSection(manual.chunks, [heading]);
  if (!section) return { error: "That section could not be found in the manual just now." };
  return { document: "JBA Policy Manual", heading: section.heading, page: section.page, wording: sectionWording(manual.chunks, section) };
}

/* -------------------------------------------------------- propose form --- */

/** The card's facts as today's reply shows them, for the manager to check before Create. */
function cardLines(card: ChatFormProposal, templateKey: string): string[] {
  const lines: string[] = [];
  if (card.issue) lines.push(`${templateKey === "dpoa" ? "**Observation of Offense:**" : "**What happened:**"} ${card.issue}`);
  if (card.warningLevel) lines.push(`**Type of Warning:** ${card.warningLevel === "verbal" ? "Verbal Warning" : "Written Warning"}, as you said.`);
  if (card.priorActions) lines.push(`**Prior actions:** ${card.priorActions}`);
  if (card.payrollDeduct) lines.push(`**Payroll Deduct:** ${card.payrollDeduct === "yes" ? `Yes${card.payrollDeductAmount ? ` — $${card.payrollDeductAmount}` : ""}` : "No"}`);
  return lines;
}

/** The manager accepted the off-roster offer for this name ("use <name>", or yes right after the offer). */
function offRosterConfirmed(context: Pick<ToolContext, "question" | "history">, typed: string): boolean {
  const offered = context.history.some((message) => message.role === "assistant" && message.content.toLowerCase().includes(`reply **use ${typed.toLowerCase()}**`));
  if (!offered) return false;
  const said = context.question.trim().toLowerCase();
  return said.includes(`use ${typed.toLowerCase()}`) || /^(?:yes|yep|yeah|ok|okay|sure)\b|\buse (?:that|the) name\b|\buse it\b/.test(said);
}

/** Every message the manager typed in this chat, the latest included. */
function managerTurns(context: Pick<ToolContext, "question" | "history">): string {
  return [...context.history.filter((message) => message.role === "user").map((message) => message.content), context.question].join("\n");
}

/** Payroll deduct as the manager stated it: in their words, or a bare yes / no right after the payroll question. */
function payrollStated(context: Pick<ToolContext, "question" | "history">): "yes" | "no" | null {
  const turns = [...context.history.filter((message) => message.role === "user").map((message) => message.content), context.question];
  for (const turn of [...turns].reverse()) {
    const stated = statedPayrollDeduct(turn);
    if (stated) return stated;
  }
  const lastAssistant = [...context.history].reverse().find((message) => message.role === "assistant");
  if (lastAssistant && /payroll/i.test(lastAssistant.content)) {
    const bare = context.question.trim().toLowerCase().replace(/[.!]+$/, "");
    if (/^(?:yes|yep|yeah|y)\b/.test(bare)) return "yes";
    if (/^(?:no|nope|nah|n)\b/.test(bare)) return "no";
  }
  return null;
}

async function creatableTemplates(role: Role): Promise<TemplateSummary[]> {
  const rows = await listTemplateSummaries();
  return rows.filter((row) => row.active && row.currentVersion && hasPermission(DEFAULT_PERMISSION_MATRIX, role, row.requiredPermission as never));
}

/** The templates this manager may create, for the system prompt. Empty when they cannot be read. */
export async function templateChoices(role: Role): Promise<{ key: string; name: string }[]> {
  try {
    return (await creatableTemplates(role)).map((row) => ({ key: row.key, name: row.name }));
  } catch {
    return [];
  }
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The forms whose Create waits for an account of what happened. */
const ACCOUNT_FORMS = new Set(["dpoa", "coaching", "follow-up-coaching"]);

export async function proposeForm(
  context: ToolContext,
  effects: ToolEffects,
  input: {
    template_key?: unknown;
    employee_id?: unknown;
    employee_name?: unknown;
    policy?: unknown;
    what_happened?: unknown;
    incident_date?: unknown;
    warning_level?: unknown;
    payroll_deduct?: unknown;
    payroll_amount?: unknown;
    prior_actions?: unknown;
    incident_time?: unknown;
  },
): Promise<ToolResult> {
  /* One card per reply (the screen shows one, as today's TWO_FORMS_EACH_PERSON): the next person's form is offered. */
  if (effects.proposal) {
    return { error: `A card for ${effects.proposal.employeeName ?? "someone"} is already shown in this reply. Offer the next person's form in your reply and propose it when the manager says yes.` };
  }
  const key = typeof input.template_key === "string" ? input.template_key.trim() : "";
  const templates = await creatableTemplates(context.actor.role).catch(() => null);
  if (!templates) return { error: "The forms library could not be read just now." };
  const template = templates.find((row) => row.key === key);
  if (!template) return { error: "This manager cannot create that form. Use one of these template keys.", templates: templates.map((row) => ({ key: row.key, name: row.name })) };

  /* The person: a roster id from find_staff, or (district / region logins only) the name as typed. */
  const read = await rosterFor(context.actor.scope);
  if (read.kind === "failed") return { error: ROSTER_FAILED };
  let employee: { name: string; salonIds: readonly string[] };
  if (read.kind === "read") {
    const id = typeof input.employee_id === "string" ? input.employee_id.trim() : "";
    const person = id ? read.roster.find((row) => row.id === id) : undefined;
    const typed = typeof input.employee_name === "string" ? tidyTypedName(input.employee_name) : "";
    if (person) employee = { name: displayName(person), salonIds: person.salonIds };
    /*
     * OFF_ROSTER_CONFIRM (as today): a person not in Woven yet goes on the form by the name the manager typed, only
     * after the app offered "reply **use <name>**" and the manager said so. Never a name nobody confirmed.
     */
    else if (typed && offRosterConfirmed(context, typed)) employee = { name: typed, salonIds: [] };
    else return { error: "Give the employee_id find_staff returned for this person (call find_staff first). A name not on the roster goes on a form only after the manager answers the \"reply **use <name>**\" offer." };
  } else {
    const typedName = typeof input.employee_name === "string" ? tidyTypedName(input.employee_name) : "";
    if (!typedName) return { error: "Give the employee's name as the manager typed it." };
    employee = { name: typedName, salonIds: [] };
  }
  /*
   * HARD GUARD: the draft on screen keeps the manager's turns (OPEN_DRAFT_KEEPS_TURNS; a report of lost typing). With a
   * draft open, a second card for the same form AND the same person is refused unless the manager asked for another or
   * a new one. Another person ("the same form for <C>", "<A> and <B>") always gets their own card.
   */
  if (context.openFormId && !/\b(?:another|new|second|separate|fresh|different)\b/i.test(context.question)) {
    const open = await authorizeInstance(context.request, context.openFormId, "view").then(({ loaded }) => loaded.instance).catch(() => null);
    if (open && open.status === "draft" && open.templateKey === key && samePerson(open.employeeName, employee.name)) {
      return { error: `The ${open.templateName} draft for ${open.employeeName} is open on screen: put this on that draft with edit_form (instance_id ${open.id}). Propose a new card only if the manager asks for another or a new one.` };
    }
  }

  /* The manager's own name is never the employee (as MANAGER_NAME_NOT_EMPLOYEE does on the old path). */
  if (context.actor.displayName && samePerson(context.actor.displayName, employee.name)) {
    return { error: "That is the signed-in manager's own name, not an employee. Ask who the form is about." };
  }

  const whatHappened = typeof input.what_happened === "string" ? input.what_happened.trim().slice(0, 2_000) : "";
  const asked = managerContext(context.history as ChatMessage[], { id: context.questionMessageId, content: context.question });
  /* THIS request's turns (QA, 14 Nov 2026; THIS_PERSONS_TURNS behaviour): an earlier incident in the chat never feeds this card. */
  const personTurns = turnsFromThisPersonsRequest(asked, employee.name, { names: extractEmployeeNames, same: samePerson });
  // A later create request with its own incident ("make me a CA for <name> for being late …") starts a new form: its own turn only.
  const newRequest = context.questionMessageId && startsNewForm(context.history, context.question);
  const sourceIds = newRequest ? personTurns.filter((id) => id === context.questionMessageId) : personTurns;
  const requestWords = asked.messages
    .filter((message) => sourceIds.includes(message.id ?? ""))
    .map((message) => message.content)
    .join("\n");

  /*
   * The policy: "Other", or a heading of the manual as the manual spells it. Pau's rule (OTHER_POLICY_AGREES): a
   * cleaning or sanitation duty left undone is Other, never the Standards of Conduct; a Care and Cleaning policy the
   * manager names keeps that section; a cleaning duty beside another offense cites both.
   */
  const manual = await manualFor(context.scopeId);
  const askedPolicy = typeof input.policy === "string" ? input.policy.trim() : "";
  let policyHeading: string | null = null;
  if (askedPolicy && !/^other\b/i.test(askedPolicy)) {
    if (!manual) return { error: "The JBA Policy Manual could not be read just now, so no policy can be cited. Propose without a policy or say so." };
    policyHeading = headingOf(manual.headings, askedPolicy);
    if (!policyHeading) return { error: "That is not a heading of the JBA Policy Manual (or \"Other\"). Pick the one heading that fits what happened.", headings: manual.headings };
  }
  /*
   * CLOSE_SPELLING (the manual's own reader): a policy the manager named with a misspelling that is not one confident
   * match is confirmed, never assumed ("anmals in the wrkplace" → "Did you mean Animals in the Workplace?").
   */
  /*
   * The app's own question (`closePolicyQuestion`): one close heading, or a choice between the two or three it could
   * be ("Did you mean **Key Holder Guidelines** (page 60) or **Key Holder Requirements** (page 61)?"). Nothing is cited
   * until the manager says which.
   */
  let didYouMean: string | null = null;
  if (manual) {
    for (const named of namedPolicies(requestWords)) {
      didYouMean = closePolicyQuestion(named.phrase, manual.chunks);
      if (didYouMean) break;
    }
  }
  const confirmPolicy = didYouMean !== null;
  // The Other topic is read from the account as the model cleaned it (SPELLING_CLEANUP: "th e10 minute sanitaion" → "the 10-minute sanitation"), else the manager's words.
  const cleaning = (whatHappened ? cleaningUndonePhrase(whatHappened) : null) ?? cleaningUndonePhrase(requestWords);
  const careAndCleaning = namesCareAndCleaning(requestWords);
  /* As today's card cites it: the heading, then the page the manual prints. */
  const page = policyHeading && manual ? findManualSection(manual.chunks, [policyHeading])?.page ?? null : null;
  let policyLine: string | null = policyHeading && !confirmPolicy ? (page ? `${policyHeading}, JBA Policy Manual p.${page}` : policyHeading) : null;
  let policyNote: string | null = null;
  if (cleaning && !careAndCleaning) {
    const conduct = policyHeading !== null && /standards of conduct/i.test(policyHeading);
    policyLine = policyHeading && !conduct ? `${policyHeading}; Other — ${cleaning}` : `Other — ${cleaning}`;
    if (conduct) policyNote = "A cleaning or sanitation duty left undone is Other on the Corrective Action Form, never the Standards of Conduct (the company's rule): the card says Other.";
  } else if (/^other\b/i.test(askedPolicy)) {
    const topic = askedPolicy.replace(/^other\s*[—:-]?\s*/i, "").trim() || whatHappened.slice(0, 120);
    policyLine = topic ? `Other — ${topic}` : "Other";
  }

  /* Payroll deduct, only as the manager stated it. */
  /*
   * HARD GUARD: no invented warning level or payroll. Each is kept only when the manager's own words in this chat
   * state it (a level named; payroll deduct stated, or answered right after the payroll question; the amount's digits).
   */
  const managerWords = managerTurns(context);
  const askedPayroll = (input.payroll_deduct === "yes" || input.payroll_deduct === "no") ? input.payroll_deduct : null;
  const payroll = askedPayroll && payrollStated(context) === askedPayroll ? askedPayroll : null;
  const typedAmount = typeof input.payroll_amount === "string" && /\d/.test(input.payroll_amount) ? input.payroll_amount.replace(/[^\d.]/g, "") : null;
  const amount = typedAmount && managerWords.replace(/[^\d.]/g, " ").split(/\s+/).some((n) => n !== "" && Number(n) === Number(typedAmount)) ? typedAmount : null;
  const today = context.today || businessToday();
  const date = typeof input.incident_date === "string" && DATE.test(input.incident_date.trim()) ? input.incident_date.trim() : null;
  if (date && date > today) return { error: `The incident date ${date} is after today (${today}, the salon's local date). Ask the manager.` };
  const askedLevel = input.warning_level === "verbal" || input.warning_level === "written" ? input.warning_level : null;
  const level = askedLevel && (askedLevel === "verbal" ? /\bverbal\b/i : /\bwritten\b|\bwrite[- ]?up\b/i).test(managerWords) ? askedLevel : null;
  const dropped = [askedLevel && !level ? "warning_level" : null, askedPayroll && !payroll ? "payroll_deduct" : null, typedAmount && !amount ? "payroll_amount" : null].filter(Boolean);
  const priorActions = typeof input.prior_actions === "string" && input.prior_actions.trim() ? input.prior_actions.trim().slice(0, 600) : null;
  const incidentTime = typeof input.incident_time === "string" && input.incident_time.trim() ? input.incident_time.trim().slice(0, 40) : null;

  const proposal = buildProposal({
    proposalId: randomUUID(),
    templateKey: template.key,
    templateName: template.name,
    context: asked,
    scope: context.actor.scope,
    inlineDraftSupported: supportsInlineDraft(template.key, template.currentVersion?.variants ?? []),
    variantKey: inlineDraftVariantKey(template.currentVersion?.variants ?? []),
    today,
    employee: { kind: "resolved", employeeName: employee.name },
    employeeSalonIds: [...employee.salonIds],
  });
  /* No account yet: the card shows, and Create waits for what happened (as WHAT_HAPPENED_NO_CREATE does today). */
  const awaiting = whatHappened === "" && ACCOUNT_FORMS.has(template.key);
  const card: ChatFormProposal = {
    ...proposal,
    sourceMessageIds: sourceIds,
    formDate: date ?? proposal.formDate ?? null,
    ...(level ? { warningLevel: level } : {}),
    ...(whatHappened ? { issue: whatHappened } : {}),
    ...(payroll ? { payrollDeduct: payroll } : {}),
    ...(payroll === "yes" && amount ? { payrollDeductAmount: amount } : {}),
    ...(priorActions ? { priorActions } : {}),
    ...(incidentTime ? { incidentTime } : {}),
    ...(awaiting ? { awaitingIncident: true as const, supportsInlineDraft: false } : {}),
  };
  effects.proposal = card;
  effects.policyLine = policyLine;
  effects.confirmPolicy = didYouMean;
  return {
    card: {
      form: card.templateName,
      employee: card.employeeName,
      status: card.status,
      salon: card.locationId,
      ...(card.status === "needs_location" ? { choose_salon_from: card.authorizedLocationIds } : {}),
      form_date: card.formDate ?? null,
      warning_level: level,
      payroll_deduct: payroll,
      prior_actions: priorActions,
      policy: policyLine,
      create_offered: card.supportsInlineDraft,
    },
    card_lines: cardLines(card, template.key),
    ...(policyLine ? { policy_line: `**Policy:** ${policyLine}` } : {}),
    ...(policyNote ? { policy_note: policyNote } : {}),
    /* Pau's line, word for word, whenever the manager asked for Under Performance and the card cites the Standards of Conduct. */
    ...(policyHeading && /standards of conduct/i.test(policyHeading) && /\bunder[- ]?perform(?:ance|ing)\b/i.test(managerWords)
      ? { say_exactly: `Include this sentence in your reply, word for word: "${UNDER_PERFORMANCE_EXPLAINED}"` }
      : {}),
    ...(dropped.length > 0 ? { not_kept: `${dropped.join(", ")} left blank: the manager did not state it. Ask only if it matters; never assume it.` } : {}),
    ...(didYouMean ? { confirm_policy: `The manager's policy name is not a heading as spelled, so no policy is cited yet. End your reply with this line, word for word: ${didYouMean}` } : {}),
    note: awaiting
      ? "The card is shown under your reply with Create held until the manager says what happened: ask them what happened, in one short question."
      : "The card is shown under your reply. Nothing is saved until the manager presses Create. End your reply with the policy_line exactly.",
  };
}

/* ----------------------------------------------------------- edit form --- */

export async function editForm(
  context: ToolContext,
  effects: ToolEffects,
  input: { instance_id?: unknown; values?: unknown },
): Promise<ToolResult> {
  const id = typeof input.instance_id === "string" ? input.instance_id.trim() : "";
  if (id === "") return { error: "Give the form's instance_id." };
  const values: Record<string, string> = {};
  if (input.values && typeof input.values === "object") {
    for (const [field, value] of Object.entries(input.values as Record<string, unknown>)) {
      if (typeof value === "string") values[field] = value;
    }
  }
  try {
    const { loaded } = await authorizeInstance(context.request, id, "edit");
    /*
     * HARD GUARD: a finalized form is never written. A change to one opens a NEW draft revising it, by the same code
     * the card's "Edit as new draft" and today's chat reopen use (`openEditableDraft` → `reviseFinalizedForm`), and the
     * change is applied there; the original stays as it was (the form_instance_values_frozen trigger also holds it).
     */
    if (loaded.instance.status === "finalized") {
      const { openEditableDraft, formOpenedFor } = await import("@/lib/forms/editable-draft");
      const draft = await openEditableDraft(context.request, id, { revise: true, reason: context.question.slice(0, 500) });
      effects.formOpened = formOpenedFor(draft);
      const revisedEdit = await editForm({ ...context, openFormId: draft.instanceId }, effects, { instance_id: draft.instanceId, values: input.values });
      const opening = `I opened a new draft of the ${draft.templateName} for ${draft.employeeName} that revises the finalized one; the original is unchanged.`;
      if (effects.revisedReply) effects.revisedReply = `${opening}\n\n${effects.revisedReply}`;
      return { ...revisedEdit, revision_draft: draft.instanceId, original_unchanged: true, note: `Tell the manager: ${opening}` };
    }
    if (loaded.instance.status !== "draft") {
      return { error: `This form is ${loaded.instance.status}, so it cannot be edited here. Tell the manager.` };
    }
    /*
     * No field values: the manager's own request goes through the form's reviser (`chat-revision.ts`, the same one
     * today's chat uses), which knows each template's fields, the date, the policy reference line, the Action Plan and
     * the protected values. Its reply says what changed.
     */
    if (Object.keys(values).length === 0) {
      const revised = await openFormTurn(context, id);
      if (!revised) return { updated: [], note: "The form's reviser found nothing in the manager's message to change. Ask what they want changed." };
      const updated = revised.formUpdate?.instanceId === id ? revised.formUpdate.updated : [];
      if (updated.length > 0) {
        effects.formUpdate = { instanceId: id, updated };
        effects.revisedReply = revised.content;
      }
      return { updated, reviser_said: revised.content.slice(0, 1_500), note: updated.length > 0 ? "The reviser's own words are shown to the manager as your reply; add nothing." : undefined };
    }
    // The revision's writer, as chat-revision.ts saves: the one writer with FORM_EDIT_SINGLE_WRITER_ENABLED, else the old one.
    const written = formEditSingleWriterEnabled()
      ? await (await import("@/lib/forms/form-write")).writeRevisionEdits(id, { values }, [], { actorId: context.actor.subject, latest: context.question })
      : await applyAssistantRevision(id, { values }, [], context.actor.subject);
    const updated = Object.keys(written.accepted.values ?? {});
    if (updated.length > 0) effects.formUpdate = { instanceId: id, updated };
    return { updated, refused: written.rejected.map((row) => ({ field: row.key, reason: row.reason })) };
  } catch (error) {
    if (error instanceof InstanceNotVisibleError) return { error: "That form does not exist or this manager cannot edit it." };
    return { error: "That form could not be changed just now. Nothing was saved." };
  }
}

/**
 * The manager's turn on the open draft, through the same readers today's chat runs, in the route's order and each
 * behind its own flag: the correction ("change her name to …"), the patch reader (FORM_PATCH_REDUCER: "make it about
 * being late on 11/5/26" sets the Date, Other and Details together), the revision, and last the open-draft turn.
 * The first that answers wins; null when none reads the turn as an edit of this form.
 */
async function openFormTurn(context: ToolContext, id: string): Promise<AskResponse | null> {
  const turn = { request: context.request, instanceId: id, question: context.question, history: context.history as ChatMessage[], today: context.today || businessToday() };
  return (
    (await (await import("@/lib/forms/chat-correction")).correctActiveForm(turn)) ??
    (formPatchReducerEnabled() && !formEditToolInStreamEnabled() ? await (await import("@/lib/forms/form-patch-turn")).patchActiveForm(turn) : null) ??
    (await (await import("@/lib/forms/chat-revision")).reviseActiveForm(turn)) ??
    (formEditPlainWordsEnabled() ? await plainWordsRevision(context, id, turn) : null) ??
    (await (await import("@/lib/forms/open-draft-turn")).openDraftTurn(turn))
  );
}

/** FORM_EDIT_PLAIN_WORDS, as the route runs it: "make that update", "this is what i am wanting to coach on: …". */
async function plainWordsRevision(context: ToolContext, id: string, turn: Parameters<typeof import("@/lib/forms/chat-revision").reviseActiveForm>[0]): Promise<AskResponse | null> {
  const open = await (await import("@/lib/forms/open-form-summary")).describeOpenForm(context.request, id);
  if (!open || open.status !== "draft") return null;
  const rewritten = (await import("@/lib/forms/form-content-turn")).formContentRevision({ question: context.question, history: turn.history, templateName: open.templateName, employeeName: open.employeeName });
  if (!rewritten) return null;
  return (await import("@/lib/forms/chat-revision")).reviseActiveForm({ ...turn, question: rewritten.question, history: rewritten.history });
}

/* ----------------------------------------------------------- open form --- */

/**
 * Puts a form on file in front of the manager, as today's chat reopen does (`formOpened`): a draft opens to edit; a
 * finalized form opens read-only (its card offers "Edit as new draft"). Past forms only when asked.
 */
export async function openForm(context: ToolContext, effects: ToolEffects, input: { instance_id?: unknown }): Promise<ToolResult> {
  const id = typeof input.instance_id === "string" ? input.instance_id.trim() : "";
  if (id === "") return { error: "Give the form's instance_id (from find_past_forms)." };
  if (id !== context.openFormId && !asksAboutPastForms(context)) return { error: NOT_ASKED };
  try {
    const { loaded } = await authorizeInstance(context.request, id, "view");
    const instance = loaded.instance;
    effects.formOpened = { instanceId: instance.id, templateName: instance.templateName, revisesInstanceId: null };
    return {
      opened: true,
      form: instance.templateName,
      employee: instance.employeeName,
      status: instance.status,
      note: instance.status === "draft" ? "The draft is open on the manager's screen to edit." : "The form is open read-only; a change to it goes on a new draft revising it (edit_form).",
    };
  } catch (error) {
    if (error instanceof InstanceNotVisibleError) return { error: "That form does not exist or this manager cannot open it." };
    return { error: "That form could not be opened just now." };
  }
}

/* ------------------------------------------------------------ app help --- */

/** This app's own help, read-only: the sign-in page's words (`ai/app-password-help.ts`), never another system's. */
export async function appHelp(input: { topic?: unknown }): Promise<ToolResult> {
  const { appPasswordAnswer } = await import("@/lib/ai/app-password-help");
  if (input.topic === "password" || input.topic === "sign_in") return { answer: appPasswordAnswer(), note: "Give the manager these steps in your own short words." };
  return {
    answer:
      "Sunny answers questions from the JBA Policy Manual, looks up the manager's staff and the forms on file, and prepares HR forms (coaching, corrective action and the others the manager may create) as cards they review and Create. It does not hold sales, review or scheduling data.",
  };
}
