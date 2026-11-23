import type { IdentifiedTurn } from "./evidence";

/**
 * ============================================================================
 * THE CARD'S PERSON IS NAMED BY THE MANAGER IN THIS REQUEST (CARD_PERSON_THIS_REQUEST_ENABLED)
 * ============================================================================
 *
 * The outside audit's wrong-person risk (approved by Pau, 21 Nov 2026; it happened in Ask Bubbles on 18 Nov 2026). The
 * loop seated a roster person on a card when ANY manager turn in the chat held their name, or any earlier card in the
 * chat was theirs. So a name from an unrelated turn several turns back, or a card made long before for someone the
 * manager had since moved on from, could put a form on the wrong person.
 *
 * "This request" is a window of the manager's own turns. It starts after the later of:
 *  - the manager turn the chat's LAST CARD was made for (a card ends a request: the next form is a new one), and
 *  - the LAST manager turn before this one that names a different roster person (turning to someone else ends it).
 * A manager turn inside the window that holds the person's name settles them: the turn that asks for the form, or an
 * earlier turn of the same request (a story with no ask, then "a corrective action", or the answer to Sunny's "Who is
 * this form for?"). A card made for this very person counts only while no different person was named after it.
 * Names only in Sunny's replies or in a tool note are never read here: only the manager's turns are.
 *
 * Pure. It compares ids, positions and the callers' name checks (`holdsPhrase` over the roster's names); it reads no
 * words of the manager's and holds no word list.
 */

export interface PersonInRequestInput {
  /** The conversation's turns with ids, oldest first, the message being answered last (`identifiedTurns`). */
  readonly turns: readonly IdentifiedTurn[];
  /** Whether this manager text names the card's person (a full name, or a whole first or preferred name). */
  readonly namesThisPerson: (text: string) => boolean;
  /** Whether this manager text names a roster person other than the card's. */
  readonly namesAnother: (text: string) => boolean;
  /** The manager message ids each card of this chat was made for (`CardRecord.messageId`), any person; null when unrecorded. */
  readonly cardMessageIds: readonly (string | null)[];
  /** The same, for the cards made for this person only. */
  readonly personCardMessageIds: readonly (string | null)[];
}

/** The index of the turn with this id, or -1 (an id naming no turn, or more than one, is unplaced: never first-match). */
function placeOf(turns: readonly IdentifiedTurn[], id: string | null): number {
  if (!id) return -1;
  const found = turns.filter((turn) => turn.id === id);
  return found.length === 1 ? found[0]!.index : -1;
}

/** Where this request starts: the index of the last turn that belongs to an earlier request, or -1. */
export function requestStart(input: Pick<PersonInRequestInput, "turns" | "namesAnother" | "cardMessageIds">): number {
  const { turns } = input;
  const current = turns.length - 1;
  const turnedAway = Math.max(-1, ...turns.filter((turn) => turn.role === "user" && turn.index < current && input.namesAnother(turn.content)).map((turn) => turn.index));
  const lastCard = Math.max(-1, ...input.cardMessageIds.map((id) => placeOf(turns, id)));
  return Math.max(turnedAway, lastCard);
}

/** Whether the manager named this person in this request, or a card for them stands with no different person named since. */
export function personNamedInRequest(input: PersonInRequestInput): boolean {
  const { turns } = input;
  const current = turns.length - 1;
  const start = requestStart(input);
  if (turns.some((turn) => turn.role === "user" && turn.index > start && input.namesThisPerson(turn.content))) return true;
  // A card made for this person, after the last turn that named someone else (a card that cannot be placed counts only
  // when nobody else was ever named).
  const turnedAway = Math.max(-1, ...turns.filter((turn) => turn.role === "user" && turn.index < current && input.namesAnother(turn.content)).map((turn) => turn.index));
  return input.personCardMessageIds.some((id) => {
    const at = placeOf(turns, id);
    return at === -1 ? turnedAway === -1 : at >= turnedAway;
  });
}
