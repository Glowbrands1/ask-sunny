import "server-only";

import type { AskResponse } from "@/lib/ai/types";
import { sameNameUnmappedNoteEnabled } from "@/lib/config/chat-quality-flags";
import { salonById } from "@/data/salons";

/**
 * ============================================================================
 * THE OTHER PERSON WITH THIS NAME, AT NO SALON (SAME_NAME_UNMAPPED_NOTE_ENABLED)
 * ============================================================================
 *
 * QA's ruling (a) on Sunny 38b's live check (13 Nov 2026): the directory's one pair of active people with the same full
 * name was never asked about. The chat's roster holds only people at a salon Ask Sunny maps; the second person's only
 * location was a Woven location that is not a salon, so the roster had one of them and the card went to that one
 * without a word. On, a card for that name says so in one plain line, and Create stays:
 *
 *   "There's also an active <name> at a location that isn't one of your salons in Ask Sunny. This card is for the one
 *    at <salon>."
 *
 * Only when another ACTIVE person has the card's name and is not in the roster read (the roster's own same-name pairs
 * are asked about by SAME_NAME_ASKS_WHICH). Ids only; nothing is chosen.
 */

export interface UnmappedNoteInput {
  /** The roster people with the card's name (those the chat could choose). */
  readonly rosterIds: readonly string[];
  /** Every active directory person with the card's name, wherever they work. */
  readonly activeIds: readonly string[];
}

export function withUnmappedSameNameNote(answer: AskResponse, input: UnmappedNoteInput): AskResponse {
  if (!sameNameUnmappedNoteEnabled()) return answer;
  const card = answer.formProposal;
  const name = card?.employeeName?.trim();
  if (!card || !name) return answer;
  const roster = new Set(input.rosterIds);
  if (!input.activeIds.some((id) => !roster.has(id))) return answer;
  const salon = card.locationId ? salonById(card.locationId)?.name ?? null : null;
  const where = salon ? ` This card is for the one at ${salon}.` : "";
  const line = `There's also an active ${name} at a location that isn't one of your salons in Ask Sunny.${where}`;
  return { ...answer, content: `${answer.content.trimEnd()}\n\n${line}` };
}
