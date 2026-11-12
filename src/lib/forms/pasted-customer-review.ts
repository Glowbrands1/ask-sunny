import { describesIncident } from "@/lib/forms/corrective-action-intake";

/**
 * ============================================================================
 * A PASTED CUSTOMER REVIEW IS THE CUSTOMER'S WORDS: SAY SO, AND ASK WHAT THE MANAGER SAW
 * ============================================================================
 *
 * PASTED_REVIEW_ASKS_WHAT_YOU_SAW_ENABLED (ported from Ask Bubbles: QA's 17n live test there, 12 Nov 2026, item 2). QA's turn (the name
 * invented): "create a coaching form for Wynne Larkspur. Here is a customer review: 'Went in on Saturday and the girl at
 * the counter ignored me for 10 minutes and was rude when I finally asked for help. One star.'" The review was rightly
 * not taken as her account (the card had no Observation), but the reply said "Everything I need is here, drawn from
 * your message above." and never mentioned the review or asked what the manager saw.
 *
 * On: when the manager's turn holds a pasted customer review ("Here is a customer review: '…'", "Google review: …") and
 * their own words outside it say nothing that happened, a card's reply drops "Everything I need is here" and says, with
 * the "what happened" marker the intake reads the next reply by (`answeredWhatHappened`), that the review is the
 * customer's words and asks "What did you see happen?". Pure.
 */

/** "Here is a customer review:", "customer review -", "a google review:", "this yelp review:". */
const REVIEW_LEAD =
  /\b(?:(?:here(?:'s|\s+is|\s+are)|this\s+is|i\s+(?:got|have|received))\s+)?(?:a|an|the|this|our|my)?\s*(?:customer|guest|client|google|yelp|facebook|online)\s+(?:review|complaint|comment)s?\b\s*(?:from\s+[^:\n]{1,40})?\s*[:\-–—]\s*/i;

/** Where the pasted review starts (its lead), or -1. */
export function pastedCustomerReviewStart(text: string): number {
  const lead = REVIEW_LEAD.exec(text ?? "");
  return lead ? lead.index : -1;
}

/** The manager's own words: the turn up to the review's lead. */
export function wordsBeforeReview(text: string): string {
  const start = pastedCustomerReviewStart(text);
  return start < 0 ? text : text.slice(0, start).trim();
}

const SAYS_READY = /^Everything I need is here[^\n]*\n*/im;

export const REVIEW_NOT_ACCOUNT_NOTE =
  "**You haven't told me what happened yet.** The customer review is the customer's words, not your own account, so I haven't put it on the card. What did you see happen? Tell me here and I'll draft it from your words.";

export function withPastedReviewAsk<T extends { content: string; formProposal?: unknown }>(answer: T, question: string): T {
  if (!answer.formProposal) return answer;
  const start = pastedCustomerReviewStart(question);
  if (start < 0) return answer;
  if (describesIncident(question.slice(0, start))) return answer;
  if (/You haven't told me what happened yet/i.test(answer.content)) return answer;
  const without = answer.content.replace(SAYS_READY, "").trim();
  const parts = without.split(/\n{2,}/);
  // The note goes after the card's lead ("Here is what I would put on a **Coaching Form**.").
  const content = [parts[0], REVIEW_NOT_ACCOUNT_NOTE, ...parts.slice(1)].filter(Boolean).join("\n\n");
  return { ...answer, content };
}
