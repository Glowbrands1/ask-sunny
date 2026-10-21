import { fieldsForVariant, type FormDocument, type FormField } from "./document";

/**
 * ============================================================================
 * A SENTENCE EVERY RECORD ENDS WITH, PUT THERE BY CODE
 * ============================================================================
 *
 * HR feedback, 3 Oct 2026: every Corrective Action Action Plan ends with
 *
 *   "Future policy violations may be subject to additional corrective action
 *    up to and including termination of employment."
 *
 * District Manager feedback, 21 Oct 2026 (revision 6 of the form): "… may
 * RESULT IN additional corrective action …". The revision-5 wording is kept,
 * byte for byte, as what that version requires — a form filed against it
 * prints what was signed — and is SUPERSEDED by the new one: a value carried
 * onto revision 6 loses the old sentence rather than printing both.
 *
 * WHY THIS IS NOT A PROMPT INSTRUCTION. The narrative guard removes any
 * sentence naming a corrective action or a termination the manager did not
 * supply — correctly, for anything the MODEL writes — so a closing the model
 * was asked to write would be stripped by the guard that runs on it. And a
 * manager's edit, a redraft or a chat correction would each be one more chance
 * to lose it. So the sentence is a property of the field in the stored
 * version (`FormField.requiredClosing`) and this module puts it at the end of
 * the value on every write and every render.
 *
 *   APPENDED when absent.
 *   NEVER DUPLICATED: a value that already ends with it is returned unchanged,
 *   and a copy stranded mid-text — a manager typed after it, or a redraft put
 *   it first — is moved to the end rather than printed twice.
 *   EXACT: the closing is the version's text, byte for byte. A near-miss the
 *   manager typed ("further violations could lead to…") is their sentence and
 *   is left alone; the required one still follows it.
 *
 * Pure and browser-safe.
 */

/** The Corrective Action Form's Action Plan closing, in the business's words (revision 6). */
export const CA_ACTION_PLAN_CLOSING =
  "Future policy violations may result in additional corrective action up to and including termination of employment.";

/** Revision 5's wording of the same closing — what forms filed against that version end with. */
export const CA_ACTION_PLAN_CLOSING_REVISION_5 =
  "Future policy violations may be subject to additional corrective action up to and including termination of employment.";

/**
 * Earlier wordings a closing replaces. A value carrying one of them — a
 * revision-5 plan carried onto revision 6 — has it taken out before the
 * current closing is put on, so the record never ends with both.
 */
const SUPERSEDED_CLOSINGS: ReadonlyMap<string, readonly string[]> = new Map([
  [CA_ACTION_PLAN_CLOSING, [CA_ACTION_PLAN_CLOSING_REVISION_5]],
]);

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The closing, matched however it was spaced, cased or punctuated at its end —
 * so a copy that went through a textarea or a model comes out as one copy.
 */
function closingPattern(closing: string): RegExp {
  const words = closing
    .replace(/[.!?]+$/, "")
    .trim()
    .split(/\s+/)
    .map(escapeRegExp);
  return new RegExp(`${words.join("\\s+")}\\s*[.!?]*`, "gi");
}

/**
 * The value with the closing as its last sentence, exactly once.
 *
 * An EMPTY value stays empty: an Action Plan nobody has written is a field for
 * the manager to fill, and a lone closing line would make it look filled. The
 * printed page still carries the closing — see `closingForDisplay`.
 */
export function withRequiredClosing(value: string, closing: string): string {
  const wanted = closing.trim();
  if (wanted === "" || typeof value !== "string" || value.trim() === "") return value;

  const body = [wanted, ...(SUPERSEDED_CLOSINGS.get(wanted) ?? [])]
    .reduce((text, sentence) => text.replace(closingPattern(sentence), " "), value)
    // Tidy only the seams the removal left: doubled spaces, a space before a
    // line break, and blank lines at the end.
    .replace(/[^\S\n]{2,}/g, " ")
    .replace(/[^\S\n]+\n/g, "\n")
    .trim();

  if (body === "") return wanted;
  // A body that stops mid-sentence gets its full stop, so the closing reads as
  // its own sentence rather than the tail of the last one.
  const terminated = /[.!?…"'”’)\]]$/.test(body) ? body : `${body}.`;
  const rebuilt = `${terminated} ${wanted}`;
  // Already exactly right: hand back the original so nothing is rewritten.
  return rebuilt === value.trim() ? value : rebuilt;
}

/**
 * What a page prints for a field with a closing: the value with it, or — on a
 * blank form — the closing alone, so a printed form always carries the line.
 */
export function closingForDisplay(value: string, closing: string): string {
  return value.trim() === "" ? closing.trim() : withRequiredClosing(value, closing);
}

/** Whether a value ends with its field's closing, the test a reader would apply. */
export function endsWithRequiredClosing(value: string, closing: string): boolean {
  return value.trim() !== "" && withRequiredClosing(value, closing) === value;
}

/** The fields of a version that declare a closing. */
export function closingFields(document: FormDocument, variantKey: string | null): FormField[] {
  return fieldsForVariant(document, variantKey).filter(
    (field) => typeof field.requiredClosing === "string" && field.requiredClosing !== "",
  );
}

/**
 * Applies every declared closing to the values ABOUT TO BE WRITTEN.
 *
 * Only keys present in `values` are touched — a write that does not mention
 * the Action Plan does not create one — and only fields the stored version
 * marks, so no other template's values change by a byte.
 */
export function applyRequiredClosings(
  document: FormDocument,
  variantKey: string | null,
  values: Record<string, string>,
): Record<string, string> {
  const fields = closingFields(document, variantKey);
  if (fields.length === 0) return values;

  let next: Record<string, string> | null = null;
  for (const field of fields) {
    const current = values[field.key];
    if (typeof current !== "string") continue;
    const closed = withRequiredClosing(current, field.requiredClosing!);
    if (closed !== current) {
      next ??= { ...values };
      next[field.key] = closed;
    }
  }
  return next ?? values;
}
