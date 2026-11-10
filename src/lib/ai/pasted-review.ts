import { pastedReviewNotAccountEnabled } from "@/lib/config/chat-quality-flags";

/*
 * ============================================================================
 * A PASTED REVIEW IS NO ACCOUNT (PASTED_REVIEW_NOT_ACCOUNT_ENABLED)
 * ============================================================================
 *
 * Pau's sf-s22 (Sunny production, 4 Nov 2026): with <A>'s Corrective Action card on screen, "Use this to make it:
 * Please make the following edits and resubmit:\n\n1. **Kit Coaching Document:** This was signed on 10/16/2026. I do
 * not see a date showing that Spa/EFT was signed by <C>. …\n\n2. **Details – Observed:** Please reword this section to:
 * … <C> completed 24 tans …" — a reviewer's notes on <C>'s form, pasted to show the format. The card became a Coaching
 * Form ("Kit Coaching Document"), its Observation took <C>'s notes and its Date their signing date; "It needs to be a
 * CA, not a coaching form" kept both.
 *
 * With the flag on, a turn holding a pasted review — from "Please make the following edits / changes / corrections",
 * or else from the first of two or more numbered "**Heading:**" items — is read only for the manager's words before
 * it ("Use this to make it"). Pure.
 */

const REVIEW_LEAD = /\bplease\s+make\s+the\s+following\s+(?:edits|changes|corrections|updates)\b/i;
// At a line's start, or straight after a colon ("Use this: 1. **Kit Coaching Document:** …").
const HEADING_ITEM = /(?<=^|:[ \t]*)[ \t]*\d+[.)][ \t]+\*\*[^*\n]{2,80}\*\*/gm;

/** Where the pasted review starts, or -1. */
export function pastedReviewStart(text: string): number {
  const lead = REVIEW_LEAD.exec(text);
  if (lead) return lead.index;
  const items = [...text.matchAll(HEADING_ITEM)];
  return items.length >= 2 ? items[0]!.index! : -1;
}

/**
 * The text without a pasted review: the manager's words before it ("Use this to make it"), and any after it — the
 * review is its lead paragraph, its numbered items and their indented lines. The text as it is without one.
 */
export function withoutPastedReview(text: string): string {
  const start = pastedReviewStart(text);
  if (start < 0) return text;
  const before = text.slice(0, start).replace(/[\s:;,\-–—]+$/, "").trim();
  const paragraphs = text.slice(start).split(/\n[ \t]*\n/);
  let end = 1;
  while (end < paragraphs.length && (/^[ \t]*\d+[.)][ \t]+/.test(paragraphs[end]!) || /^[ \t]+\S/.test(paragraphs[end]!) || paragraphs[end]!.trim() === "")) end += 1;
  const after = paragraphs.slice(end).join("\n\n").trim();
  return [before, after].filter(Boolean).join("\n\n");
}

/** As `withoutPastedReview`, only with the flag on. */
export function readWithoutPastedReview(text: string): string {
  return pastedReviewNotAccountEnabled() ? withoutPastedReview(text) : text;
}

/** The manager's turns without a pasted review, the others as they are; only with the flag on. */
export function turnsWithoutPastedReview<T extends { role: string; content: string }>(turns: T[]): T[] {
  if (!pastedReviewNotAccountEnabled()) return turns;
  return turns.map((turn) => (turn.role === "user" ? { ...turn, content: withoutPastedReview(turn.content) } : turn));
}
