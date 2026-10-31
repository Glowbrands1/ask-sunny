import { getSupabaseAdmin } from "@/lib/supabase/server";
import { parseFormDocument } from "@/lib/forms/document";
import {
  applyAssistantDraft,
  loadInstance,
  type InstanceRow,
  type LoadedInstance,
} from "@/lib/forms/instances";
import type { FormsActor } from "@/lib/forms/access";
import { actorMaySeeInstance, authorizeInstance } from "@/lib/forms/instance-scope";
import type { AskResponse } from "@/lib/ai/types";
import {
  draftableCheckboxGroups,
  draftableFields,
  draftableNumberedLists,
} from "@/lib/forms/responsibility";

/**
 * ============================================================================
 * "DO THE SAME COACHING FORM FOR <ANOTHER PERSON>"
 * ============================================================================
 *
 * SAME_FORM_COPY_ENABLED (ported from Ask Bubbles, QA 30 Oct 2026; same flag in
 * both apps). After a
 * Coaching Form for one employee had its Details, the manager asked "Do the
 * same coaching form for <another>" and got a blank card: the details lived on
 * the first form, not in the chat, so the draft had nothing to copy. Then "can
 * you create the same draft that we did with <first> by changing the name and
 * position?" printed the content in the reply and left the card as it was.
 *
 * The content of the manager's OWN earlier form of the same template — the
 * fields the assistant may write, never who, where, when or a signature — is
 * copied onto the new person's draft, the first person's name swapped for the
 * new one's. Only forms this account created and may still see; the one the
 * manager names, else the newest for somebody else.
 */

/** "the same coaching form for …", "same draft that we did with …", "do the same for …". */
const SAME =
  /\b(?:the\s+)?same\s+(?:(?:coaching|corrective\s+action|ca|follow[- ]?up(?:\s+coaching)?)\s+)?(?:form|draft|one|card|thing|details|content|coaching)\b|\bdo\s+the\s+same\b|\bsame\s+as\s+(?:the\s+one\s+)?(?:we\s+did\s+)?(?:for|with)\b|\b(?:copy|duplicate)\s+(?:the|that|this|her|his|their)\s+(?:form|draft|coaching|card)\b/i;

export function asksForSameForm(text: string): boolean {
  return SAME.test(text);
}

function escaped(word: string): string {
  return word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function nameWords(name: string): string[] {
  return name
    .toLowerCase()
    .split(/[^a-z'-]+/)
    .filter((word) => word.length > 1);
}

/** Does the text name this employee (their full name, or their first and last name apart)? */
function names(text: string, employeeName: string): boolean {
  const words = nameWords(employeeName);
  if (words.length === 0) return false;
  const lower = text.toLowerCase();
  if (words.length === 1) return new RegExp(`\\b${escaped(words[0]!)}\\b`).test(lower);
  return words.every((word) => new RegExp(`\\b${escaped(word)}\\b`).test(lower));
}

function sameName(a: string, b: string): boolean {
  return nameWords(a).join(" ") === nameWords(b).join(" ");
}

/**
 * The manager's own earlier form of this template, for a different employee:
 * the one the text names, else the newest. Read with the creator and template
 * in the query, so no other account's form is ever read, and re-checked with
 * the form guard's own rule.
 */
export async function findOwnCopySource(input: {
  actor: FormsActor;
  templateKey: string;
  /** The form being filled — never its own source. */
  targetInstanceId: string;
  targetEmployeeName: string;
  text: string;
  /** Only a form whose employee the text names (with a draft open, never "the newest"). */
  namedOnly?: boolean;
}): Promise<LoadedInstance | null> {
  const { data, error } = await getSupabaseAdmin()
    .from("form_instance_overview")
    .select("id, employee_name, created_by, template_key, created_at, archived_at")
    .eq("created_by", input.actor.id)
    .eq("template_key", input.templateKey)
    .is("archived_at", null)
    .order("created_at", { ascending: false })
    .limit(20);
  if (error || !data) return null;

  const others = (data as { id: string; employee_name: string | null; created_by: string }[]).filter(
    (row) =>
      row.id !== input.targetInstanceId &&
      row.created_by === input.actor.id &&
      row.employee_name &&
      !sameName(row.employee_name, input.targetEmployeeName),
  );
  const named = others.find((row) => names(input.text, row.employee_name!));
  if (input.namedOnly && !named) return null;
  for (const row of named ? [named] : others) {
    const loaded = await loadInstance(row.id);
    if (!loaded || loaded.instance.createdBy !== input.actor.id) continue;
    if (!actorMaySeeInstance(input.actor, loaded.instance)) continue;
    if (hasContent(loaded)) return loaded;
  }
  return null;
}

function hasContent(loaded: LoadedInstance): boolean {
  const keys = contentKeys(loaded);
  return loaded.values.some(
    (row) => keys.has(row.fieldKey) && (Boolean(row.value?.trim()) || row.checked.length > 0),
  );
}

/** The keys the assistant may write on this form's version, minus anything that quotes policy. */
function contentKeys(loaded: LoadedInstance): Set<string> {
  const document = parseFormDocument(loaded.version.document);
  const variant = loaded.instance.variantKey;
  return new Set([
    ...draftableFields(document, variant)
      .filter((field) => !field.policyGrounded)
      .map((field) => field.key),
    ...draftableCheckboxGroups(document, variant).map((group) => group.key),
    ...draftableNumberedLists(document, variant).map((list) => list.key),
  ]);
}

/** The first person's name, full and first, becomes the new person's in copied text. */
function swapName(text: string, from: string, to: string): string {
  const fromWords = from.trim().split(/\s+/).filter(Boolean);
  const toWords = to.trim().split(/\s+/).filter(Boolean);
  if (fromWords.length === 0 || toWords.length === 0) return text;
  let out = text.replace(new RegExp(`\\b${escaped(fromWords.join(" "))}\\b`, "gi"), toWords.join(" "));
  out = out.replace(new RegExp(`\\b${escaped(fromWords[0]!)}\\b`, "gi"), toWords[0]!);
  if (fromWords.length > 1) {
    out = out.replace(new RegExp(`\\b${escaped(fromWords[fromWords.length - 1]!)}\\b`, "gi"), toWords[toWords.length - 1]!);
  }
  return out;
}

/**
 * Copies the source's content onto the target draft. A field the manager typed
 * on the target is kept. Returns the keys written (empty when nothing was).
 */
export async function copyFormContent(input: {
  source: LoadedInstance;
  target: LoadedInstance;
  actorId: string;
}): Promise<{ values: Record<string, string>; checked: Record<string, string[]> }> {
  const { source, target } = input;
  const keys = contentKeys(target);
  const sourceKeys = contentKeys(source);
  const managerTyped = new Set(
    target.values
      .filter((row) => row.filledBy === "manager" && (Boolean(row.value?.trim()) || row.checked.length > 0))
      .map((row) => row.fieldKey),
  );
  const values: Record<string, string> = {};
  const checked: Record<string, string[]> = {};
  for (const row of source.values) {
    if (!keys.has(row.fieldKey) || !sourceKeys.has(row.fieldKey) || managerTyped.has(row.fieldKey)) continue;
    if (row.value?.trim()) {
      values[row.fieldKey] = swapName(row.value, source.instance.employeeName, target.instance.employeeName);
    }
    if (row.checked.length > 0) checked[row.fieldKey] = [...row.checked];
  }
  if (Object.keys(values).length === 0 && Object.keys(checked).length === 0) return { values, checked };
  const provenance = Object.fromEntries(
    [...Object.keys(values), ...Object.keys(checked)].map((key) => [
      key,
      { source: "copied_form", fromInstanceId: source.instance.id },
    ]),
  );
  const written = await applyAssistantDraft(target.instance.id, { values, checked }, input.actorId, provenance);
  return written.accepted;
}

export function copiedNotice(source: InstanceRow): string {
  return `Copied the content of ${source.employeeName}'s ${source.templateName} onto this draft. Check it reads right for this person.`;
}

/**
 * With a draft open: "can you create the same draft that we did with <name> by
 * changing the name and position?" — the named person's form (this manager's
 * own, same template, somebody other than the open form's employee) copied
 * onto the open draft. Null unless such a form is named, so every other turn
 * is answered as before.
 */
export async function copyIntoOpenForm(input: {
  request: Request;
  instanceId: string;
  question: string;
}): Promise<AskResponse | null> {
  if (!asksForSameForm(input.question)) return null;
  let authorized: Awaited<ReturnType<typeof authorizeInstance>>;
  try {
    authorized = await authorizeInstance(input.request, input.instanceId, "edit");
  } catch {
    return null;
  }
  const { actor, loaded } = authorized;
  if (loaded.instance.status !== "draft") return null;
  const source = await findOwnCopySource({
    actor,
    templateKey: loaded.instance.templateKey,
    targetInstanceId: loaded.instance.id,
    targetEmployeeName: loaded.instance.employeeName,
    text: input.question,
    namedOnly: true,
  });
  if (!source) return null;
  const copied = await copyFormContent({ source, target: loaded, actorId: actor.id });
  const updated = [...new Set([...Object.keys(copied.values), ...Object.keys(copied.checked)])];
  if (updated.length === 0) return null;
  return {
    content: `Copied ${source.instance.employeeName}'s ${source.instance.templateName} content onto ${loaded.instance.employeeName}'s draft, with the name changed. Who, where and when are this draft's own. Check the card reads right for ${loaded.instance.employeeName}, then save or finalize.`,
    citations: [],
    coverage: "not_applicable",
    recommendedVideoIds: [],
    formUpdate: { instanceId: loaded.instance.id, updated },
  };
}
