import "server-only";

import { randomUUID } from "node:crypto";

import { DEFAULT_PERMISSION_MATRIX, hasPermission } from "@/lib/permissions";
import { businessToday } from "@/lib/business-date";
import { candidateNameWords, chatFormsActor } from "@/lib/forms/chat-form-records";
import { displayName, type RosterEmployee } from "@/lib/forms/employee-match";
import { readScopedRoster } from "@/lib/forms/employee-roster";
import { inlineDraftVariantKey, supportsInlineDraft } from "@/lib/forms/inline-draft";
import { authorizeInstance, InstanceNotVisibleError, instanceListFilterFor, visibleInstances } from "@/lib/forms/instance-scope";
import { applyAssistantRevision, listInstances } from "@/lib/forms/instances";
import { formEditSingleWriterEnabled } from "@/lib/config/chat-quality-flags";
import { findManualSection, manualSectionHeadings, type ManualChunk } from "@/lib/forms/official-policy-manual";
import { sectionWording } from "@/lib/forms/policy-citation";
import { buildProposal, managerContext, samePerson, tidyTypedName } from "@/lib/forms/proposal";
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
}

/** What the turn's tools produced for the reply: the card and the edit, when there were any. */
export interface ToolEffects {
  proposal: ChatFormProposal | null;
  policyHeading: string | null;
  formUpdate: { instanceId: string; updated: string[] } | null;
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

function staffRow(person: RosterEmployee) {
  return { employee_id: person.id, name: displayName(person), salons: [...person.salonIds] };
}

export async function findStaff(context: ToolContext, input: { name?: unknown }): Promise<ToolResult> {
  const typed = typeof input.name === "string" ? input.name.trim() : "";
  if (typed === "") return { error: "Give the name to look for." };
  const read = await rosterFor(context.actor.scope);
  if (read.kind === "failed") return { error: ROSTER_FAILED };
  if (read.kind === "unchecked") return { unchecked: true, note: ROSTER_UNCHECKED };
  const found = rosterMatches(typed, read.roster).slice(0, 10);
  if (found.length === 0) {
    return { matches: [], note: "Nobody on this manager's roster has that name. It may be a salon, a place or a typo: ask the manager; never put it on a form as a person." };
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

export async function proposeForm(
  context: ToolContext,
  effects: ToolEffects,
  input: { template_key?: unknown; employee_id?: unknown; employee_name?: unknown; policy?: unknown; what_happened?: unknown; incident_date?: unknown; warning_level?: unknown },
): Promise<ToolResult> {
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
    if (!person) return { error: "Give the employee_id find_staff returned for this person (call find_staff first). Never a name that is not on the roster." };
    employee = { name: displayName(person), salonIds: person.salonIds };
  } else {
    const typed = typeof input.employee_name === "string" ? tidyTypedName(input.employee_name) : "";
    if (!typed) return { error: "Give the employee's name as the manager typed it." };
    employee = { name: typed, salonIds: [] };
  }
  /* The manager's own name is never the employee (as MANAGER_NAME_NOT_EMPLOYEE does on the old path). */
  if (context.actor.displayName && samePerson(context.actor.displayName, employee.name)) {
    return { error: "That is the signed-in manager's own name, not an employee. Ask who the form is about." };
  }

  /* The policy: a heading of the manual, as the manual spells it. */
  const manual = await manualFor(context.scopeId);
  const askedPolicy = typeof input.policy === "string" ? input.policy.trim() : "";
  let policyHeading: string | null = null;
  if (askedPolicy) {
    if (!manual) return { error: "The JBA Policy Manual could not be read just now, so no policy can be cited. Propose without a policy or say so." };
    policyHeading = headingOf(manual.headings, askedPolicy);
    if (!policyHeading) return { error: "That is not a heading of the JBA Policy Manual. Pick the one heading that fits what happened.", headings: manual.headings };
  }

  const whatHappened = typeof input.what_happened === "string" ? input.what_happened.trim().slice(0, 2_000) : "";
  const today = context.today || businessToday();
  const date = typeof input.incident_date === "string" && DATE.test(input.incident_date.trim()) ? input.incident_date.trim() : null;
  if (date && date > today) return { error: `The incident date ${date} is after today (${today}, the salon's local date). Ask the manager.` };
  const level = input.warning_level === "verbal" || input.warning_level === "written" ? input.warning_level : null;

  const proposal = buildProposal({
    proposalId: randomUUID(),
    templateKey: template.key,
    templateName: template.name,
    context: managerContext(context.history as ChatMessage[], { id: context.questionMessageId, content: context.question }),
    scope: context.actor.scope,
    inlineDraftSupported: supportsInlineDraft(template.key, template.currentVersion?.variants ?? []),
    variantKey: inlineDraftVariantKey(template.currentVersion?.variants ?? []),
    today,
    employee: { kind: "resolved", employeeName: employee.name },
    employeeSalonIds: [...employee.salonIds],
  });
  const card: ChatFormProposal = {
    ...proposal,
    formDate: date ?? proposal.formDate ?? null,
    ...(level ? { warningLevel: level } : {}),
    ...(whatHappened ? { issue: whatHappened } : {}),
  };
  effects.proposal = card;
  effects.policyHeading = policyHeading;
  return {
    card: {
      form: card.templateName,
      employee: card.employeeName,
      status: card.status,
      salon: card.locationId,
      ...(card.status === "needs_location" ? { choose_salon_from: card.authorizedLocationIds } : {}),
      form_date: card.formDate ?? null,
      warning_level: level,
      policy: policyHeading,
    },
    note: "The card is shown under your reply. Nothing is saved until the manager presses Create.",
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
  if (Object.keys(values).length === 0) return { error: "Give at least one field key and its new text." };
  try {
    const { loaded } = await authorizeInstance(context.request, id, "edit");
    // Finalized forms are never edited here (instances.ts's draft-only checks and the database trigger also refuse).
    if (loaded.instance.status !== "draft") {
      return { error: `This form is ${loaded.instance.status}, not a draft, so it cannot be edited. Tell the manager; a finalized form is changed only by opening a revision on Form Monitoring.` };
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
