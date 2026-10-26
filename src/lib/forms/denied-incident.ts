import { negatedLateShiftEnabled } from "@/lib/config/chat-quality-flags";

/**
 * ============================================================================
 * A LATENESS OR ABSENCE THE MANAGER DENIES IS NOT ONE (NEGATED_LATE_SHIFT_ENABLED)
 * ============================================================================
 *
 * QA-2, 26 Oct 2026 (coordinator decision): "was not late to her shift",
 * "was never late" and "is not late" cited Attendance p.14, because the
 * lateness and absence readers matched the word and ignored the "not" before
 * it. On, a match counts only when no negation stands just before it in the
 * same clause; a clause ends at a comma, a dash, "but" or "and". "wasn't late
 * but left early" is still an early departure; "was late, not absent" is
 * still late. "no one was late", "nobody was late" and "not late nor absent"
 * deny too (QA-6). Off, every match counts, as before.
 */

const DENIED_BEFORE =
  /\b(?:not|never|no\s+longer|no\s+one|nobody|none\s+of\s+\S+|neither|nor|was ?n[o']?t|wasn't|is ?n[o']?t|isn't|were ?n[o']?t|weren't|did ?n[o']?t|didn't|has ?n[o']?t|hasn't|have ?n[o']?t|haven't)\s+(?:\S+\s+){0,2}$/i;

/** Whether the word at `index` is denied in its own clause. */
export function deniedAt(text: string, index: number): boolean {
  const clause = text.slice(0, index).split(/[,;:–—]|\s-\s|\bbut\b|\band\b/i).pop() ?? "";
  return DENIED_BEFORE.test(clause);
}

/** Whether `text` says `pattern` at least once without denying it. Off, `pattern.test(text)`. */
export function saysUndenied(text: string, pattern: RegExp): boolean {
  if (!negatedLateShiftEnabled()) return pattern.test(text);
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  return [...text.matchAll(new RegExp(pattern.source, flags))].some((match) => !deniedAt(text, match.index));
}
