import type { FieldValue, FormDiff } from "./form-reducer";

/**
 * The reply to a form edit from what actually changed
 * (FORM_REPLY_FROM_DIFF_ENABLED): one "Changed <Label> to <value>" line per
 * changed field, or "I didn't change anything on the form." It never says
 * "Updated": a line exists only for a field whose saved value differs.
 */

export const NOTHING_CHANGED = "I didn't change anything on the form.";

/** Longest value quoted in full; a longer one is cut at a word. */
export const REPLY_VALUE_MAX = 120;

function shown(value: FieldValue): string {
  const text = (typeof value === "string" ? value : value.join(", "))
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .join("; ");
  if (text.length <= REPLY_VALUE_MAX) return text;
  const cut = text.slice(0, REPLY_VALUE_MAX);
  const space = cut.lastIndexOf(" ");
  return `${(space > REPLY_VALUE_MAX / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

export function replyFromDiff(diff: Pick<FormDiff, "changed">, labels: Readonly<Record<string, string>>): string {
  if (diff.changed.length === 0) return NOTHING_CHANGED;
  return diff.changed
    .map((change) => {
      const label = labels[change.key] ?? change.key;
      const value = shown(change.after);
      return value === "" ? `Cleared ${label}.` : `Changed ${label} to "${value}".`;
    })
    .join("\n");
}
