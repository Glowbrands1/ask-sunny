import { personKey, readLoopRecords } from "./card-record";

/**
 * ============================================================================
 * WHAT THE LOOP SETTLED FOR A CARD, FOR CREATE'S CURRENCY CHECK (QA, 17 Nov 2026; Runner 2's saved-form run on 33863575)
 * ============================================================================
 *
 * 6 of 138 loop cards were refused at Create: "This proposal is out of date: the conversation now says the form is for
 * <typed>, not <card name>" (c003, c039, c134, c220, c232) or "… names more than one person (resubmit, LPSVA, Avg Club)"
 * (c210). In every one the loop had seated the right person with its own evidence checks; Create's name reader re-read the
 * whole chat and took a job title or a salon beside the name ("Tanning Consultant <name>", "TC <name>", "<name> <salon>"),
 * metric words, or a person named only in a write-up pasted after the card as "the form's person". A card the loop shows as
 * ready must pass Create: the check is given the loop's own record for THIS card (the server's trace, one-way keys only),
 * never loosened for any other card:
 * - the card is the loop's record for this proposal id, with this very name (else nothing is given and the check runs as before);
 * - the manager message the card's turn answered: what came before it the loop read with its checks, so Create reads the
 *   turns after it;
 * - the names settled as the card's person: the card's name and every typed spelling a recorded name question asked
 *   about while offering this card's person.
 */
export interface LoopCardSettlement {
  /** The manager message the card's turn answered: its id, and a one-way key of its text for a history whose ids differ. */
  readonly messageId: string | null;
  readonly questionKey: string | null;
  readonly isSettledName: (name: string) => boolean;
}

export async function loopCardSettlement(input: {
  readonly conversationId?: string;
  readonly userId: string;
  readonly messageIds: readonly string[];
  readonly proposalId: string;
  readonly employeeName: string;
}): Promise<LoopCardSettlement | null> {
  const records = await readLoopRecords(input.conversationId, input.userId, input.messageIds);
  const card = records.cards.find((record) => record.proposalId === input.proposalId);
  if (!card || !card.nameKey || card.nameKey !== personKey(input.employeeName)) return null;
  const keys = new Set<string>([card.nameKey]);
  if (card.employeeKey) {
    for (const asked of records.nameQuestions) if (asked.offeredKeys.includes(card.employeeKey)) keys.add(asked.typedKey);
  }
  return { messageId: card.messageId, questionKey: card.questionKey ?? null, isSettledName: (name: string) => keys.has(personKey(name)) };
}

/**
 * The conversation after the card's own turn (the manager message it answered, and the reply that showed the card), by id,
 * else by the message's key; the whole conversation when that message is not found (nothing is assumed).
 */
export function turnsAfterCard<T extends { readonly id?: string; readonly role: string; readonly content: string }>(conversation: readonly T[], settlement: Pick<LoopCardSettlement, "messageId" | "questionKey">): readonly T[] {
  const byId = settlement.messageId ? conversation.findIndex((turn) => turn.role === "user" && turn.id === settlement.messageId) : -1;
  const at = byId >= 0
    ? byId
    : settlement.questionKey
      ? conversation.map((turn, index) => ({ turn, index })).filter(({ turn }) => turn.role === "user" && personKey(String(turn.content ?? "")) === settlement.questionKey).at(-1)?.index ?? -1
      : -1;
  if (at < 0) return conversation;
  const reply = conversation.findIndex((turn, index) => index > at && turn.role === "assistant");
  return conversation.slice(reply > at ? reply + 1 : at + 1);
}
