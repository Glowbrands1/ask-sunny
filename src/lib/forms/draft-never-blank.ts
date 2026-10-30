import { businessToday } from "@/lib/business-date";
import { jobTitleNotIncidentEnabled, levelRequestDateEnabled, requestLineAccountEnabled } from "@/lib/config/chat-quality-flags";
import { getSupabaseAdmin } from "@/lib/supabase/server";

import { JOIN } from "./bounded-context";
import { describesIncident } from "./corrective-action-intake";
import { withoutPriorStepClauses } from "./form-date-answer";
import { priorSentenceFixFor } from "./prior-sentence-scope";
import { JOB_TITLES } from "./proposal";
import { EXPECTATION_LABEL, GOING_FORWARD_LABEL, OBSERVED_LABEL } from "./narrative-draft";

/**
 * ============================================================================
 * A CORRECTIVE ACTION OR COACHING DRAFT IS NEVER FILED BLANK
 * ============================================================================
 *
 * Found in the sibling app's production, 26 Oct 2026: "create a ca for <name>
 * at dodge, ne. she was a no call no show on 10/22" — a correct card, Create
 * draft, and the prefill recorded `drafted` with `{"fields": [], "rejected":
 * []}`, from Create clicks fired several at once. This route has the same
 * gap. No guard emptied
 * the Observation. The draft route takes the model's `write_form_fields` call
 * as the draft, and a call whose `values` came back empty or omitted, or in a
 * shape the route's own responsibility check drops — JSON-encoded as a string,
 * one object per section, keyed by the field's label — left nothing to write.
 * Those drops are never reported: the write's second check only sees what
 * survived the first, so its `rejected` is empty by construction, and an empty
 * draft was recorded as a success. Intermittent because the model's output is.
 *
 * DRAFT_NEVER_BLANK_ENABLED (default off):
 *
 *   1. `readDraftedCall` reads those shapes as the text and ticks they carry.
 *      Well-formed input passes through unchanged.
 *   2. A model call that threw (429, 529, overloaded), answered with no tool
 *      call, or left no narrative although the notes hold an account is
 *      tried again, up to twice, after 1 s and then 3 s (the route does that).
 *   3. If it is still empty, the narrative is the manager's own incident
 *      account (`managerAccountClause` below) under "Observed:" alone, which
 *      is the shape the prompt asks for when no expectation can be inferred.
 *      Deterministic: never a word the manager did not type. It goes through
 *      the same guards as model text, and is recorded on a `drafted` event as
 *      `{"fallback": "manager_words"}`.
 *   4. Never a silent `{"fields": []}`: every failed or empty attempt's reason
 *      is recorded on a `drafted` event of its own.
 *
 * Pure apart from `recordDraftOutcome` and `pauseBeforeRetry`.
 */

/*
 * THE REQUEST'S OWN FOR-CLAUSE ("a CA for <name> for cash handling" → "cash
 * handling"), unless it only names the person and the salon. Used when the
 * manager's account (`managerAccountClause` below) gives no sentence of its
 * own. Never a word they did not type.
 */
const REQUEST =
  /\b(?:warning|write[- ]?up|corrective\s+action(?:\s+form)?|ca|c\/a|dpoa)\s+(?:for|about|over|regarding|re:?)\s+([^.;!?\n]+)/gi;
const CUT = /\s*(?:,|\s-\s|\s—\s|\band\b(?=\s+(?:a|an|the|also|then|she|he|they|i|we|please|pls)\b)|\bplease\b|\bpls\b|\bthanks?\b|\bthank you\b)/i;
const NOT_AN_ISSUE = /^(?:her|him|them|this|that|it|the\s+employee|my\s+employee|an?\s+employee|today|tomorrow|yesterday)$/i;
const PLACE = /\bat\s+[A-Za-z0-9][\w'.-]*(?:\s+[A-Za-z0-9][\w'.-]*){0,3}/gi;
const FILLER = /^(?:location|salon|the|a|an|for|and)$/i;

function turnsOf(text: string): string[] {
  return (text ?? "")
    .split(JOIN)
    .map((turn) => turn.trim())
    .filter(Boolean);
}

function nameWords(employeeName: string | null): Set<string> {
  return new Set((employeeName ?? "").toLowerCase().split(/\s+/).filter(Boolean));
}

/** Only the person, "at <place>" and filler: who and where, not what happened. */
function personAndPlaceOnly(issue: string, employeeName: string | null): boolean {
  const person = nameWords(employeeName);
  const rest = issue
    .replace(new RegExp(PLACE.source, "gi"), " ")
    .replace(/[^A-Za-z0-9']+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((word) => word && !FILLER.test(word));
  return rest.length === 0 || (person.size > 0 && rest.every((word) => person.has(word.toLowerCase())));
}

/*
 * JOB_TITLE_NOT_INCIDENT_ENABLED (manager, 26 Oct 2026: "create corrective
 * action form for <name>, Salon Director" / "<name>, Salon Director"): the
 * request's clause after the name was the job title, and the draft was filed
 * "Observed: Salon Director." With the flag on a clause that is only a job
 * title is no issue, so nothing is written for an incident nobody gave. Off,
 * as before.
 */
function onlyAJobTitle(issue: string): boolean {
  if (!jobTitleNotIncidentEnabled()) return false;
  const text = issue.replace(/^(?:an?|the|our|my)\s+/i, "").trim();
  if (JOB_TITLES.some((entry) => entry.pattern.test(text) && text.replace(entry.pattern, "").trim() === "")) return true;
  // "tan consultant", "front desk lead": up to three words ending on a title word.
  return /^(?:[a-z]+\s+){0,2}(?:manager|director|consultant|assistant|lead|supervisor|trainer|associate|specialist|key\s?holder|stylist|cashier|receptionist)s?$/i.test(text);
}

function issueFromRequest(text: string, employeeName: string | null): string | null {
  const person = (employeeName ?? "").trim().toLowerCase();
  for (const turn of [...turnsOf(text)].reverse()) {
    let found: string | null = null;
    for (const match of turn.matchAll(REQUEST)) {
      let raw = match[1]!;
      // "a CA for <name> for cash handling", "… <name> - cash handling": the person, then the issue.
      const words = [...nameWords(employeeName)].map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
      if (words) {
        const after = new RegExp(`^(?:(?:${words})\\s*)+(?:\\s+(?:for|about|over|regarding)\\s+|\\s*[-—–:,]\\s*)(.+)$`, "i").exec(raw.trim());
        if (after) raw = after[1]!;
      }
      const issue = raw.split(CUT)[0]!.trim().replace(/[\s"'”’)]+$/, "");
      const lower = issue.toLowerCase();
      if (issue.length < 3 || issue.length > 80 || NOT_AN_ISSUE.test(issue)) continue;
      if (person && (lower === person || lower.startsWith(`${person} `))) continue;
      if (personAndPlaceOnly(issue, employeeName)) continue;
      if (onlyAJobTitle(issue)) continue;
      found = issue;
    }
    if (found) return found;
  }
  return null;
}

export interface DraftedCall {
  values?: Record<string, string>;
  checked?: Record<string, string[]>;
}

interface FieldShape {
  readonly key: string;
  readonly label: string;
}

interface GroupShape {
  readonly key: string;
  readonly label?: string;
  readonly options: readonly { readonly key: string; readonly label: string }[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A JSON-encoded object, decoded; anything else — a bracketed placeholder included — as it came. */
function decoded(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const text = value.trim();
  if (!text.startsWith("{") || !text.endsWith("}")) return value;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return value;
  }
}

function comparable(text: string): string {
  return text
    .toLowerCase()
    .replace(/\{\{\w+\}\}/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const SECTION_LABELS: readonly string[] = [OBSERVED_LABEL, EXPECTATION_LABEL, GOING_FORWARD_LABEL];

/** "Observed", "observed:", "going_forward" → the printed label, or null. */
function sectionLabel(key: string): string | null {
  const wanted = comparable(key);
  return SECTION_LABELS.find((label) => comparable(label) === wanted) ?? null;
}

/**
 * A field's text as one string: a string as it is; one object per section as
 * the labelled sections, in the order they came; a list as its lines. Null
 * when it holds no text at all.
 */
function fieldText(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    const lines = value.filter((entry): entry is string => typeof entry === "string" && entry.trim() !== "");
    return lines.length > 0 ? lines.join("\n") : null;
  }
  if (!isRecord(value)) return null;
  const parts: string[] = [];
  for (const [key, entry] of Object.entries(value)) {
    const text = fieldText(entry);
    if (text === null || text.trim() === "") continue;
    const label = sectionLabel(key);
    parts.push(label ? `${label}\n${text.trim()}` : text.trim());
  }
  return parts.length > 0 ? parts.join("\n\n") : null;
}

/**
 * The model's tool call, read as the text and ticks it carries. Keys the form
 * names by label ("Observation of Offense", "Type of Offense", "Absenteeism")
 * are read as the keys they label; anything that matches nothing is left for
 * the route's responsibility check to refuse, as before.
 */
export function readDraftedCall(
  input: unknown,
  form: { readonly fields: readonly FieldShape[]; readonly groups: readonly GroupShape[] },
): DraftedCall {
  const call = isRecord(input) ? input : {};
  const fieldKey = (key: string) =>
    form.fields.some((field) => field.key === key)
      ? key
      : (form.fields.find((field) => comparable(field.label) === comparable(key))?.key ?? key);
  const group = (key: string) =>
    form.groups.find((entry) => entry.key === key) ??
    form.groups.find((entry) => entry.label && comparable(entry.label) === comparable(key)) ??
    null;

  const result: DraftedCall = {};
  const rawValues = decoded(call.values);
  if (isRecord(rawValues)) {
    const values: Record<string, string> = {};
    for (const [key, value] of Object.entries(rawValues)) {
      const text = fieldText(decoded(value));
      if (text !== null) values[fieldKey(key)] = text;
    }
    result.values = values;
  } else if (call.values !== undefined) {
    result.values = {};
  }

  const rawChecked = decoded(call.checked);
  if (isRecord(rawChecked)) {
    const checked: Record<string, string[]> = {};
    for (const [key, selected] of Object.entries(rawChecked)) {
      const target = group(key);
      const list = Array.isArray(selected) ? selected : typeof selected === "string" ? [selected] : [];
      const options = list
        .filter((option): option is string => typeof option === "string")
        .map(
          (option) =>
            target?.options.find((entry) => entry.key === option)?.key ??
            target?.options.find((entry) => comparable(entry.label) === comparable(option))?.key ??
            option,
        );
      checked[target?.key ?? key] = options;
    }
    result.checked = checked;
  }
  return result;
}

/*
 * THE MANAGER'S ACCOUNT, SENTENCE BY SENTENCE (the fallback's words).
 *
 * Every sentence of the latest turn that tells what happened, in the order
 * and words the manager typed — so "She never opened the salon on time. She
 * also left early on 10/20." keeps both incidents (QA-2, 26 Oct 2026). A
 * sentence counts when it describes an incident, or tells one as what did not
 * happen ("never opened", "did not clock in", "didn't show", "no call").
 *
 * NOT AN ACCOUNT: the sentence asking for the form; payroll and prior-coaching
 * lines; a negation that clears the employee ("she was never late", "never
 * had a problem", "didn't do anything wrong"); and conversation ("never
 * mind", "I never said she was late"). With no such sentence, the request's
 * own for-clause ("a CA for <name> for cash handling") is the account.
 */
const NEGATED_ACCOUNT = /\b(?:never|did\s+not|didn['’]?t|no[- ]call)\s+[a-z]/i;
const ASKS_FOR_THE_FORM =
  /\b(?:warning|write[- ]?up|corrective\s+action(?:\s+form)?|ca|c\/a|dpoa)\s+(?:for|about|over|regarding|re:?)\s/i;
/** LEVEL_REQUEST_DATED_ASK: "create a written on 10/20 for …" asks for the form too (LEVEL_REQUEST_DATE_ENABLED). */
const LEVEL_REQUEST_DATED_ASK =
  /\b(?:create|make|start|open|do|file|write|draft)\s+(?:a\s+|an\s+)?(?:verbal|written|final)(?:\s+warning)?\s+(?:on\s+)?(?<![\d/-])\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?(?![\d/-])\s+for\s/i;

function asksForTheForm(sentence: string): boolean {
  return ASKS_FOR_THE_FORM.test(sentence) || (levelRequestDateEnabled() && LEVEL_REQUEST_DATED_ASK.test(sentence));
}
const NOT_THE_INCIDENT =
  /\b(?:payroll\s+deduct|previous\s+coaching|prior\s+(?:coaching|actions?)|jba\s+(?:policy\s+)?manual)\b/i;
/* A negation that denies a fault: what follows it within a few words is the fault denied. */
const EXONERATING =
  /\b(?:never|did\s+not|didn['’]?t|was\s+not|wasn['’]?t|has\s+not|hasn['’]?t|no)\b(?:\s+[\w']+){0,4}?\s+(?:late|tardy|problems?|issues?|wrong|trouble|complaints?|mistakes?|absent|concerns?)\b/i;
/* Talk about the conversation, not about the employee. */
const CONVERSATIONAL =
  /\bnever\s*mind\b|\b(?:i|we)\s+(?:never|did\s+not|didn['’]?t)\s+(?:said|say|told|tell|meant|mean|asked|ask|thought|think|knew|know)\b/i;
const ACCOUNT_LIMIT = 400;

function isAccountSentence(sentence: string): boolean {
  if (asksForTheForm(sentence) || NOT_THE_INCIDENT.test(sentence)) return false;
  if (EXONERATING.test(sentence) || CONVERSATIONAL.test(sentence)) return false;
  return NEGATED_ACCOUNT.test(sentence) || describesIncident(sentence);
}

/*
 * REQUEST_LINE_ACCOUNT_ENABLED (QA, 26 Oct 2026; the sibling app's live blank
 * draft): "create a verbal ca for <name> at kearney ne, she was late on
 * 10-15-26" is one sentence that asks for the form, so it was no account, and
 * a draft the model left empty was neither retried nor written from the
 * manager's words. With the flag on, a sentence that asks for the form is
 * read clause by clause after its first comma. Off, unchanged.
 */
function requestLineClauses(sentence: string): string[] {
  if (!requestLineAccountEnabled() || !asksForTheForm(sentence)) return [sentence];
  const clauses = sentence.split(/,\s*/).map((clause) => clause.trim());
  return [sentence, ...clauses.slice(1)];
}

export function managerAccountClause(text: string): string | null {
  const turns = (text ?? "").split(/\n\s*\n/).map((turn) => turn.trim()).filter(Boolean);
  for (const turn of [...turns].reverse()) {
    const hits = [...turn.matchAll(/[^.!?\n]+[.!?]*/g)]
      .map((match) => match[0].trim())
      .flatMap(requestLineClauses)
      .filter((sentence) => sentence.length >= 3 && sentence.length <= 180 && isAccountSentence(sentence));
    if (hits.length === 0) continue;
    let joined = "";
    for (const sentence of hits) {
      const next = joined ? `${joined} ${sentence}` : sentence;
      if (next.length > ACCOUNT_LIMIT) break;
      joined = next;
    }
    const clause = joined.trim().replace(/[\s"'”’)]+$/, "").replace(/\.+$/, "");
    if (clause.length >= 3) return clause;
  }
  return null;
}

/**
 * The manager's account, sentence by sentence, or — with none — the request's own for-clause.
 * PRIOR_SENTENCE_FIX_ENABLED (QA-6, 26 Oct 2026): never an earlier step's clause — "ca for …,
 * coached her 10-16, written warning on 10-20" filed "Observed: Coached her 10-16." as the
 * account (`withoutPriorStepClauses`, unchanged with the flag off).
 */
function incidentClause(notes: string, employeeName: string | null): string | null {
  const own = priorSentenceFixFor(notes) ? withoutPriorStepClauses(notes, businessToday(), notes).text : notes;
  return managerAccountClause(own) ?? issueFromRequest(own, employeeName);
}

/** True when any of `keys` holds text. */
export function holdsNarrative(values: Record<string, string>, keys: readonly string[]): boolean {
  return keys.some((key) => typeof values[key] === "string" && values[key]!.trim() !== "");
}

/** True when the notes give an account of what happened, so a blank narrative is a failure. */
export function notesHoldAccount(notes: string, employeeName: string | null): boolean {
  return incidentClause(notes, employeeName) !== null;
}

/**
 * The manager's own incident clause as an Observation: "Observed:" alone, the
 * clause with its first letter capitalised and a closing full stop. Null when
 * the notes hold no clause.
 */
export function managerWordsObservation(notes: string, employeeName: string | null): string | null {
  const clause = incidentClause(notes, employeeName)?.trim();
  if (!clause) return null;
  const sentence = `${clause.charAt(0).toUpperCase()}${clause.slice(1)}`;
  return `${OBSERVED_LABEL}\n${/[.!?]$/.test(sentence) ? sentence : `${sentence}.`}`;
}

/** The pauses before the second and third attempt: short, and well inside the route's budget. */
export const DRAFT_RETRY_BACKOFF_MS: readonly number[] = [1000, 3000];

/**
 * THE TIME A DRAFT MAY SPEND BEFORE IT STOPS RETRYING, from the request's
 * start. No new attempt — model call or framework read — begins once this
 * much has gone; what is left is written as it is, or from the manager's
 * words. Comfortably under the route's `maxDuration` (120 s).
 */
export const DRAFT_TIME_BUDGET_MS = 80_000;

/** True while a new attempt may still begin. */
export function withinDraftBudget(startedAt: number, now: number = Date.now()): boolean {
  return now - startedAt <= DRAFT_TIME_BUDGET_MS;
}

export function pauseBeforeRetry(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** True when the call carried any text or tick at all. */
export function callSaidAnything(call: DraftedCall): boolean {
  return (
    Object.values(call.values ?? {}).some((value) => typeof value === "string" && value.trim() !== "") ||
    Object.values(call.checked ?? {}).some((options) => options.length > 0)
  );
}

/**
 * Why a model call that threw wrote nothing: "429 rate_limit_error",
 * "529 overloaded_error", "overloaded_error", or the error's name. Never the
 * message, which can echo the request.
 */
export function modelFailureReason(error: unknown): string {
  const record = isRecord(error) ? error : {};
  const status = typeof record.status === "number" ? record.status : null;
  const body = isRecord(record.error) ? record.error : {};
  const inner = isRecord(body.error) ? body.error : {};
  const type =
    (typeof inner.type === "string" && inner.type) ||
    (typeof body.type === "string" && body.type !== "error" && body.type) ||
    (typeof record.type === "string" && record.type) ||
    null;
  const parts = [status === null ? null : String(status), type].filter((part): part is string => Boolean(part));
  if (parts.length > 0) return `model_error ${parts.join(" ")}`;
  return `model_error ${error instanceof Error ? error.name : "unknown"}`;
}

/**
 * Why a model call that answered wrote nothing, or null when it carried
 * something: no tool call at all (with the stop reason), or a tool call with
 * no text and no tick.
 */
export function emptyCallReason(input: unknown, read: DraftedCall, stopReason: string | null): string | null {
  if (input === undefined) return `no_tool_call stop_reason=${stopReason ?? "none"}`;
  if (callSaidAnything(read)) return null;
  return "empty_tool_call";
}

/**
 * A `drafted` event of its own that says why the draft is what it is — the
 * attempts, each failure's reason, and `{"fallback": "manager_words"}` where
 * the narrative is the manager's words. The write's event is recorded by
 * `applyAssistantDraft`, which this change does not touch.
 *
 * NEVER FAILS THE DRAFT. By the time this runs the draft is written; an
 * event that could not be recorded is logged, and the manager still gets
 * their form.
 */
export async function recordDraftOutcome(
  instanceId: string,
  actor: string,
  detail: Record<string, unknown>,
): Promise<void> {
  try {
    const { error } = await getSupabaseAdmin()
      .from("form_instance_events")
      .insert({ instance_id: instanceId, kind: "drafted", actor, detail });
    if (error) throw new Error(error.message);
  } catch (error) {
    console.error(
      `[forms/instance/draft] could not record the drafted event for ${instanceId}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
