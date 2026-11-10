import { stepBReplyKeepsLinesEnabled } from "@/lib/config/chat-quality-flags";

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

/*
 * STEP_B_REPLY_KEEPS_LINES_ENABLED (QA's live draft test, 8 Nov 2026): a field written on several lines (Observed: …
 * / Expectation: … / Going Forward: …) was quoted on one line joined with "; " ("Observed:; Ottoline missed …;
 * Expectation:; …"). With the flag on it is quoted line by line, as the form shows it: at most QUOTED_LINES_MAX lines,
 * each cut at a word. Off, as before.
 */
export const QUOTED_LINES_MAX = 8;

function quotedLines(value: FieldValue): string[] | null {
  if (typeof value !== "string") return null;
  const lines = value.split("\n").map((line) => line.trim()).filter((line) => line !== "");
  if (lines.length < 2) return null;
  const cut = (line: string) => {
    if (line.length <= REPLY_VALUE_MAX) return line;
    const room = line.slice(0, REPLY_VALUE_MAX);
    const space = room.lastIndexOf(" ");
    return `${(space > REPLY_VALUE_MAX / 2 ? room.slice(0, space) : room).trimEnd()}…`;
  };
  const shownLines = lines.slice(0, QUOTED_LINES_MAX).map(cut);
  if (lines.length > QUOTED_LINES_MAX) shownLines.push("…");
  return shownLines;
}

export function replyFromDiff(diff: Pick<FormDiff, "changed">, labels: Readonly<Record<string, string>>): string {
  if (diff.changed.length === 0) return NOTHING_CHANGED;
  const keepsLines = stepBReplyKeepsLinesEnabled();
  return diff.changed
    .map((change) => {
      const label = labels[change.key] ?? change.key;
      const quoted = keepsLines ? quotedLines(change.after) : null;
      if (quoted) return `Changed ${label} to:\n${quoted.map((line) => `> ${line}`).join("\n")}`;
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
