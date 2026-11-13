import type { FieldValue } from "./form-reducer";

/**
 * EDIT_SEES_SAVED_FORM_ENABLED (coding 6, 13 Nov 2026; Pau's direction via QA): the patch model stops editing blind.
 * After the turn's writes, the form is read back from storage and this block goes to the patch model with the
 * manager's ask, just before the latest message (`form-patch-prompt.ts`). The model answers with the same schema: no
 * set and no clear confirms; anything else is a correction, written by the same writer (`form-patch-turn.ts`).
 *
 * What the block holds (QA): field keys, labels, the STORED values, whether this turn's patch changed each one in
 * storage, and the manager's own ask. Never the model's earlier output, a refusal's wording, or any other text.
 */

export const SAVED_CHECK_HEADING = "SAVED AFTER YOUR LAST PATCH";

/** At most this many patches in one turn: the first reading and two corrections. */
export const SAVED_CHECK_MAX_PATCHES = 3;

export interface SavedField {
  readonly key: string;
  readonly label: string;
  /** The value as stored now, read back from the database. */
  readonly stored: FieldValue;
  /** Whether this turn's writes changed the stored value. */
  readonly changed: boolean;
}

function flat(value: FieldValue): string {
  const text = typeof value === "string" ? value : value.join(", ");
  const joined = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .join(" / ");
  return joined === "" ? "(empty)" : joined;
}

/** The check block: the fields the turn's patch touched, as stored now, and the manager's ask. */
export function savedCheckBlock(ask: string, fields: readonly SavedField[]): string {
  const rows = fields.map((field) => `${field.key} | ${field.label} | ${field.changed ? "changed this turn" : "not changed"} | ${flat(field.stored)}`);
  return [
    `${SAVED_CHECK_HEADING} (read back from the saved form; key | label | this turn | stored value):`,
    ...(rows.length > 0 ? rows : ["(none)"]),
    `THE MANAGER ASKED: ${ask.trim()}`,
    "Check the stored values against what the manager asked. If the saved form does what was asked, answer turn \"this_form\" with no set and no clear: that confirms it. If something asked for is missing or wrong in the stored values, set only the fields that still need it, under the same rules. Never send a change that is already stored.",
  ].join("\n");
}

/** The fields a patch names (set and clear), in order, once each. */
export function touchedKeys(patch: { readonly set: Readonly<Record<string, unknown>>; readonly clear: readonly string[] }): string[] {
  return [...new Set([...Object.keys(patch.set), ...patch.clear])];
}

/** Keys the writer derives from a change (the policy lines follow the offense box, the Action Plan is synced). */
export const DERIVED_KEYS: ReadonlySet<string> = new Set(["policy_violated", "policy_language", "action_plan", "offense_type"]);

/** Words of an ask that name the edit, not its content ("add that she …", "change the observation to …"). */
const COMMAND_WORDS = new Set([
  "add", "added", "adding", "change", "changed", "make", "made", "put", "set", "update", "updated", "remove", "delete", "replace",
  "include", "write", "rewrite", "please", "can", "could", "would", "should", "you", "also", "that", "this", "the", "and", "but",
  "she", "her", "hers", "his", "him", "they", "them", "their", "its", "need", "needs", "want", "wants", "for", "with", "from",
  "into", "onto", "about", "was", "are", "were", "has", "have", "had", "form", "field", "line", "section", "card", "draft",
  "instead", "now", "then", "there", "here", "what", "which", "too", "just", "say", "says", "said",
]);

function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[’']/g, "")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length > 2);
}

function plainValue(value: FieldValue): string {
  return (typeof value === "string" ? value : value.join(" ")).toLowerCase().replace(/[’']/g, "");
}

export interface CodeCheckInput {
  readonly ask: string;
  readonly employeeName: string | null;
  /** The fields this turn's patches touched, as stored now, and whether each changed from the turn's start. */
  readonly fields: readonly SavedField[];
  /**
   * The round's patch (its set values, how and evidence); null when the write was the old path's revision, which
   * code settles only for a plain add ("add that …", "include …") whose words are all on the form.
   */
  readonly patch: {
    readonly set?: Readonly<Record<string, FieldValue>>;
    readonly how?: Readonly<Record<string, string>>;
    readonly evidence?: Readonly<Record<string, string>>;
  } | null;
  /** Every stored value on the form now. */
  readonly stored: Readonly<Record<string, FieldValue>>;
  /** The keys whose stored value differs from the turn's start. */
  readonly moved: readonly string[];
  /**
   * Each field's own words (its key, label and option names). A word of the ask that names a field ("details",
   * "topic") is not content, but only when that field was touched or moved; naming a field nobody wrote ("…and the
   * other topic is …") is for the model.
   */
  readonly fieldWords?: Readonly<Record<string, readonly string[]>>;
  /** The form's own name ("Corrective Action Form"): naming the form is not content. */
  readonly formName?: string;
}

/** A rewrite of the account or its wording: only the model can tell whether it reads as asked. */
const REWRITE_ASK = /\b(?:make\s+it\s+(?:about|for|sound|more|less)|rewrite|re-?word|redraft|re-?do|professional|outline|template|format|tone|clean(?:er)?\s+up|fix\s+(?:the\s+)?wording)\b/i;
/** A plain addition: "add that …", "include …", "put … on it", "also note …". */
const ADD_ASK = /^\s*(?:please\s+)?(?:can\s+you\s+)?(?:also\s+)?(?:add|include|put|note|mention|insert)\b/i;
/** A date the manager said ("10/14/26", "11/6"): the turn's own date write may move the form's Date. */
/** "fix her last name, it is X", "change his name to X". */
const NAME_FIX = /\b(?:fix|change|correct|update)\s+(?:her|his|their|the)\s+(?:last\s+|first\s+|full\s+)?name\b[^.]*?\b(?:it\s+is|it's|to|is)\s+([\p{L}][\p{L}'’ -]{1,60})$/iu;
const SAID_DATE = /\b\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?\b/;

function closeTo(word: string, vocabulary: ReadonlySet<string>): boolean {
  if (vocabulary.has(word)) return true;
  if (word.length < 6) return false;
  for (const known of vocabulary) {
    if (Math.abs(known.length - word.length) > 2) continue;
    let edits = 0;
    const a = word;
    const b = known;
    // A cheap distance: letters out of place, enough for "observtion" / "observation".
    const shorter = a.length <= b.length ? a : b;
    const longer = a.length <= b.length ? b : a;
    let at = 0;
    for (const letter of longer) {
      if (shorter[at] === letter) at += 1;
      else edits += 1;
      if (edits > 2) break;
    }
    if (edits <= 2 && at >= shorter.length - 1) return true;
  }
  return false;
}

/**
 * QA (13 Nov 2026, the speed change; widened after the reason breakdown): the check is settled BY CODE when the saved
 * form plainly does what was asked — every touched field changed or already holds what the patch asked for, the words
 * each change quoted are on the stored form, nothing else moved (apart from what the writer derives, and the Date when
 * a date was said), and every content word of the ask is on the form or names a field. A rewrite of the account or
 * its wording, a word of the ask on no field, or an unexpected move is for the model. Pure.
 */
export function settledByCode(input: CodeCheckInput): { readonly settled: boolean; readonly reason: string; readonly detail?: readonly string[] } {
  const touched = new Set(input.fields.map((field) => field.key));
  const form = Object.values(input.stored).map(plainValue).join("\n");
  /*
   * A name fix ("fix her last name, it is Quill-Hart"): settled when the stored employee name now holds the new name
   * and nothing else moved but the name fields.
   */
  const nameFix = NAME_FIX.exec(input.ask)?.[1]?.trim();
  if (nameFix) {
    const named = plainValue(input.stored.employee_name ?? "").includes(nameFix.toLowerCase().replace(/[’']/g, ""));
    const onlyName = input.moved.every((key) => key === "employee_name" || DERIVED_KEYS.has(key));
    return named && onlyName ? { settled: true, reason: "code" } : { settled: false, reason: "name_fix", detail: [nameFix] };
  }
  if (REWRITE_ASK.test(input.ask)) return { settled: false, reason: "rewrite" };
  if (input.patch === null && !ADD_ASK.test(input.ask)) return { settled: false, reason: "rewrite" };
  if (Object.values(input.patch?.how ?? {}).some((how) => how === "reword")) return { settled: false, reason: "rewrite" };
  const still = input.fields
    .filter((field) => !field.changed)
    .filter((field) => {
      // Already what the patch asked for: nothing needed to change.
      const wanted = input.patch?.set?.[field.key];
      return wanted === undefined || plainValue(wanted).trim() !== plainValue(field.stored).trim();
    })
    .map((field) => field.key);
  if (still.length > 0) return { settled: false, reason: "not_changed", detail: still };
  for (const [key, quote] of Object.entries(input.patch?.evidence ?? {})) {
    if (!touched.has(key) || Array.isArray(input.stored[key])) continue;
    const missing = words(quote).filter((word) => !COMMAND_WORDS.has(word) && !form.includes(word));
    if (missing.length > 0) return { settled: false, reason: "words_missing", detail: missing };
  }
  const allowed = (key: string) => touched.has(key) || DERIVED_KEYS.has(key) || (key === "form_date" && SAID_DATE.test(input.ask));
  const others = input.moved.filter((key) => !allowed(key));
  if (others.length > 0) return { settled: false, reason: "other_moved", detail: others };
  const written = new Set([...touched, ...input.moved]);
  const fieldWordSets = Object.entries(input.fieldWords ?? {}).map(([key, list]) => ({ key, words: new Set(list.flatMap((item) => words(item))) }));
  const vocabulary = new Set([...fieldWordSets.flatMap((field) => [...field.words]), ...words(input.formName ?? "")]);
  const name = new Set(words(input.employeeName ?? ""));
  const askWords = words(input.ask).filter((word) => !COMMAND_WORDS.has(word) && !name.has(word));
  // A field the ask names that nobody wrote: the ask may want it changed.
  const namedUnwritten = askWords.filter((word) => {
    if (words(input.formName ?? "").includes(word)) return false;
    const naming = fieldWordSets.filter((field) => closeTo(word, field.words));
    return naming.length > 0 && !naming.some((field) => written.has(field.key));
  });
  if (namedUnwritten.length > 0) return { settled: false, reason: "names_unwritten_field", detail: namedUnwritten };
  const asked = askWords.filter((word) => !closeTo(word, vocabulary));
  const unheard = asked.filter((word) => !form.includes(word));
  if (unheard.length > 0) return { settled: false, reason: "ask_not_on_form", detail: unheard };
  return { settled: true, reason: "code" };
}
