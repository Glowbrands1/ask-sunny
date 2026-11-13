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
