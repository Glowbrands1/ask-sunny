import { accountBeforeRequestEnabled } from "@/lib/config/chat-quality-flags";
import type { ChatFormProposal } from "@/types";

/*
 * ============================================================================
 * THE ACCOUNT THE CARD SHOWS IS THE ACCOUNT THE DRAFT IS HANDED (ACCOUNT_BEFORE_REQUEST_ENABLED)
 * ============================================================================
 *
 * A manager's production chat (relayed 5 Nov 2026, both apps; the person invented): "rowan marked a session as
 * complete but the guest hadn't been sprayed yet" → "Create a coaching form." → "Is this for Rowan Kestrel?" → "yes".
 * The card's Observation was her account; the card cited only "Create a coaching form." and "yes" (a card's turns
 * start at its request, `forms/this-persons-turns.ts`), and Create sends the cited turns as the draft's notes — so the
 * drafting model wrote without it.
 *
 * With the flag on, a manager turn before the card's first cited turn, not itself cited, whose words the card's
 * Observation shows (every content word of the turn, in the Observation line) is cited too. Pure.
 */

const OBSERVATION_LINE = /^\*\*(?:Observation of Offense|Details of Coaching|What happened):?\*\*\s*(.+)$/im;
const STOP = new Set(["the", "a", "an", "and", "but", "or", "as", "of", "to", "for", "in", "on", "at", "is", "was", "had", "has", "yet", "it", "her", "his", "she", "he", "they", "be", "been"]);

function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[’']/g, "")
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 1 && !STOP.has(word));
}

/** Whether the Observation shows this turn: every content word of it, at least four. */
export function observationShows(observation: string, turn: string): boolean {
  const said = words(turn);
  if (said.length < 4) return false;
  const shown = new Set(words(observation));
  return said.every((word) => shown.has(word));
}

export function withAccountTurnSources<T extends { content: string; formProposal?: ChatFormProposal | null }>(
  answer: T,
  history: readonly { id?: string; role: string; content: string }[],
): T {
  const card = answer.formProposal;
  if (!accountBeforeRequestEnabled() || !card || card.sourceMessageIds.length === 0) return answer;
  const observation = OBSERVATION_LINE.exec(answer.content)?.[1] ?? "";
  if (!observation) return answer;
  const cited = new Set(card.sourceMessageIds);
  // The first cited turn in the history; none there, the card cites only this turn, and every earlier turn is before it.
  const index = history.findIndex((turn) => turn.id !== undefined && cited.has(turn.id));
  const first = index < 0 ? history.length : index;
  if (first <= 0) return answer;
  const added = history
    .slice(0, first)
    .filter((turn) => turn.role === "user" && turn.id !== undefined && !cited.has(turn.id) && observationShows(observation, turn.content))
    .map((turn) => turn.id!);
  if (added.length === 0) return answer;
  return { ...answer, formProposal: { ...card, sourceMessageIds: [...added, ...card.sourceMessageIds] } };
}
