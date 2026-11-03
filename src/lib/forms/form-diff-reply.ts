import type { FieldValue, FormDiff } from "./form-reducer";

/**
 * The reply to a form edit from what actually changed
 * (FORM_REPLY_FROM_DIFF_ENABLED): one line per changed field, or "I didn't
 * change anything on the form." It never says "Updated": a line exists only
 * for a field whose saved value differs.
 *
 * QA, 3 Nov 2026 (Step B flip): the old line quoted the whole new value with
 * its line breaks turned into ";" and cut at 120 characters ("Changed Details
 * of Coaching to "Observed:; Dana … be…""), and never said what was added. A
 * line now says what changed, from the before and after values themselves:
 *
 *   text added at the end    Added to <Label>: "<the added text>"
 *   new lines among the old  Added to <Label>: "<each new line>"
 *   lines taken out          Removed from <Label>: "<each line>"
 *   an empty field filled    Filled in <Label>: "<value>"
 *   one line for another     Changed <Label> from "<old>" to "<new>".
 *   anything else            Rewrote <Label>.
 *   options                  <Label> is now <a, b>.
 *
 * Each line is quoted whole, never cut mid-word; when they are longer than
 * REPLY_VALUE_MAX the line says how much changed instead of quoting it.
 */

export const NOTHING_CHANGED = "I didn't change anything on the form.";

/** Longest text quoted in a reply line. Longer text is described, not cut. */
export const REPLY_VALUE_MAX = 240;

function linesOf(value: string): string[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

/** Each line quoted on its own ("a", "b" and "c"), or null when together they are longer than REPLY_VALUE_MAX. */
function quoted(parts: readonly string[]): string | null {
  if (parts.length === 0 || parts.join(" ").length > REPLY_VALUE_MAX) return null;
  const each = parts.map((part) => `"${part}"`);
  return each.length === 1 ? each[0]! : `${each.slice(0, -1).join(", ")} and ${each[each.length - 1]}`;
}

function textLine(label: string, before: string, after: string): string {
  if (after.trim() === "") return `Cleared ${label}.`;
  if (before.trim() === "") {
    const shown = quoted(linesOf(after));
    return shown ? `Filled in ${label}: ${shown}.` : `Filled in ${label}.`;
  }
  const head = before.trim();
  const full = after.trim();
  if (full.startsWith(head)) {
    const added = linesOf(full.slice(head.length));
    const shown = quoted(added);
    if (added.length > 0) return shown ? `Added to ${label}: ${shown}.` : `Added ${added.length} line${added.length === 1 ? "" : "s"} to ${label}.`;
  }
  const old = linesOf(before);
  const now = linesOf(after);
  const added = now.filter((line) => !old.includes(line));
  const removed = old.filter((line) => !now.includes(line));
  if (removed.length === 0 && added.length > 0) {
    const shown = quoted(added);
    return shown ? `Added to ${label}: ${shown}.` : `Added ${added.length} line${added.length === 1 ? "" : "s"} to ${label}.`;
  }
  if (added.length === 0 && removed.length > 0) {
    const shown = quoted(removed);
    return shown ? `Removed from ${label}: ${shown}.` : `Removed ${removed.length} line${removed.length === 1 ? "" : "s"} from ${label}.`;
  }
  const from = quoted(removed);
  const to = quoted(added);
  if (from && to && removed.length === 1 && added.length === 1) return `Changed ${label} from ${from} to ${to}.`;
  return `Rewrote ${label}.`;
}

export function replyFromDiff(diff: Pick<FormDiff, "changed">, labels: Readonly<Record<string, string>>): string {
  if (diff.changed.length === 0) return NOTHING_CHANGED;
  return diff.changed
    .map((change) => {
      const label = labels[change.key] ?? change.key;
      if (typeof change.after !== "string" || typeof change.before !== "string") {
        const options = (typeof change.after === "string" ? [change.after] : [...change.after]).filter((option) => option.trim() !== "");
        return options.length === 0 ? `Cleared ${label}.` : `${label} is now ${options.join(", ")}.`;
      }
      return textLine(label, change.before, change.after);
    })
    .join("\n");
}

/** The value as one line of text, for callers that show it whole. */
export function shownValue(value: FieldValue): string {
  return linesOf(typeof value === "string" ? value : value.join(", ")).join(" ");
}
