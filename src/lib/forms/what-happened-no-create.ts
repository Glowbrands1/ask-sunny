import { whatHappenedNoCreateEnabled } from "@/lib/config/chat-quality-flags";

/**
 * ============================================================================
 * WHILE THE APP ASKS WHAT HAPPENED, THE CARD OFFERS NO CREATE
 * ============================================================================
 *
 * WHAT_HAPPENED_NO_CREATE_ENABLED (QA, live r19, 10 Nov 2026; both apps; default off). With
 * COACHING_ASKS_WHAT_HAPPENED on, "create a coaching form for <name>" now asks "You haven't told me what happened
 * yet…", but the Coaching card beside it still showed an active **Create draft** (Employee only, no Details): the ask
 * and the button contradicted each other. On: a card whose reply asks what happened (the same marker the asks write)
 * shows, but offers no Create until the account arrives — the next card, built from the manager's answer, offers it
 * as before. A "Create the draft here when you're ready" line beside the ask goes too. Any other reply is left as it is.
 * After the reply is built; outside the proposal flow. Pure.
 */

const MARKER = "You haven't told me what happened yet";
const CREATE_LINE = /^[^\n]*Create the draft here when you're ready[^\n]*\n?/gim;

interface Card {
  readonly supportsInlineDraft: boolean;
}

export function withNoCreateWhileAsking<T extends { content: string; formProposal?: Card | null }>(answer: T): T {
  const card = answer.formProposal;
  if (!whatHappenedNoCreateEnabled() || !card || !answer.content.includes(MARKER)) return answer;
  const content = answer.content.replace(CREATE_LINE, "").replace(/\n{3,}/g, "\n\n").trim();
  if (!card.supportsInlineDraft && content === answer.content) return answer;
  return { ...answer, content, formProposal: { ...card, supportsInlineDraft: false } };
}
