import { personKey, readLoopRecords } from "./card-record";

/**
 * ============================================================================
 * THE NAMES THE LOOP SETTLED FOR A CARD, FOR CREATE'S CURRENCY CHECK (QA, 17 Nov 2026; Runner 2's saved-form run on 33863575)
 * ============================================================================
 *
 * 6 of 138 loop cards were refused at Create: "This proposal is out of date: the conversation now says the form is for
 * <typed>, not <card name>" (c003). The loop had settled the typed spelling as the card's person with its own checks (the
 * recorded Did-you-mean and the manager's answer), but Create's check (`checkProposalIsCurrent`) reads the chat's words
 * only, so it read <typed> as someone else. A card the loop shows as ready must pass Create: the check is given the
 * loop's recorded settlement for THIS card, never loosened. From the server's own trace records (one-way keys only):
 * - the card is the loop's record for this proposal id, with this very name (else nothing is settled);
 * - the names settled for it are the card's name and every typed spelling a recorded name question asked about while
 *   offering this card's person (the loop only seats that person after the manager's answer).
 * A later turn naming anybody else is still read by the check as before, and refused.
 */
export async function loopSettledNames(input: {
  readonly conversationId?: string;
  readonly userId: string;
  readonly messageIds: readonly string[];
  readonly proposalId: string;
  readonly employeeName: string;
}): Promise<((name: string) => boolean) | null> {
  const records = await readLoopRecords(input.conversationId, input.userId, input.messageIds);
  const card = records.cards.find((record) => record.proposalId === input.proposalId);
  if (!card || !card.nameKey || card.nameKey !== personKey(input.employeeName)) return null;
  const keys = new Set<string>([card.nameKey]);
  if (card.employeeKey) {
    for (const asked of records.nameQuestions) if (asked.offeredKeys.includes(card.employeeKey)) keys.add(asked.typedKey);
  }
  return (name: string) => keys.has(personKey(name));
}
