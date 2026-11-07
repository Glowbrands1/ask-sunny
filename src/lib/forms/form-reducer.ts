import { formEditSaidReplacementEnabled, priorActionsNoSignedEnabled } from "@/lib/config/chat-quality-flags";

import type { InstanceValueRow } from "./instances";
import { offeredOffenseKey } from "./offense-keys";
import { priorLineDate } from "./prior-actions";

/**
 * ============================================================================
 * THE FORM REDUCER — A PATCH MERGED BY CODE (FORM_PATCH_REDUCER_ENABLED)
 * ============================================================================
 *
 * Step B, 3 Nov 2026. A chat edit or a redraft of an open form is a patch
 * (field, value, how, the words it came from), and this module decides what
 * of it reaches the form. Pure: no I/O, types only. Nothing is matched on
 * words: the rules come from the template and the saved rows, and the only
 * text test is "is this evidence a substring of what was said", folding case
 * and whitespace.
 *
 *   1. A key that is not writable is refused.
 *   2. A set to empty does nothing; only `clear` empties a field, and a
 *      manager-typed field is never cleared.
 *   3. Draft: a manager-typed field is kept (except `typedExempt`), an
 *      assistant field is replaced, a key the patch leaves out is left alone.
 *   4. Edit: "add" appends unless the text is already there; "replace" on a
 *      typed field needs the manager's own words; evidence comes from the
 *      manager, or from the assistant's offer the manager accepted; payroll
 *      and amount keys only verbatim and only once; a date only one the
 *      manager stated.
 *   5. Checkbox options belong to their group; a single-choice group takes one.
 *   6. List keys (prior actions) are united on the line format
 *      `priorActionLine` writes, keeping the longer line; the "none" line goes
 *      once a real line exists.
 *   7. A set to the same value is not a change.
 *   8. FORM_EDIT_NOOP_GUARD_ENABLED (Step 4, optional rules): a set to the
 *      same value is refused (`same_value`), and so is a value that copies
 *      the manager's whole latest message (`copies_message`).
 *
 * Nothing reads it yet: the wiring is a later step, behind the flag.
 */

export type FieldValue = string | readonly string[];

/** Who wrote what a field holds now, from the saved row's provenance only. */
export type Owner = "manager" | "assistant" | "empty";

export interface DraftField {
  readonly key: string;
  readonly value: FieldValue;
  readonly owner: Owner;
}

export type FormDraft = Readonly<Record<string, DraftField>>;

export interface FormPatch {
  readonly set: Readonly<Record<string, FieldValue>>;
  readonly clear: readonly string[];
  /** "reword" (FORM_PATCH_READER_FIXES_ENABLED only): the field's text in new words, every fact kept. */
  readonly how?: Readonly<Record<string, "add" | "replace" | "reword">>;
  readonly evidence?: Readonly<Record<string, string>>;
}

export type RefusalReason =
  | "not_writable"
  | "typed_by_manager"
  | "would_blank"
  | "date_not_stated"
  | "not_in_manager_words"
  | "unknown_option"
  | "already_answered"
  | "drops_words"
  | "writein_without_box"
  | "drops_protected_value"
  | "unknown_field"
  | "not_draft"
  /** CHAT_GLOSSARY_ENABLED: the employee's name would be a glossary term ("msb"). */
  | "glossary_term"
  /** FORM_EDIT_NOOP_GUARD_ENABLED: the op leaves the field as it is, or copies the latest message. */
  | "same_value"
  | "copies_message";

export interface Refusal {
  readonly key: string;
  readonly reason: RefusalReason;
}

export interface FieldChange {
  readonly key: string;
  readonly before: FieldValue;
  readonly after: FieldValue;
}

export interface FormDiff {
  readonly changed: readonly FieldChange[];
  readonly refused: readonly Refusal[];
}

export interface CheckboxGroup {
  readonly options: readonly string[];
  readonly single: boolean;
}

export interface PatchRules {
  /** "draft": the draft route's (re)draft. "edit": a chat edit of the open form. */
  readonly mode: "draft" | "edit";
  /** The template's AI fields and groups, minus the derived, policy-grounded and code-built ones. */
  readonly writable: ReadonlySet<string>;
  /** Keys a draft may replace although the manager typed them (a citable policy line over uncited wording). */
  readonly typedExempt?: ReadonlySet<string>;
  /** Payroll deduction and amount keys: only verbatim from the manager, and only while empty. */
  readonly managerStated?: ReadonlySet<string>;
  /** Date keys: the value must be one of `datesIn(evidence)`. */
  readonly dateKeys?: ReadonlySet<string>;
  /** The ISO dates stated in a text (the caller passes the app's date reader). */
  readonly datesIn?: (text: string) => readonly string[];
  /** Checkbox groups by key. */
  readonly checkboxGroups?: Readonly<Record<string, CheckboxGroup>>;
  /** Line lists united on the prior-action line format. */
  readonly listKeys?: ReadonlySet<string>;
  /** The list's "no history" line, dropped once a real line exists. */
  readonly listNone?: string;
  /** What was said, for the evidence checks (edit mode). */
  readonly sources?: {
    /** The manager's turns. */
    readonly manager: string;
    /** The assistant's last reply. */
    readonly offered?: string;
    /** The latest message accepts `offered`. */
    readonly accepted?: boolean;
    /** The manager's turns one by one: a turn shorter than MIN_EVIDENCE_WORDS is evidence on its own when quoted whole. */
    readonly managerTurns?: readonly string[];
    /**
     * Values the app's own deterministic correction readers (no model) produced
     * from the manager's words: "$15" → "$15.00", "SD" → "Salon Director"
     * (QA, 4 Nov 2026, #410). They count as said for a value's words, and for
     * nothing else: never as evidence. Passed only by a correction's save
     * (`form-write.ts`), never for a model's patch.
     */
    readonly readerValues?: readonly string[];
    /**
     * FORM_EDIT_SINGLE_WRITER_ENABLED (Step 2a; owner's ruling Q2, 4 Nov 2026):
     * the latest message. When set, `valueWasSaid` counts only this turn and
     * the turns the op's evidence quotes (a manager turn, or the accepted
     * offer), plus `readerValues` — and EVERY word an op adds must be among
     * them; there is no half-the-words floor. Absent: unchanged.
     */
    readonly namingTurn?: string;
  };
  /**
   * FORM_EDIT_SINGLE_WRITER_ENABLED (Step 2a): a "replace" may drop a word of
   * the old text (counted per occurrence) only if the latest message names it,
   * as a word or inside one ("doe" in "Doe-Smith"). Refused as
   * `drops_words`. Needs `sources.namingTurn`. Absent: unchanged.
   */
  readonly keepsUnnamedWords?: boolean;
  /**
   * FORM_EDIT_SINGLE_WRITER_ENABLED (Step 2b, the correction's preset): with
   * `keepsUnnamedWords`, a dropped word the latest message names must also be
   * REPLACED — paired, one for one, with a word the new text adds (every added
   * word is already one the naming turn or the correction's readers said),
   * a word containing it first ("doe" → "doe-smith").
   * So "fix her last name, it is Jane Doe-Smith" may turn "Doe" into
   * "Doe-Smith" but never drop "Jane": the latest message names Jane as
   * part of the name it gives, and nothing the new text adds takes her place.
   * Still `drops_words`. Absent: unchanged.
   */
  readonly droppedWordsReplaced?: boolean;
  /**
   * With `droppedWordsReplaced`: the one-fact lines (the template's short
   * text lines and the header), whose whole value is the fact a correction
   * restates — "her new location is salon 24" replaces "Salon 23" without
   * naming 23. On these a dropped word need not be named, only replaced one
   * for one by an added word; a word nothing replaces
   * ("Jane" when "Jane Doe" becomes "Doe-Smith") is still refused.
   */
  readonly wholeValueKeys?: ReadonlySet<string>;
  /**
   * FORM_EDIT_SINGLE_WRITER_ENABLED (Step 2a): write-in fields by key, from the
   * template's layout (`writeInsOf`). A write-in holds text only beside its
   * ticked box; otherwise refused as `writein_without_box`. Absent: unchanged.
   */
  readonly writeIns?: ReadonlyMap<string, { readonly group: string; readonly option: string }>;
  /**
   * FORM_EDIT_SINGLE_WRITER_ENABLED (Step 2a, QA condition 2): on a whole-text
   * rewrite — a "replace", or a draft-mode set, on a text field that already
   * holds text — every employee-name word from the form's header, every date
   * and every amount in the old text must still be in the new text (case
   * folded), unless the latest message names it. Otherwise refused as
   * `drops_protected_value`. Only known form facts are read: the header's
   * name, and the app's own date and amount readers. Absent: unchanged.
   */
  readonly protectedValues?: ProtectedValues;
  /**
   * FORM_EDIT_NOOP_GUARD_ENABLED (Step 4): an op that leaves its field as it
   * is — a set or append to the value it already has, a clear of an empty
   * field — is refused as `same_value`, never passed over as no change, so a
   * turn whose edit does nothing is handed off and never claimed.
   * "whole_patch" (a correction's preset): only when nothing in the patch
   * changes — a value the correction's readers restate beside a real change
   * ("change the payroll deduction to $5.00" restates the Yes) is passed over
   * as before. Absent: unchanged.
   */
  readonly refuseSameValue?: boolean | "whole_patch";
  /**
   * FORM_EDIT_NOOP_GUARD_ENABLED (Step 4): the latest message. A text value
   * that holds all of it, when it is at least MIN_EVIDENCE_WORDS words, is
   * refused as `copies_message` — the request itself written into a field
   * ("Can you do the same thing for … but switch it to a written" in the
   * Observation, the overnight scan's sf-s11). Compared on `fold`, and on its
   * words in order. Absent: unchanged.
   */
  readonly copiesMessage?: string;
  /**
   * FORM_PATCH_READER_FIXES_ENABLED (coding 5, 7 Nov 2026): the words checks read what the form already
   * holds. Every word of `employeeName` (the header's) and of `formText` (the form's own values) counts as
   * said; evidence that is the manager's words with the employee's name put in still counts as theirs; an
   * added FACT word (`factWords`: a number, or a capitalised word inside a sentence) must be said exactly,
   * and only a few of the other added words (MAX_UNSAID_WORDS, or UNSAID_SHARE of them) may be unsaid even by stem.
   * A "reword" op is checked for facts only (Pau, 7 Nov 2026: "yes rewrite"). Absent: unchanged.
   */
  readonly faithful?: {
    readonly employeeName: string;
    readonly formText: string;
    /** The latest message: a `verbatimKeys` value must be in it. */
    readonly latest: string;
  };
  /**
   * FORM_PATCH_READER_FIXES_ENABLED: keys whose value is taken only as words of the latest message, replacing
   * what is there (the form's Job Title: "change her position to Team Member"); written as the manager's.
   */
  readonly verbatimKeys?: ReadonlySet<string>;
  /**
   * FORM_PATCH_READER_FIXES_ENABLED: the latest message, when Step B's reader found nothing in it to write. A
   * text value whose added words are all words of this message or of the field's own text adds nothing new
   * (the instruction written as content, a sentence repeated) and is refused as `copies_message`.
   */
  readonly nothingNewFrom?: string;
  /**
   * FORM_PATCH_READER_FIXES_ENABLED (QA's stability run, 7 Nov 2026: "Details about the towel." written for "add
   * details about the towel"): a text value that repeats the instruction — every word of it (a line's heading and
   * the employee's name aside) a word of the latest message, and one of them its own field's name (the label's head
   * word, from `formWords` by key) — is refused as `copies_message`, on every path that carries it.
   */
  readonly echoOf?: { readonly latest: string; readonly name: string; readonly formWords: Readonly<Record<string, string>> };
  /**
   * FORM_PATCH_READER_FIXES_ENABLED (QA's trace, 7 Nov 2026): the evidence Step B's reader gave this turn, when it
   * handed the turn off. A text value the old path's revision writes as NEW content must keep it as the reader's
   * own op would (`keepsEvidence`), else `drops_words` — so a refused "make it about X" never comes back as
   * text about the form ("This coaching document was created on …").
   */
  readonly readerEvidence?: Readonly<Record<string, string>>;
  /**
   * FORM_PATCH_READER_FIXES_ENABLED (QA's 2x run, 7 Nov 2026: "yes, do that" after the reminder was saved wrote it a
   * second time, once with "Updated"): a text write whose every new sentence repeats a sentence the field already
   * holds (the same words, or 80% of them by stem) is refused as `copies_message`.
   */
  readonly noRepeat?: boolean;
}

export interface ProtectedValues {
  /** The employee's name on the form's header (the `employee_name` column and line). */
  readonly employeeName: string;
  /** The ISO dates a text states (the app's date reader, `datesInText`). */
  readonly datesIn: (text: string) => readonly string[];
  /** The amounts a text states (the app's payroll amount reader), as numbers. */
  readonly amountsIn: (text: string) => readonly number[];
  /** The latest message: what it names may change. */
  readonly latest: string;
  /** Other words the latest message names (an employee the turn names, read by the caller). */
  readonly named?: readonly string[];
  /** Keys whose whole value is one such fact being corrected (a date line, the name line, an amount line): not checked. */
  readonly skip?: ReadonlySet<string>;
  /**
   * The form's own Date line as it stands (ISO). A text rewritten to this date
   * may drop another one: the form's date moved, and the text follows it.
   */
  readonly formDate?: string | null;
}

/* ------------------------------------------------------------- text ---- */

function isSpace(char: string): boolean {
  return char === " " || char === "\n" || char === "\t" || char === "\r" || char === "\f" || char === "\v" || char === " ";
}

/** Lowercased, whitespace runs as one space, trimmed. No pattern matching. */
export function fold(text: string): string {
  let out = "";
  let pendingSpace = false;
  for (const char of text.toLowerCase()) {
    if (isSpace(char)) {
      pendingSpace = out !== "";
      continue;
    }
    if (pendingSpace) out += " ";
    pendingSpace = false;
    out += char;
  }
  return out;
}

function contains(haystack: string, needle: string): boolean {
  const want = fold(needle);
  return want !== "" && fold(haystack).includes(want);
}

/** Evidence must be at least this many words, or a whole manager turn that is shorter. */
export const MIN_EVIDENCE_WORDS = 3;
/** At least this share of a written text value's words must have been said by the manager (or be in an accepted offer). */
export const MIN_SAID_SHARE = 0.5;

function isWordChar(char: string): boolean {
  return char.toLowerCase() !== char.toUpperCase() || (char >= "0" && char <= "9");
}

/** The words of a text, folded, with punctuation trimmed from each end. No pattern matching. */
export function wordsOf(text: string): string[] {
  const out: string[] = [];
  for (const raw of fold(text).split(" ")) {
    let start = 0;
    let end = raw.length;
    while (start < end && !isWordChar(raw[start]!)) start += 1;
    while (end > start && !isWordChar(raw[end - 1]!)) end -= 1;
    if (end > start) out.push(raw.slice(start, end));
  }
  return out;
}

/** The value holds the whole message (folded, or as its words in order), and the message is MIN_EVIDENCE_WORDS words or more. */
export function copiesMessage(value: string, message: string): boolean {
  const said = wordsOf(message);
  if (said.length < MIN_EVIDENCE_WORDS) return false;
  if (contains(value, message)) return true;
  return ` ${wordsOf(value).join(" ")} `.includes(` ${said.join(" ")} `);
}

/** Strong enough evidence: MIN_EVIDENCE_WORDS words, or one whole manager turn that is shorter. */
function strongEvidence(evidence: string, rules: PatchRules): boolean {
  if (wordsOf(evidence).length >= MIN_EVIDENCE_WORDS) return true;
  const want = fold(evidence);
  return (rules.sources?.managerTurns ?? []).some((turn) => want !== "" && fold(turn) === want);
}

/** At least MIN_SAID_SHARE of the value's words appear among the words said (manager, or the accepted offer). */
function valueWasSaid(value: string, rules: PatchRules, context: { old: string; evidence?: string } = { old: "" }): boolean {
  const words = wordsOf(value);
  if (words.length === 0) return false;
  const sources = rules.sources;
  if (!sources) return false;
  // FORM_PATCH_READER_FIXES_ENABLED: facts said exactly, half the other words said (by stem), the form's name and text count.
  if (rules.faithful) return faithfulValueSaid(value, context.old, rules, true);
  if (sources.namingTurn !== undefined) return addedWordsNamed(value, context.old, context.evidence, rules);
  const said = new Set(wordsOf(sources.manager));
  if (sources.accepted && sources.offered) for (const word of wordsOf(sources.offered)) said.add(word);
  for (const read of sources.readerValues ?? []) for (const word of wordsOf(read)) said.add(word);
  const hits = words.filter((word) => said.has(word)).length;
  return hits / words.length >= MIN_SAID_SHARE;
}

/* -------------------------------------- FORM_PATCH_READER_FIXES_ENABLED ---- */

/** Share of a sentence's words, by stem, that another sentence has, for `repeatsField`. */
const REPEAT_SHARE = 0.8;

function sentencesOf(text: string): string[][] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((sentence) => wordsOf(sentence))
    .filter((words) => words.length > 0);
}

/**
 * The new text adds sentences, and only ones the old text already holds: it has more sentences than the old, and
 * each sentence beyond the old ones (counted, so a second copy is beyond) has REPEAT_SHARE of its words, by stem, in
 * one old sentence.
 * A line's heading alone ("Observed:") is layout and not counted.
 */
export function repeatsField(value: string, old: string): boolean {
  const before = sentencesOf(old);
  if (before.length === 0) return false;
  // Only a write that ADDS sentences: an in-place edit (a name fixed, a sentence reworded) keeps the count.
  if (sentencesOf(value).length <= before.length) return false;
  const unused = before.map((words) => words.join(" "));
  let repeated = 0;
  for (const words of sentencesOf(value)) {
    const joined = words.join(" ");
    const at = unused.indexOf(joined);
    if (at >= 0) {
      unused.splice(at, 1);
      continue;
    }
    if (words.length === 1 && value.includes(`${words[0]}:`)) continue;
    const near = before.some((have) => words.filter((word) => have.some((other) => sameStem(word, other))).length / words.length >= REPEAT_SHARE);
    if (!near) return false;
    repeated += 1;
  }
  return repeated > 0;
}

/** A line's leading "Label:" heading words: the field's layout, not content. */
function headingWords(value: string): Set<string> {
  const out = new Set<string>();
  for (const line of value.split("\n")) {
    const first = line.trim().split(" ")[0] ?? "";
    if (first.endsWith(":")) for (const word of wordsOf(first)) out.add(word);
  }
  return out;
}

/**
 * The value repeats the instruction: every word (headings and the employee's name aside) is a word of the latest
 * message, and one of them is its field's own name — the label's head word ("Details about the towel." for "add
 * details about the towel" on Details of Coaching). Content in her words ("She was also on her phone.", "Coaching
 * when she signed the policy manual") does not name its field.
 */
export function repeatsInstruction(value: string, echo: { latest: string; name: string; formWords: Readonly<Record<string, string>> }, key: string): boolean {
  const skip = new Set([...headingWords(value), ...wordsOf(echo.name)]);
  const words = wordsOf(value).filter((word) => !skip.has(word));
  if (words.length === 0) return false;
  const said = new Set(wordsOf(echo.latest));
  if (!words.every((word) => said.has(word))) return false;
  // The field's own name, as a manager says it: its label's head word ("Details" of Coaching, "Observation" of Offense).
  const head = wordsOf(echo.formWords[key] ?? "").find((word) => word.length >= 4);
  return head !== undefined && words.includes(head);
}

/** Every word the value adds to the field is a word of the message or of the field's own text (and it adds some). */
export function addsNothingNew(value: string, old: FieldValue, message: string): boolean {
  const before = typeof old === "string" ? old : old.join("\n");
  const added = addedWords(value, before);
  if (added.length === 0) return false;
  const known = new Set([...wordsOf(message), ...wordsOf(before)]);
  // A line's heading ("Observed:", "Expectation:") is the field's layout, not content.
  for (const line of value.split("\n")) {
    const first = line.trim().split(" ")[0] ?? "";
    if (first.endsWith(":")) for (const word of wordsOf(first)) known.add(word);
  }
  return added.every((word) => known.has(word));
}

/** Two words share a stem: the same word, or both 4+ letters with the same first four ("missed", "missing"). */
function sameStem(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length < 4 || b.length < 4) return false;
  return a.slice(0, 4) === b.slice(0, 4);
}

/**
 * The FACT words of a text, folded: a word with a digit in it, or a word written with a capital letter
 * that is not the first word of its sentence or line (a name, a month, a place). Read from the text's own
 * shape; no word list. A sentence's first word is not counted (its capital is the sentence's).
 */
export function factWords(text: string): Set<string> {
  const out = new Set<string>();
  for (const line of text.split("\n")) {
    let first = true;
    for (const raw of line.split(" ")) {
      let start = 0;
      let end = raw.length;
      while (start < end && !isWordChar(raw[start]!)) start += 1;
      while (end > start && !isWordChar(raw[end - 1]!)) end -= 1;
      if (end === start) continue;
      const word = raw.slice(start, end);
      const capital = word[0]! !== word[0]!.toLowerCase();
      let digit = false;
      for (const char of word) if (char >= "0" && char <= "9") digit = true;
      if (digit || (capital && !first)) out.add(word.toLowerCase());
      first = /[.!?:;]$/.test(raw);
    }
  }
  return out;
}

/** What counts as said for the reader's checks: every manager turn, an accepted offer, the readers' values, the form's name and text. */
function faithfulSaidWords(rules: PatchRules): Set<string> {
  const sources = rules.sources!;
  const said = new Set(wordsOf([sources.manager, ...(sources.managerTurns ?? []), sources.namingTurn ?? ""].join("\n")));
  if (sources.accepted && sources.offered) for (const word of wordsOf(sources.offered)) said.add(word);
  for (const read of sources.readerValues ?? []) for (const word of wordsOf(read)) said.add(word);
  for (const word of wordsOf(`${rules.faithful!.employeeName}\n${rules.faithful!.formText}`)) said.add(word);
  return said;
}

/**
 * With `floor`, at most this many added ordinary words may be unsaid (not even by stem), or UNSAID_SHARE of the
 * added words if that is more: "the" in "Perrin missed the monthly meeting." passes; an invented clause ("and then
 * lied to the customer, refused to apologise") does not (the sibling app's replay, 7 Nov 2026).
 */
export const MAX_UNSAID_WORDS = 2;
export const UNSAID_SHARE = 0.15;

/** Every added fact word is said; with `floor`, only a few other added words (MAX_UNSAID_WORDS / UNSAID_SHARE) are unsaid. */
function faithfulValueSaid(value: string, old: string, rules: PatchRules, floor: boolean): boolean {
  if (!rules.sources || !rules.faithful) return false;
  const said = faithfulSaidWords(rules);
  const facts = factWords(value);
  const others: string[] = [];
  for (const word of addedWords(value, old)) {
    if (facts.has(word)) {
      if (!said.has(word)) return false;
    } else others.push(word);
  }
  if (!floor || others.length === 0) return true;
  const saidList = [...said];
  const unsaid = others.filter((word) => !said.has(word) && !saidList.some((have) => sameStem(word, have))).length;
  return unsaid <= Math.max(MAX_UNSAID_WORDS, Math.floor(UNSAID_SHARE * addedWords(value, old).length));
}

/** Evidence of at least this many words is content the manager gave, not an instruction: the value keeps it. */
export const CONTENT_EVIDENCE_WORDS = 12;
/** With content evidence, at least this share of its words (by stem) is in the value. */
export const MIN_KEPT_SHARE = 0.75;

/**
 * FORM_PATCH_READER_FIXES_ENABLED (QA's live run, 7 Nov 2026: a process she gave, "… use a fresh towel, …",
 * saved as a shorter summary without the towel): an add or replace keeps its evidence — MIN_KEPT_SHARE of the
 * words of content the manager gave (CONTENT_EVIDENCE_WORDS or more), MIN_SAID_SHARE of shorter evidence. A
 * reword is not checked (its evidence is the request).
 */
/** The value is new content for the field, not an edit of its text: the field is empty, or it keeps less than half its words. */
export function isNewContent(value: string, old: string): boolean {
  const before = wordsOf(old);
  if (before.length === 0) return true;
  const after = new Set(wordsOf(value));
  return before.filter((word) => after.has(word)).length / before.length < MIN_SAID_SHARE;
}

function keepsEvidence(value: string, evidence: string | undefined, old = ""): boolean {
  const want = wordsOf(evidence ?? "");
  if (want.length === 0) return true;
  // An edit of the field's own text (a word corrected, a line added) is not new content: its evidence is the instruction.
  if (want.length < CONTENT_EVIDENCE_WORDS && old.trim() !== "") {
    const before = wordsOf(old);
    const after = new Set(wordsOf(value));
    if (before.length > 0 && before.filter((word) => after.has(word)).length / before.length >= MIN_SAID_SHARE) return true;
  }
  const have = wordsOf(value);
  const kept = want.filter((word) => have.some((written) => sameStem(word, written))).length;
  /*
   * QA's runs 3–4 (7 Nov 2026): "can you make it for missing out monthly meeting" and "make it about showing up
   * late" were written as text about the form ("This coaching session … addressed the attendance policy"), none
   * of her words in it. Shorter evidence names what the field is about: at least half of its words are in the value.
   */
  return kept / want.length >= (want.length >= CONTENT_EVIDENCE_WORDS ? MIN_KEPT_SHARE : MIN_SAID_SHARE);
}

/** The evidence's words, the employee's name words left out, are a run of words of one manager turn (or the accepted offer). */
function faithfulEvidenceFrom(evidence: string, rules: PatchRules): "manager" | "offered" | null {
  const name = new Set(wordsOf(rules.faithful!.employeeName));
  const want = wordsOf(evidence).filter((word) => !name.has(word));
  if (want.length === 0) return null;
  const run = ` ${want.join(" ")} `;
  const sources = rules.sources!;
  const strong = want.length >= MIN_EVIDENCE_WORDS || (sources.managerTurns ?? []).some((turn) => wordsOf(turn).join(" ") === want.join(" "));
  if (!strong) return null;
  const turns = [sources.manager, ...(sources.managerTurns ?? []), sources.namingTurn ?? ""];
  if (turns.some((turn) => ` ${wordsOf(turn).join(" ")} `.includes(run))) return "manager";
  /*
   * QA's trace (bub-phone r1, 7 Nov 2026): the model's quote echoed a word ("also she was also on her phone" for "add
   * that she was also on her phone"). Every word of it in one of her turns is still her words; the value itself is
   * judged on its own words next.
   */
  if ((sources.managerTurns ?? [sources.manager]).some((turn) => {
    const said = new Set(wordsOf(turn));
    return want.every((word) => said.has(word));
  })) return "manager";
  if (sources.accepted && sources.offered !== undefined && ` ${wordsOf(sources.offered).join(" ")} `.includes(run)) return "offered";
  return null;
}

/** Each word's count. */
function counts(words: readonly string[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const word of words) out.set(word, (out.get(word) ?? 0) + 1);
  return out;
}

/** The words of `next` beyond those of `old`, counted per occurrence. */
function addedWords(next: string, old: string): string[] {
  const have = counts(wordsOf(old));
  const added: string[] = [];
  for (const word of wordsOf(next)) {
    const left = have.get(word) ?? 0;
    if (left > 0) have.set(word, left - 1);
    else added.push(word);
  }
  return added;
}

/**
 * The naming turn's words (owner's ruling Q2): the latest message, every turn
 * the op's evidence quotes (a manager turn, or the offer accepted), and the
 * correction readers' own values.
 */
function namingWords(evidence: string | undefined, rules: PatchRules): Set<string> {
  const sources = rules.sources!;
  const said = new Set(wordsOf(sources.namingTurn ?? ""));
  const want = evidence === undefined ? "" : fold(evidence);
  if (want !== "") {
    const turns = [...(sources.managerTurns ?? []), ...(sources.accepted && sources.offered ? [sources.offered] : [])];
    for (const turn of turns) if (fold(turn).includes(want)) for (const word of wordsOf(turn)) said.add(word);
  }
  for (const read of sources.readerValues ?? []) for (const word of wordsOf(read)) said.add(word);
  return said;
}

/** Every word the op adds is in the naming turn. */
function addedWordsNamed(value: string, old: string, evidence: string | undefined, rules: PatchRules): boolean {
  const said = namingWords(evidence, rules);
  return addedWords(value, old).every((word) => said.has(word));
}

/** The latest message names the word: as one of its words, or inside one ("doe" in "doe-smith"). */
function latestNames(word: string, latestWords: readonly string[]): boolean {
  return latestWords.some((said) => said === word || said.includes(word));
}

/** A replace drops no word of the old text the latest message does not name (counted per occurrence). */
function keepsUnnamed(key: string, old: string, next: string, rules: PatchRules): boolean {
  const kept = counts(wordsOf(next));
  const latest = wordsOf(rules.sources?.namingTurn ?? "");
  const wholeValue = rules.droppedWordsReplaced === true && (rules.wholeValueKeys?.has(key) ?? false);
  const dropped: string[] = [];
  // FORM_EDIT_SAID_REPLACEMENT_ENABLED: words the new text replaces in place with a word the latest message says.
  const saidInPlace = formEditSaidReplacementEnabled() ? replacedInPlaceBySaid(wordsOf(old), wordsOf(next), latest) : null;
  for (const word of wordsOf(old)) {
    const left = kept.get(word) ?? 0;
    if (left > 0) {
      kept.set(word, left - 1);
      continue;
    }
    if (!wholeValue && !latestNames(word, latest) && !(saidInPlace?.has(word) ?? false)) return false;
    dropped.push(word);
  }
  return !rules.droppedWordsReplaced || everyDropReplaced(dropped, addedWords(next, old));
}

/*
 * FORM_EDIT_SAID_REPLACEMENT_ENABLED (QA's Step B gate, 6 Nov 2026): "fix her last name, it is Laine" turns
 * "Tessaly Lane" into "Tessaly Laine", and "Lane" is not inside "Laine", so it was refused. The old words the
 * new text REPLACES IN PLACE — where the two texts differ by words taken out and words put in at the same
 * spot, paired one for one — may go when the word put in is one the latest message says AND a correction of
 * the old word (`correctionOf`). A word taken out
 * with nothing put in its place ("Marnie" when "Marnie Quill" becomes "Quill-Hart") is not replaced in place.
 */
/**
 * A correction of the word, not another word: it contains it ("quill" → "quill-hart"), or it is spelled
 * within two letters of it ("lane" → "laine"). "marnie" → "quill-hart" is neither (QA's gate, 6 Nov 2026).
 */
function correctionOf(old: string, put: string): boolean {
  if (put.includes(old) || old.includes(put)) return true;
  const row = Array.from({ length: put.length + 1 }, (_, j) => j);
  for (let i = 1; i <= old.length; i += 1) {
    let diagonal = row[0]!;
    row[0] = i;
    for (let j = 1; j <= put.length; j += 1) {
      const above = row[j]!;
      row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, diagonal + (old[i - 1] === put[j - 1] ? 0 : 1));
      diagonal = above;
    }
  }
  return row[put.length]! <= 2;
}

function replacedInPlaceBySaid(old: readonly string[], next: readonly string[], latest: readonly string[]): Set<string> {
  const said = new Set(latest);
  const rows = old.length + 1;
  const cols = next.length + 1;
  const lcs: number[][] = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));
  for (let i = old.length - 1; i >= 0; i -= 1) {
    for (let j = next.length - 1; j >= 0; j -= 1) {
      lcs[i]![j] = old[i] === next[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }
  const out = new Set<string>();
  let removed: string[] = [];
  let added: string[] = [];
  const flush = () => {
    if (removed.length > 0 && removed.length === added.length) {
      removed.forEach((word, index) => {
        const put = added[index]!;
        if (said.has(put) && correctionOf(word, put)) out.add(word);
      });
    }
    removed = [];
    added = [];
  };
  let i = 0;
  let j = 0;
  while (i < old.length || j < next.length) {
    if (i < old.length && j < next.length && old[i] === next[j]) {
      flush();
      i += 1;
      j += 1;
    } else if (j < next.length && (i >= old.length || lcs[i]![j + 1]! >= lcs[i + 1]![j]!)) {
      added.push(next[j]!);
      j += 1;
    } else {
      removed.push(old[i]!);
      i += 1;
    }
  }
  flush();
  return out;
}

/** Each dropped word pairs with its own added word: one containing it first, then any left. */
function everyDropReplaced(dropped: readonly string[], added: readonly string[]): boolean {
  const free = [...added];
  const unpaired: string[] = [];
  for (const word of dropped) {
    const at = free.findIndex((candidate) => candidate !== word && candidate.includes(word));
    if (at >= 0) free.splice(at, 1);
    else unpaired.push(word);
  }
  return unpaired.length <= free.length;
}

/** Every name word, date and amount of the old text is still in the new one, unless the latest message names it. */
function keepsProtected(key: string, old: string, next: string, rules: PatchRules): boolean {
  const guard = rules.protectedValues;
  if (!guard || guard.skip?.has(key) || old.trim() === "") return true;
  const latestWords = [...wordsOf(guard.latest), ...(guard.named ?? []).flatMap((name) => wordsOf(name))];
  const nextText = fold(next);
  // FORM_EDIT_SAID_REPLACEMENT_ENABLED: a name word the new text replaces in place with a word the latest message says ("Lane" → "Laine").
  const saidInPlace = formEditSaidReplacementEnabled() ? replacedInPlaceBySaid(wordsOf(old), wordsOf(next), latestWords) : null;
  for (const word of wordsOf(guard.employeeName)) {
    if (!fold(old).includes(word)) continue;
    if (!nextText.includes(word) && !latestNames(word, latestWords) && !(saidInPlace?.has(word) ?? false)) return false;
  }
  const nextDates = new Set(guard.datesIn(next));
  const latestDates = new Set(guard.datesIn(guard.latest));
  const followsFormDate = Boolean(guard.formDate) && nextDates.has(guard.formDate!);
  for (const date of guard.datesIn(old)) {
    if (nextDates.has(date) || latestDates.has(date)) continue;
    // The text moved to the form's current Date line (the form's date changed): the old day may go.
    if (followsFormDate && date !== guard.formDate) continue;
    return false;
  }
  const nextAmounts = new Set(guard.amountsIn(next));
  const latestAmounts = new Set(guard.amountsIn(guard.latest));
  for (const amount of guard.amountsIn(old)) if (!nextAmounts.has(amount) && !latestAmounts.has(amount)) return false;
  return true;
}

/* ------------------------------------------------------------ values ---- */

function asList(value: FieldValue): string[] {
  return (typeof value === "string" ? [value] : [...value]).map((item) => item.trim()).filter((item) => item !== "");
}

function isEmpty(value: FieldValue | undefined): boolean {
  if (value === undefined) return true;
  return typeof value === "string" ? value.trim() === "" : asList(value).length === 0;
}

/** The same value: trimmed text, or the same options in any order. Empty text and no options are the same. */
export function sameValue(a: FieldValue | undefined, b: FieldValue | undefined): boolean {
  if (isEmpty(a) && isEmpty(b)) return true;
  if (a === undefined || b === undefined) return false;
  if (typeof a === "string" && typeof b === "string") return a.trim() === b.trim();
  const left = new Set(asList(a));
  const right = new Set(asList(b));
  return left.size === right.size && [...left].every((item) => right.has(item));
}

/* ----------------------------------------------------------- lists ---- */

const STEP_SEPARATOR = " — ";
const SIGNED_SEPARATOR = " — signed ";

function lines(value: FieldValue): string[] {
  return (typeof value === "string" ? value.split("\n") : [...value]).map((line) => line.trim()).filter((line) => line !== "");
}

/** `priorActionLine`'s own format: the step (first " — " segment) and the signed date. */
export function priorLineKey(line: string): string {
  const step = fold(line.split(STEP_SEPARATOR)[0] ?? "");
  // PRIOR_ACTIONS_NO_SIGNED_ENABLED: "— signed <date>", "— finalized <date>" and "— <date>" are one date.
  if (priorActionsNoSignedEnabled()) return `${step}|${fold(priorLineDate(line))}`;
  const at = line.lastIndexOf(SIGNED_SEPARATOR);
  const signed = at >= 0 ? fold(line.slice(at + SIGNED_SEPARATOR.length)) : "";
  return `${step}|${signed}`;
}

/** The lines of both, de-duplicated on `priorLineKey` (the longer line kept); the "none" line goes once a real one exists. */
export function uniteLines(existing: FieldValue, added: FieldValue, none?: string): string {
  const out: string[] = [];
  for (const line of [...lines(existing), ...lines(added)]) {
    const key = priorLineKey(line);
    const at = out.findIndex((have) => priorLineKey(have) === key);
    if (at < 0) out.push(line);
    else if (line.length > out[at]!.length) out[at] = line;
  }
  const real = none === undefined ? out : out.filter((line) => fold(line) !== fold(none));
  return (real.length > 0 ? real : out).join("\n");
}

/* ----------------------------------------------------------- reducer ---- */

type Written = { value: FieldValue; owner: Owner } | Refusal | null;

function refuse(key: string, reason: RefusalReason): Refusal {
  return { key, reason };
}

function isRefusal(written: Written): written is Refusal {
  return written !== null && "reason" in written;
}

function current(draft: FormDraft, key: string): DraftField {
  return draft[key] ?? { key, value: "", owner: "empty" };
}

/** Where the evidence was said: "manager", "offered" (an accepted offer), or nowhere. */
function evidenceFrom(evidence: string | undefined, rules: PatchRules): "manager" | "offered" | null {
  if (!evidence || evidence.trim() === "") return null;
  const sources = rules.sources;
  if (!sources) return null;
  if (!strongEvidence(evidence, rules)) return null;
  if (contains(sources.manager, evidence)) return "manager";
  if (sources.accepted && sources.offered !== undefined && contains(sources.offered, evidence)) return "offered";
  // FORM_PATCH_READER_FIXES_ENABLED: the manager's words with the employee's name put in are still theirs.
  if (rules.faithful) return faithfulEvidenceFrom(evidence, rules);
  return null;
}

function checkboxValue(key: string, field: DraftField, value: FieldValue, how: "add" | "replace", group: CheckboxGroup): Written {
  // FORM_EDIT_SAID_REPLACEMENT_ENABLED: an old offense box is written as the box that replaced it ("absenteeism" → Attendance Policy).
  const options = formEditSaidReplacementEnabled()
    ? asList(value).map((option) => (group.options.includes(option) ? option : (offeredOffenseKey(option, group.options) ?? option)))
    : asList(value);
  if (options.some((option) => !group.options.includes(option))) return refuse(key, "unknown_option");
  if (group.single) {
    if (options.length !== 1) return refuse(key, "unknown_option");
    return { value: options, owner: "assistant" };
  }
  const merged = how === "add" ? [...new Set([...asList(field.value), ...options])] : [...new Set(options)];
  return { value: merged, owner: "assistant" };
}

function setOne(draft: FormDraft, key: string, value: FieldValue, patch: FormPatch, rules: PatchRules): Written {
  if (!rules.writable.has(key)) return refuse(key, "not_writable");
  const field = current(draft, key);
  // Rule 2: a set to empty never empties a field.
  if (isEmpty(value)) return isEmpty(field.value) ? null : refuse(key, "would_blank");

  const group = rules.checkboxGroups?.[key];
  const isList = rules.listKeys?.has(key) ?? false;
  const typed = field.owner === "manager";

  if (rules.mode === "draft") {
    if (typed && !(rules.typedExempt?.has(key) ?? false)) return sameValue(field.value, value) ? null : refuse(key, "typed_by_manager");
    // Nothing invented in a draft either: a date, payroll answer or amount must be what the manager said.
    const said = typeof value === "string" ? value.trim() : asList(value).join("\n");
    if (rules.dateKeys?.has(key)) {
      const stated = rules.datesIn ? rules.datesIn(rules.sources?.manager ?? "") : [];
      if (!stated.includes(said)) return refuse(key, "date_not_stated");
    }
    if (rules.managerStated?.has(key) && !group && !contains(rules.sources?.manager ?? "", said)) return refuse(key, "not_in_manager_words");
    if (group) return checkboxValue(key, field, value, "replace", group);
    if (isList) return { value: uniteLines(field.value, value, rules.listNone), owner: field.owner === "empty" ? "assistant" : field.owner };
    const drafted = typeof value === "string" ? value.trim() : asList(value).join("\n");
    // A whole-text rewrite keeps the form's protected facts (FORM_EDIT_SINGLE_WRITER_ENABLED).
    if (typeof field.value === "string" && !keepsProtected(key, field.value, drafted, rules)) return refuse(key, "drops_protected_value");
    return { value: drafted, owner: "assistant" };
  }

  // Edit: every value comes with the words it came from.
  const evidence = patch.evidence?.[key];
  const from = evidenceFrom(evidence, rules);
  if (!from) return refuse(key, "not_in_manager_words");
  const owner: Owner = from === "manager" ? "manager" : "assistant";
  const asked = patch.how?.[key] ?? "replace";
  // "reword" exists only with FORM_PATCH_READER_FIXES_ENABLED (`faithful`); anywhere else it is a replace.
  const reword = asked === "reword" && rules.faithful !== undefined;
  const text = typeof value === "string" ? value.trim() : asList(value).join("\n");
  /*
   * FORM_PATCH_READER_FIXES_ENABLED (QA's trace, bub-phone r1): an "add" returned as the whole field with the new
   * sentence inserted is an edit of the field's text: judged as a replace, so only the words it adds are checked and
   * the field is not written twice.
   */
  const haveText = typeof field.value === "string" ? field.value.trim() : asList(field.value).join("\n");
  const wholeFieldAdd =
    asked === "add" &&
    rules.faithful !== undefined &&
    !group &&
    !isList &&
    haveText !== "" &&
    sentencesOf(text).length > sentencesOf(haveText).length &&
    !isNewContent(text, haveText);
  const how: "add" | "replace" = asked === "add" && !wholeFieldAdd ? "add" : "replace";

  // FORM_PATCH_READER_FIXES_ENABLED: the Job Title takes the latest message's own words, and nothing else.
  if (rules.verbatimKeys?.has(key) && !group) {
    if (sameValue(field.value, text)) return null;
    if (!contains(rules.faithful?.latest ?? rules.sources?.namingTurn ?? "", text)) return refuse(key, "not_in_manager_words");
    return { value: text, owner: "manager" };
  }

  if (rules.managerStated?.has(key)) {
    if (sameValue(field.value, text)) return null;
    if (!isEmpty(field.value)) return refuse(key, "already_answered");
    if (!contains(rules.sources?.manager ?? "", text)) return refuse(key, "not_in_manager_words");
    return { value: text, owner: "manager" };
  }
  if (rules.dateKeys?.has(key)) {
    const stated = rules.datesIn ? rules.datesIn(evidence!) : [];
    if (!stated.includes(text)) return refuse(key, "date_not_stated");
    if (typed && from !== "manager") return refuse(key, "typed_by_manager");
    return { value: text, owner };
  }
  if (group) {
    if (typed && how === "replace" && from !== "manager") return refuse(key, "typed_by_manager");
    const written = checkboxValue(key, field, value, how, group);
    return isRefusal(written) || written === null ? written : { value: written.value, owner };
  }
  // A list line is the app's own format (priorActionLine); its evidence is checked above.
  if (isList) return { value: uniteLines(field.value, value, rules.listNone), owner: typed ? "manager" : owner };
  const have = typeof field.value === "string" ? field.value.trim() : asList(field.value).join("\n");
  if (how === "add" ? have !== "" && contains(have, text) : sameValue(field.value, text)) return null;
  /*
   * FORM_PATCH_READER_FIXES_ENABLED, Pau's "yes rewrite" (7 Nov 2026): the field's own text in new words.
   * Only a field that holds text; every fact word the new text adds is said (the manager's turns, the
   * form's name and text); every protected value (name, date, amount) is kept. Words may go: the wording is
   * what the manager asked to change.
   */
  if (reword) {
    if (have === "") return refuse(key, "not_in_manager_words");
    if (!faithfulValueSaid(text, have, rules, false)) return refuse(key, "not_in_manager_words");
    if (!keepsProtected(key, have, text, rules)) return refuse(key, "drops_protected_value");
    return { value: text, owner: typed ? "manager" : owner };
  }
  // The value itself, not only its evidence, must be words the manager said (or an accepted offer).
  if (!valueWasSaid(text, rules, { old: how === "add" ? "" : have, evidence })) return refuse(key, "not_in_manager_words");
  // FORM_PATCH_READER_FIXES_ENABLED: content she gave is kept, not summarised away.
  if (rules.faithful && !keepsEvidence(text, evidence, how === "add" ? "" : have)) return refuse(key, "drops_words");
  /*
   * FORM_PATCH_READER_FIXES_ENABLED: a replace the manager asked for ("make it about showing up late") may
   * drop words of text the assistant wrote; what she typed herself still keeps every word she did not name.
   * The new text's words were checked above, and the protected values are checked below.
   */
  const dropsAllowed = rules.faithful !== undefined && !typed;
  if (how === "replace" && rules.keepsUnnamedWords && !dropsAllowed && !keepsUnnamed(key, have, text, rules)) return refuse(key, "drops_words");
  /*
   * FORM_PATCH_READER_FIXES_ENABLED (QA's trace, 7 Nov 2026; QA's proposal): "make it about showing up late" read
   * right ("Observed: showing up late.") was refused because the old account named her and its date. A replace that
   * is NEW content (`isNewContent`), whose evidence is the manager's own words in her latest message, on a field
   * she did not type, replaces the old account whole: its name and dates may go (the header keeps her name, the
   * Date line its date). Every fact it adds was checked above. Anything else keeps the protected values.
   */
  const newAccount =
    rules.faithful !== undefined && how === "replace" && !typed && from === "manager" && evidence !== undefined && contains(rules.faithful.latest, evidence) && isNewContent(text, have);
  if (how === "replace" && !newAccount && !keepsProtected(key, have, text, rules)) return refuse(key, "drops_protected_value");
  if (how === "add") {
    if (have === "") return { value: text, owner };
    return { value: `${have}\n${text}`, owner: typed ? "manager" : owner };
  }
  // "replace": text the assistant offered never replaces what the manager typed.
  if (typed && from !== "manager") return refuse(key, "typed_by_manager");
  return { value: text, owner };
}

function clearOne(draft: FormDraft, key: string, patch: FormPatch, rules: PatchRules): Written {
  if (!rules.writable.has(key)) return refuse(key, "not_writable");
  const field = current(draft, key);
  if (field.owner === "manager") return refuse(key, "would_blank");
  if (isEmpty(field.value)) return null;
  const clearEvidence = patch.evidence?.[key] ?? "";
  if (rules.mode === "edit" && !(contains(rules.sources?.manager ?? "", clearEvidence) && strongEvidence(clearEvidence, rules))) {
    return refuse(key, "not_in_manager_words");
  }
  return { value: typeof field.value === "string" ? "" : [], owner: "empty" };
}

/** The fields whose value differs, in the order of `before` then any new keys. */
export function diffDrafts(before: FormDraft, after: FormDraft): FieldChange[] {
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])];
  const changed: FieldChange[] = [];
  for (const key of keys) {
    const was = before[key]?.value ?? "";
    const now = after[key]?.value ?? "";
    if (!sameValue(was, now)) changed.push({ key, before: was, after: now });
  }
  return changed;
}

/** The patch merged into the draft under the rules, and what changed or was refused. */
export function applyPatch(draft: FormDraft, patch: FormPatch, rules: PatchRules): { draft: FormDraft; diff: FormDiff } {
  const next: Record<string, DraftField> = { ...draft };
  const refused: Refusal[] = [];
  const write = (key: string, written: Written) => {
    if (written === null) return;
    if (isRefusal(written)) {
      refused.push(written);
      return;
    }
    if (sameValue(current(next, key).value, written.value)) return;
    next[key] = { key, value: written.value, owner: isEmpty(written.value) ? "empty" : written.owner };
  };
  /* FORM_EDIT_NOOP_GUARD_ENABLED: an op that copies the message, or changes nothing, is refused. */
  const guarded = (key: string, value: FieldValue | null, written: Written): Written => {
    if (rules.copiesMessage !== undefined && value !== null && copiesMessage(typeof value === "string" ? value : asList(value).join("\n"), rules.copiesMessage)) {
      return refuse(key, "copies_message");
    }
    // FORM_PATCH_READER_FIXES_ENABLED: what the field already says, written again.
    if (rules.noRepeat && !isRefusal(written) && written !== null && typeof written.value === "string") {
      const old = current(next, key).value;
      if (repeatsField(written.value, typeof old === "string" ? old : old.join("\n"))) return refuse(key, "copies_message");
    }
    // FORM_PATCH_READER_FIXES_ENABLED: the instruction written back as the field's content.
    if (rules.echoOf !== undefined && typeof value === "string" && !isRefusal(written) && written !== null && repeatsInstruction(value, rules.echoOf, key)) {
      return refuse(key, "copies_message");
    }
    // FORM_PATCH_READER_FIXES_ENABLED: the old path's new content keeps what the reader read from her ("make it about X").
    if (rules.readerEvidence !== undefined && typeof value === "string" && !isRefusal(written) && written !== null) {
      const old = current(next, key).value;
      const before = typeof old === "string" ? old : old.join("\n");
      const evidence = rules.readerEvidence[key];
      if (evidence !== undefined && isNewContent(value, before) && !keepsEvidence(value, evidence, before)) return refuse(key, "drops_words");
    }
    // FORM_PATCH_READER_FIXES_ENABLED: after the reader found nothing to write, a value that adds nothing new.
    if (rules.nothingNewFrom !== undefined && typeof value === "string" && !isRefusal(written) && written !== null && addsNothingNew(value, current(next, key).value, rules.nothingNewFrom)) {
      return refuse(key, "copies_message");
    }
    if (!rules.refuseSameValue || isRefusal(written)) return written;
    if (written === null || sameValue(current(next, key).value, written.value)) return refuse(key, "same_value");
    return written;
  };
  for (const [key, value] of Object.entries(patch.set)) write(key, guarded(key, value, setOne(next, key, value, patch, rules)));
  for (const key of patch.clear) write(key, guarded(key, null, clearOne(next, key, patch, rules)));
  /* A write-in holds text only beside its ticked box (FORM_EDIT_SINGLE_WRITER_ENABLED). */
  for (const [key, box] of rules.writeIns ?? []) {
    if (!(key in patch.set) || isEmpty(next[key]?.value) || sameValue(next[key]?.value, draft[key]?.value)) continue;
    const ticked = next[box.group]?.value;
    if (ticked !== undefined && asList(ticked).includes(box.option)) continue;
    if (draft[key]) next[key] = draft[key]!;
    else delete next[key];
    refused.push(refuse(key, "writein_without_box"));
  }
  const changed = diffDrafts(draft, next);
  // A correction's restated value beside a real change is not refused (`refuseSameValue: "whole_patch"`).
  const kept = rules.refuseSameValue === "whole_patch" && changed.length > 0 ? refused.filter((refusal) => refusal.reason !== "same_value") : refused;
  return { draft: next, diff: { changed, refused: kept } };
}

/** `applyPatch` with the rules bound. */
export function createReducer(rules: PatchRules): (draft: FormDraft, patch: FormPatch) => { draft: FormDraft; diff: FormDiff } {
  return (draft, patch) => applyPatch(draft, patch, rules);
}

/** The saved rows as a draft. A field is the manager's when its row says so, and only while it holds something. */
export function draftFromRows(rows: readonly InstanceValueRow[]): FormDraft {
  const draft: Record<string, DraftField> = {};
  for (const row of rows) {
    const value: FieldValue = row.checked.length > 0 ? [...row.checked] : (row.value ?? "");
    const byManager =
      row.filledBy === "manager" || (row.filledBy === "system" && row.provenance?.source === "manager_statement");
    const owner: Owner = isEmpty(value) ? "empty" : byManager ? "manager" : "assistant";
    draft[row.fieldKey] = { key: row.fieldKey, value, owner };
  }
  return draft;
}
