import { diffReplyOptionLabelsEnabled } from "@/lib/config/chat-quality-flags";

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

export function replyFromDiff(
  diff: Pick<FormDiff, "changed">,
  labels: Readonly<Record<string, string>>,
  /** DIFF_REPLY_OPTION_LABELS_ENABLED: each checkbox group's option labels, by group and option key. */
  options: Readonly<Record<string, Readonly<Record<string, string>>>> = {},
): string {
  if (diff.changed.length === 0) return NOTHING_CHANGED;
  // DIFF_REPLY_OPTION_LABELS_ENABLED (v2-Gate-Sunny-2 / QA, 14 Nov 2026): `Changed Type of Offense to "standards_of_conduct"`.
  const labelled = diffReplyOptionLabelsEnabled();
  return diff.changed
    .map((raw) => {
      const group = labelled ? options[raw.key] : undefined;
      const change = group && typeof raw.after !== "string" ? { ...raw, after: raw.after.map((option) => group[option] ?? option) } : raw;
      const label = labels[change.key] ?? change.key;
      const value = shown(change.after);
      return value === "" ? `Cleared ${label}.` : `Changed ${label} to "${value}".`;
    })
    .join("\n");
}

/*
 * ============================================================================
 * THE REPLY FROM THE SAVED DIFF (FORM_EDIT_NOOP_GUARD_ENABLED, STEP 4)
 * ============================================================================
 *
 * One line per field whose saved value really changed:
 *
 *   Updated: <label>: <value>
 *
 * the value on one line, at most UPDATED_VALUE_MAX characters, cut at a word;
 * a checkbox group shows its ticked options' labels; a field emptied shows
 * "(cleared)". Nothing changed: UNCHANGED_FORM_REPLY, exactly. Never `shown()`.
 */

export const UNCHANGED_FORM_REPLY = "I didn't change anything on the form. Tell me which part to change and what it should say.";

/** Longest value in an "Updated:" line, the cut mark included. */
export const UPDATED_VALUE_MAX = 80;

const CUT_MARK = "…";

/** The value on one line, cut at a word to at most UPDATED_VALUE_MAX characters. */
export function updatedValue(text: string): string {
  const one = text.split(/\s+/).filter((word) => word !== "").join(" ");
  if (one.length <= UPDATED_VALUE_MAX) return one;
  const room = one.slice(0, UPDATED_VALUE_MAX - CUT_MARK.length);
  const space = room.lastIndexOf(" ");
  return `${(space > 0 ? room.slice(0, space) : room).trimEnd()}${CUT_MARK}`;
}

/** The "Updated:" lines for what changed, or UNCHANGED_FORM_REPLY. `options`: each checkbox group's option labels by key. */
export function updatedLines(
  changed: readonly { key: string; after: FieldValue }[],
  labels: Readonly<Record<string, string>>,
  options: Readonly<Record<string, Readonly<Record<string, string>>>> = {},
): string {
  if (changed.length === 0) return UNCHANGED_FORM_REPLY;
  return changed
    .map((change) => {
      const label = labels[change.key] ?? change.key;
      const ticked = (typeof change.after === "string" ? [change.after] : [...change.after]).map((item) => item.trim()).filter((item) => item !== "");
      const group = options[change.key];
      const text = group ? ticked.map((option) => group[option] ?? option).join(", ") : ticked.join("\n");
      return `Updated: ${label}: ${text === "" ? "(cleared)" : updatedValue(text)}`;
    })
    .join("\n");
}
