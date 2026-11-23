import { createHash } from "node:crypto";

import { readDates, sameDate, withoutDates } from "./dates";
import { identifiedTurns, readEvidence, verifyEvidence } from "./evidence";
import type { ChatMessage } from "@/types";

/**
 * ============================================================================
 * AN OPEN "WHICH ONE?" IS ANSWERED BY THE MANAGER, NEVER BY THE MODEL (QA's Bubbles live re-run, 22 Nov 2026, A11)
 * ============================================================================
 *
 * T1 "bring up a previously edited corrective action for <P>" listed three revised Corrective Actions and asked which
 * one to open. T2 "this is a verbal warning. previous coaching policy manual 10-15-26" picked none of them, yet the loop
 * opened a new draft revising one of the finalized forms and saved a warning level and Prior actions the manager never
 * gave, then asked for "the change you still need again".
 *
 * The mechanism, read from the forms' own data and no wording:
 *
 *   RECORD   a turn whose find_past_forms asked which_form_question writes `slots.agent_loop.which_form`: each listed
 *            form's one-way key and the facts that tell it apart (its form, status, date, salon). No names, no ids.
 *   CHECK    while the last reply's which-form question is open, open_form (and edit_form of a form on file) of a listed
 *            form needs `choice_evidence`: the manager's words from THIS message that pick it, by one of its facts that
 *            the other listed forms do not share, or by its number in the list. Anything else is refused: nothing is
 *            opened, nothing is written, and the model asks again, keeping what the manager said for the form they pick.
 */

export interface WhichFormEntry {
  /** One-way key of the form's id. */
  readonly key: string;
  /** What tells it apart, as listed: the form's name, its status, its date (ISO), its salon ("no salon" included). */
  readonly form: string | null;
  readonly status: string | null;
  readonly date: string | null;
  readonly salon: string | null;
}

export interface WhichFormSlot {
  readonly forms: readonly WhichFormEntry[];
}

export interface WhichFormRecord extends WhichFormSlot {
  readonly messageId: string | null;
  readonly questionKey?: string | null;
}

export function formKey(instanceId: string): string {
  return createHash("sha256").update(`which-form:${instanceId.trim().toLowerCase()}`).digest("hex").slice(0, 16);
}

export function whichFormEntry(form: { instance_id: string; form?: string | null; status?: string | null; form_date?: string | null; salon?: string | null }): WhichFormEntry {
  return { key: formKey(form.instance_id), form: form.form ?? null, status: form.status ?? null, date: form.form_date ?? null, salon: form.salon ?? null };
}

export function isWhichFormSlot(value: unknown): value is WhichFormSlot {
  const slot = value as Partial<WhichFormSlot> | null;
  return Boolean(slot) && Array.isArray(slot!.forms) && slot!.forms.length > 1 && slot!.forms.every((entry) => Boolean(entry) && typeof (entry as WhichFormEntry).key === "string");
}

const flat = (text: string) => ` ${text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;

/** Whether the quote names this entry's value of `field` and that value is not every listed form's. */
function picksBy(quote: string, entry: WhichFormEntry, all: readonly WhichFormEntry[], field: "form" | "status" | "salon"): boolean {
  const value = entry[field];
  if (!value || flat(value).trim() === "") return false;
  if (all.every((other) => (other[field] ?? "").toLowerCase() === value.toLowerCase())) return false;
  return flat(quote).includes(flat(value));
}

function picksByDate(quote: string, entry: WhichFormEntry, all: readonly WhichFormEntry[]): boolean {
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(entry.date ?? "");
  if (!iso) return false;
  const own = { month: Number(iso[2]), day: Number(iso[3]), year: Number(iso[1]) };
  if (all.every((other) => other.date === entry.date)) return false;
  return [...readDates(quote), ...runTogetherDates(quote)].some((said) => sameDate(said, own));
}

/**
 * A date typed as eight digits with nothing between them ("11202026", a live manager's answer to "which one?", Pau's
 * review, 23 Nov 2026): month, day and four-digit year, read only when they make a real calendar date.
 */
function runTogetherDates(quote: string): { month: number; day: number; year: number }[] {
  return [...quote.matchAll(/(?<!\d)(\d{2})(\d{2})(\d{4})(?!\d)/g)].flatMap((match) => {
    const month = Number(match[1]);
    const day = Number(match[2]);
    const year = Number(match[3]);
    const real = month >= 1 && month <= 12 && day >= 1 && year >= 2000 && year <= 2099 && day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
    return real ? [{ month, day, year }] : [];
  });
}

/** "2", "#2", "number 2": the form's place in the list, as a number standing alone (never part of a date). */
function picksByPosition(quote: string, position: number): boolean {
  return new RegExp(`(?<![\\d/.-])#?${position}(?![\\d/.-])`).test(withoutDates(quote));
}

export type WhichFormChoice = { readonly ok: true } | { readonly ok: false; readonly reason_code: string; readonly error: string };

/**
 * Whether opening (or writing to) the form with this id is the manager's pick while the last reply's which-form question
 * is open. Forms not in the list, and turns with no open question, are not this check's to refuse.
 */
export function whichFormChoice(input: {
  readonly asked: WhichFormRecord | null | undefined;
  readonly instanceId: string;
  readonly evidence: unknown;
  readonly history: readonly ChatMessage[];
  readonly question: string;
  readonly questionMessageId?: string | null;
}): WhichFormChoice {
  const asked = input.asked;
  if (!asked || asked.forms.length < 2) return { ok: true };
  const key = formKey(input.instanceId);
  const position = asked.forms.findIndex((entry) => entry.key === key);
  if (position < 0) return { ok: true };
  const entry = asked.forms[position]!;
  const refused = (reason_code: string, why: string): WhichFormChoice => ({
    ok: false,
    reason_code,
    error: `${why} Your last reply asked which of the ${asked.forms.length} listed forms to open, and the manager has not picked one. Nothing was opened and nothing was written. Ask again which one, listing them as before; say that what the manager just told you will go on the one they pick. Never pick one for them.`,
  });
  const claim = readEvidence(input.evidence);
  if (!claim) return refused("which_form_not_chosen", "Give choice_evidence: the manager's words from this message that pick this form.");
  const turns = identifiedTurns(input.history, input.question, input.questionMessageId);
  const check = verifyEvidence(input.evidence, turns, { thisTurnOnly: true });
  if (!check.ok) return refused("which_form_not_chosen", `The choice_evidence is not the manager's words in this message (${check.reason}).`);
  const picks =
    picksByDate(claim.quote, entry, asked.forms) ||
    picksBy(claim.quote, entry, asked.forms, "salon") ||
    picksBy(claim.quote, entry, asked.forms, "status") ||
    picksBy(claim.quote, entry, asked.forms, "form") ||
    picksByPosition(claim.quote, position + 1);
  return picks ? { ok: true } : refused("which_form_not_chosen", "Those words do not single out this form: they name none of its date, salon, status, form or number in the list that the others do not share.");
}
