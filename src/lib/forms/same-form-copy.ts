import { getSupabaseAdmin } from "@/lib/supabase/server";
import type { AskResponse } from "@/lib/ai/types";
import { applyAssistantDraft, loadInstance, type LoadedInstance } from "./instances";
import { authorizeInstance } from "./instance-scope";
import type { DraftValues } from "./responsibility";

/**
 * ============================================================================
 * "DO THE SAME COACHING FORM FOR REMY CALDER"
 * ============================================================================
 *
 * SAME_FORM_COPY_ENABLED (QA, 30 Oct 2026; same flag in both apps). After a
 * Coaching Form for one employee was written, the manager asked for "the same
 * coaching form" for another, then "the same draft that we did with <her> by
 * changing the name and position". The new card was drafted from that one
 * sentence — blank — and the follow-ups were answered in prose.
 *
 * The form copied is the manager's OWN: the most recent form of the same
 * template they created for a different employee, or the one for the person
 * they name ("that we did with Marnie Holloway"). Its content fields are
 * written into the new draft with the earlier employee's name changed to the
 * new one; who, where, when and the signatures are never copied, and
 * `applyAssistantDraft` writes only what the assistant may write.
 */

const SAME = /\bsame\s+(?:\w+\s+){0,2}(?:form|draft|one|write-?up|coaching)\b|\bsame\s+as\b/i;

/** "that we did with marnie holloway", "same as marnie's", "copy marnie holloway's". */
const NAMED_SOURCE =
  /\b(?:(?:we|i)\s+(?:did|made|wrote|created|had)\s+(?:with|for)|same\s+as|copy(?:\s+of)?|from)\s+([a-z][\w'-]*(?:\s+(?!by\b|and\b|but\b|with\b|for\b|to\b)[a-z][\w'-]*)?)/i;

/** Never carried from one person's form to another's. */
const NOT_COPIED = /^(?:employee_name|employee|job_title|position|location|store|salon|form_date|date)$|(?:^|_)(?:date|signature|signed|name)(?:_|$)/i;

export function asksForSameForm(text: string): boolean {
  return SAME.test(text ?? "");
}

export function namedSource(text: string): string | null {
  const words = (NAMED_SOURCE.exec(text ?? "")?.[1] ?? "").trim().split(/\s+/).filter(Boolean);
  // "marnie's please": the possessive ends the name.
  const end = words.findIndex((word) => /'s$/i.test(word));
  const name = (end >= 0 ? words.slice(0, end + 1) : words).join(" ").replace(/'s$/i, "");
  return name.length > 1 ? name : null;
}

function samePerson(a: string, b: string): boolean {
  const norm = (value: string) => value.trim().toLowerCase().replace(/\s+/g, " ");
  const x = norm(a);
  const y = norm(b);
  if (!x || !y) return false;
  return x === y || x.split(" ")[0] === y || y.split(" ")[0] === x || (x.includes(" ") && y.includes(" ") && x.split(" ")[0] === y.split(" ")[0] && x.split(" ").at(-1) === y.split(" ").at(-1));
}

function escape(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The earlier employee's name, whole and first, changed to the new one's. */
function renamed(text: string, from: string, to: string): string {
  const [fromFirst] = from.trim().split(/\s+/);
  const [toFirst] = to.trim().split(/\s+/);
  let out = text.replace(new RegExp(`\\b${escape(from.trim())}\\b`, "gi"), to.trim());
  if (fromFirst && toFirst && fromFirst.length > 1) out = out.replace(new RegExp(`\\b${escape(fromFirst)}\\b`, "gi"), toFirst);
  return out;
}

/** The manager's own earlier form of this template, for someone else. */
export async function findCopySource(input: {
  actorId: string;
  target: LoadedInstance["instance"];
  named: string | null;
}): Promise<LoadedInstance | null> {
  const { data, error } = await getSupabaseAdmin()
    .from("form_instances")
    .select("id, employee_name, created_at")
    .eq("created_by", input.actorId)
    .eq("template_id", input.target.templateId)
    .is("archived_at", null)
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) return null;
  const rows = ((data ?? []) as { id: string; employee_name: string | null }[]).filter(
    (row) => row.id !== input.target.id && row.employee_name && !samePerson(row.employee_name, input.target.employeeName),
  );
  const row = input.named ? rows.find((candidate) => samePerson(candidate.employee_name!, input.named!)) : rows[0];
  return row ? loadInstance(row.id) : null;
}

/** The source's content, ready to write into the target. */
export function copiedValues(source: LoadedInstance, toEmployee: string): DraftValues {
  const values: Record<string, string> = {};
  const checked: Record<string, string[]> = {};
  const from = source.instance.employeeName;
  for (const row of source.values) {
    if (NOT_COPIED.test(row.fieldKey)) continue;
    if (row.checked.length > 0) checked[row.fieldKey] = [...row.checked];
    if (row.value && row.value.trim()) values[row.fieldKey] = renamed(row.value, from, toEmployee);
  }
  return { values, checked };
}

/** Writes the source's content into the target draft; the fields written, or null. */
export async function copyFormContent(input: {
  actorId: string;
  target: LoadedInstance;
  named: string | null;
}): Promise<{ source: LoadedInstance; written: DraftValues } | null> {
  const source = await findCopySource({ actorId: input.actorId, target: input.target.instance, named: input.named });
  if (!source) return null;
  const copy = copiedValues(source, input.target.instance.employeeName);
  if (Object.keys(copy.values).length === 0 && Object.keys(copy.checked).length === 0) return null;
  const result = await applyAssistantDraft(input.target.instance.id, copy, input.actorId);
  return { source, written: result.accepted };
}

/**
 * "can you create the same draft that we did with marnie holloway by changing
 * the name and position?" with another employee's draft open: that form's
 * content, copied into the open draft. Null unless the turn asks for the same
 * form AND names whose it was — "the same coaching form for <someone else>" is
 * a new card, not this.
 */
export async function copyIntoOpenForm(input: {
  request: Request;
  instanceId: string;
  question: string;
}): Promise<AskResponse | null> {
  if (!asksForSameForm(input.question)) return null;
  const named = namedSource(input.question);
  if (!named) return null;
  let authorized: Awaited<ReturnType<typeof authorizeInstance>>;
  try {
    authorized = await authorizeInstance(input.request, input.instanceId, "edit");
  } catch {
    return null;
  }
  const { actor, loaded } = authorized;
  if (loaded.instance.status !== "draft" || samePerson(named, loaded.instance.employeeName)) return null;
  const copied = await copyFormContent({ actorId: actor.id, target: loaded, named });
  if (!copied) return null;
  const keys = [...Object.keys(copied.written.values), ...Object.keys(copied.written.checked)];
  if (keys.length === 0) return null;
  return {
    content: `Copied the **${loaded.instance.templateName}** content from **${copied.source.instance.employeeName}**'s form into **${loaded.instance.employeeName}**'s draft, with the name changed. Who, where and when stay as they are on this draft. Check it on the card before you finalize.`,
    citations: [],
    coverage: "not_applicable",
    recommendedVideoIds: [],
    formUpdate: { instanceId: loaded.instance.id, updated: keys },
  };
}
