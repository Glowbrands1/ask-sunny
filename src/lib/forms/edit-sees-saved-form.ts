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
  /** The round's patch (its how and evidence); null when the write was the old path's free-text revision. */
  readonly patch: { readonly how?: Readonly<Record<string, string>>; readonly evidence?: Readonly<Record<string, string>> } | null;
  /** Every stored value on the form now. */
  readonly stored: Readonly<Record<string, FieldValue>>;
  /** The keys whose stored value differs from the turn's start. */
  readonly moved: readonly string[];
}

/**
 * QA (13 Nov 2026, the speed change): the check is settled BY CODE when the saved form plainly does what was asked —
 * every touched field changed, the words each change quoted are in its stored value, nothing else moved (apart from
 * what the writer derives), and every content word of the ask is on the stored form. Anything else (a free-text
 * rewrite, a word of the ask on no field, an unexpected field moved) is for the model. Pure.
 */
export function settledByCode(input: CodeCheckInput): { readonly settled: boolean; readonly reason: string } {
  if (input.patch === null) return { settled: false, reason: "rewrite" };
  const touched = new Set(input.fields.map((field) => field.key));
  if (Object.values(input.patch.how ?? {}).some((how) => how === "reword")) return { settled: false, reason: "rewrite" };
  if (input.fields.some((field) => !field.changed)) return { settled: false, reason: "not_changed" };
  for (const [key, quote] of Object.entries(input.patch.evidence ?? {})) {
    const stored = plainValue(input.stored[key] ?? "");
    if (!touched.has(key)) continue;
    if (words(quote).some((word) => !COMMAND_WORDS.has(word) && !stored.includes(word))) return { settled: false, reason: "words_missing" };
  }
  if (input.moved.some((key) => !touched.has(key) && !DERIVED_KEYS.has(key))) return { settled: false, reason: "other_moved" };
  const form = Object.values(input.stored).map(plainValue).join("\n");
  const name = new Set(words(input.employeeName ?? ""));
  const asked = words(input.ask).filter((word) => !COMMAND_WORDS.has(word) && !name.has(word));
  if (asked.some((word) => !form.includes(word))) return { settled: false, reason: "ask_not_on_form" };
  return { settled: true, reason: "code" };
}
