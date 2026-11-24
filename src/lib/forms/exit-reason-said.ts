/**
 * ============================================================================
 * THE RESIGNATION REASON IS THE MANAGER'S OWN WORDS (port of Ask Bubbles #1047, c722fe71: its QA's live round 3, 22 Nov 2026, B6)
 * ============================================================================
 *
 * "she is resigning due to second job I'm ready for the draft": the card, the reply and the saved draft had no Reason for
 * Resignation. The model reads the reason (exit_reason) and quotes the manager's words that give it (exit_reason_evidence);
 * code reads no phrasing. It checks only that every word of the reason is in that quote, so nothing the manager did not
 * say reaches the form: "Second job" from "resigning due to second job". The same check runs again at Create.
 */
const words = (text: string) => text.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? [];

/** The reason as a sentence when each of its words (three letters or more) is in the manager's quoted words; null otherwise. */
export function reasonFromQuote(reason: string, quote: string): string | null {
  const said = reason.replace(/\s+/g, " ").trim().replace(/[.!]+$/, "").slice(0, 200);
  if (said === "" || quote.trim() === "") return null;
  const own = words(said).filter((word) => word.length >= 3);
  if (own.length === 0) return null;
  const quoted = new Set(words(quote));
  if (!own.every((word) => quoted.has(word))) return null;
  return `${said.charAt(0).toUpperCase()}${said.slice(1)}.`;
}
