import { getSupabaseAdmin } from "@/lib/supabase/server";
import { JOIN } from "@/lib/forms/bounded-context";
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

/*
 * A COPY IS ASKED FOR IN SO MANY WORDS (independent review, 31 Oct 2026). The
 * first reading took "same thing", "same one", "same details" anywhere —
 * "She was late again today, same thing as last week" filled the new form
 * from another person's. Now only a request to make "the same coaching form /
 * draft", to "copy <someone's> form", or "the same form as / that we did".
 */
const KIND = String.raw`(?:(?:coaching|corrective\s+action|ca|follow[- ]?up(?:\s+coaching)?)\s+)?(?:form|draft)`;
const SAME = new RegExp(
  [
    String.raw`\b(?:do|create|make|start|draft|build|write|copy|duplicate|need|want)\b[^.?!\n]{0,40}?\bthe\s+same\s+${KIND}\b`,
    String.raw`\b(?:copy|duplicate)\s+(?:the|that|this|her|his|their|[a-z]+'s)\s+${KIND}\b`,
    String.raw`\bsame\s+${KIND}\s+(?:as|that\s+we\s+did|we\s+did)\b`,
  ].join("|"),
  "i",
);

/** An account of what happened: never a request to copy, whatever else it says. */
const INCIDENT =
  /\b(?:was|were|late|tardy|absent|no[- ]?(?:call|show)|yell(?:ed|ing)?|rude|left\s+early|clocked|again|today|yesterday|last\s+(?:week|night|shift)|did\s+the\s+same\s+thing)\b/i;

/** At most this many words in a copy request — a longer turn is the manager's own account. */
const MAX_REQUEST_WORDS = 25;

export function asksForSameForm(text: string): boolean {
  const turn = text.trim();
  if (!SAME.test(turn) || INCIDENT.test(turn)) return false;
  return turn.split(/\s+/).length <= MAX_REQUEST_WORDS;
}

/**
 * The card's own request: the last manager turn of the notes the Create step
 * sends (`boundManagerTurns` joins them with a blank line). An earlier "do the
 * same" in the chat belongs to another card.
 */
export function requestTurn(notes: string): string {
  const turns = notes.split(JOIN).map((turn) => turn.trim()).filter(Boolean);
  return turns.at(-1) ?? "";
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

/*
 * A NAME THAT IS ALSO A WORD IS NOT SWAPPED ON ITS OWN (independent review,
 * 31 Oct 2026): the swap ran case-insensitively over every word, so a source
 * employee called Will turned "this will not happen again" into "this <new
 * name> not happen again". The full name is swapped wherever it appears; a
 * first or last name alone only as a capitalised whole word, and never when it
 * is also an ordinary word (then only the full name is swapped). Pronouns are
 * not changed — the notice says to check them.
 */
const NAME_WORDS = new Set(
  [
    "will", "mark", "grace", "joy", "hope", "faith", "rose", "may", "june", "april", "art", "bill", "frank",
    "sue", "pat", "chase", "dawn", "eve", "summer", "autumn", "ray", "rich", "sky", "star", "page", "ruby",
    "amber", "ivy", "holly", "lane", "dean", "gene", "glen", "guy", "jack", "max", "miles", "penny", "robin",
    "sandy", "wade", "drew", "hunter", "taylor", "carter", "parker", "brown", "young", "long", "white",
    "black", "green", "gray", "grey", "king", "hall", "wood", "hill", "lee", "price", "cash", "early",
  ],
);

export function swapName(text: string, from: string, to: string): string {
  const fromWords = from.trim().split(/\s+/).filter(Boolean);
  const toWords = to.trim().split(/\s+/).filter(Boolean);
  if (fromWords.length === 0 || toWords.length === 0) return text;
  let out = text.replace(new RegExp(`\\b${escaped(fromWords.join(" "))}\\b`, "gi"), toWords.join(" "));
  const alone = (word: string, replacement: string) => {
    if (NAME_WORDS.has(word.toLowerCase())) return;
    const capitalised = word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    out = out.replace(new RegExp(`\\b${escaped(capitalised)}\\b`, "g"), replacement);
  };
  alone(fromWords[0]!, toWords[0]!);
  if (fromWords.length > 1) alone(fromWords[fromWords.length - 1]!, toWords[toWords.length - 1]!);
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

/** The labels of content fields the target already fills that the source would replace. */
function filledContentKeys(target: LoadedInstance, source: LoadedInstance): string[] {
  const keys = contentKeys(target);
  const fromSource = new Set(
    source.values.filter((row) => keys.has(row.fieldKey) && (Boolean(row.value?.trim()) || row.checked.length > 0)).map((row) => row.fieldKey),
  );
  const fields = draftableFields(parseFormDocument(target.version.document), target.instance.variantKey);
  const label = (key: string) => fields.find((field) => field.key === key)?.label ?? key;
  return target.values
    .filter((row) => fromSource.has(row.fieldKey) && Boolean(row.value?.trim()))
    .map((row) => label(row.fieldKey));
}

export function copiedNotice(source: InstanceRow): string {
  return `Copied the content of ${source.employeeName}'s ${source.templateName} onto this draft. Check it reads right for this person, pronouns included.`;
}

/** A sentence that adds to the open form is never a request to copy another one onto it. */
const ADDS = /^\s*(?:please\s+)?(?:add|include|note|put|write|mention|also)\b/i;

/** The question this asks before replacing what the open draft already says. */
const REPLACE_ASK = "Replace them with";
const CONFIRMS = /^\s*(?:yes|yep|yeah|ok(?:ay)?|sure|go\s+ahead)\b[^?]*\breplace\b|^\s*(?:yes|yep|yeah)[.!]*\s*$/i;

function lastAssistantText(history: readonly { role: string; content?: string | null }[]): string {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    if (history[index]!.role === "assistant") return history[index]!.content ?? "";
  }
  return "";
}

/**
 * With a draft open: "can you create the same draft that we did with <name> by
 * changing the name and position?" — the named person's form (this manager's
 * own, same template, somebody other than the open form's employee) copied
 * onto the open draft. Null unless such a form is named, so every other turn
 * is answered as before.
 *
 * Independent review, 31 Oct 2026: "Add that she did the same thing as Remy
 * Calder last week" overwrote the open draft. Now only an explicit copy request
 * (see `asksForSameForm`), never a sentence that adds to the form, and when
 * the draft already says something in the fields a copy would fill, it asks
 * first and copies only on "yes, replace them".
 */
/**
 * QA, live retest, 31 Oct 2026: with Marnie's draft open (no details yet), "Do
 * the same coaching form for remy calder" copied an EARLIER Remy Calder form
 * of this account onto Marnie's draft ("Copied Remy Calder's Coaching Form
 * content onto Marnie Holloway's draft") and no Remy card came. A person named
 * right after "the same <form> for" is who the new form is for; the open-form
 * copy takes its source only from "the same draft that we did with <name>",
 * "same as <name>'s". Under SAME_FORM_COPY_ENABLED.
 */
function namedAsTarget(text: string, employeeName: string): boolean {
  const words = nameWords(employeeName);
  if (words.length === 0) return false;
  const name = `(?:${words.map(escaped).join("\\s+")}|${escaped(words[0]!)})`;
  const form = String.raw`(?:\s+(?:coaching|corrective|action|ca|follow-?up|form|draft|card|one|thing))*`;
  return new RegExp(String.raw`\bsame${form}\s+for\s+${name}\b`, "i").test(text);
}

export async function copyIntoOpenForm(input: {
  request: Request;
  instanceId: string;
  question: string;
  history?: readonly { role: string; content?: string | null }[];
}): Promise<AskResponse | null> {
  const previous = lastAssistantText(input.history ?? []);
  const asked = previous.includes(REPLACE_ASK) ? /\*\*([^*]+)\*\*'s \w[^?]*\?\s*Say \*\*yes, replace them\*\*/.exec(previous)?.[1] ?? null : null;
  const confirmed = asked !== null && CONFIRMS.test(input.question);
  if (!confirmed && (ADDS.test(input.question) || !asksForSameForm(input.question))) return null;
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
    text: confirmed ? asked! : input.question,
    namedOnly: true,
  });
  if (!source) return null;
  // "Do the same coaching form for remy calder": Remy is who the new form is for, never the source.
  if (!confirmed && namedAsTarget(input.question, source.instance.employeeName)) return null;
  if (!confirmed) {
    const filled = filledContentKeys(loaded, source);
    if (filled.length > 0) {
      return {
        content: `${loaded.instance.employeeName}'s draft already has ${filled.join(", ")}. ${REPLACE_ASK} **${source.instance.employeeName}**'s ${source.instance.templateName} content, with the name changed? Say **yes, replace them** to copy it, or tell me what to change instead.`,
        citations: [],
        coverage: "not_applicable",
        recommendedVideoIds: [],
      };
    }
  }
  const copied = await copyFormContent({ source, target: loaded, actorId: actor.id });
  const updated = [...new Set([...Object.keys(copied.values), ...Object.keys(copied.checked)])];
  if (updated.length === 0) return null;
  return {
    content: `Copied ${source.instance.employeeName}'s ${source.instance.templateName} content onto ${loaded.instance.employeeName}'s draft, with the name changed. Who, where and when are this draft's own. Check the card reads right for ${loaded.instance.employeeName} (pronouns are not changed), then save or finalize.`,
    citations: [],
    coverage: "not_applicable",
    recommendedVideoIds: [],
    formUpdate: { instanceId: loaded.instance.id, updated },
  };
}
