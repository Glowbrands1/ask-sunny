import { expect } from "vitest";

import { KEARNEY, STAFF, type ReplayCase } from "./cases";

/** QA's live check with NEW_REQUEST_OPEN_DRAFT on, 3 Nov 2026 (08:03 UTC). */
export const NOV3_CARD_OBSERVATION_CASES: readonly ReplayCase[] = [
  {
    id: "nov3-card-observation-own-request",
    title: "a new request's card reads back only that request as the Observation, not the earlier incident",
    report:
      'the new card for "make me a CA for <name> for being late to opening this morning" read "Observation of Offense: …rugs untl 12;30pm <name> for being late to opening this morning" (QA live check)',
    status: { open: "the card's Observation is read from every turn of the chat" },
    fixFlags: ["CARD_OBSERVATION_OWN_REQUEST_ENABLED"],
    async run(t) {
      t.directory(STAFF);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      await thread.say("a CA");
      await thread.say("Remy Calder failed to take trash out and put rugs out untl 12;30pm");
      t.draftWrites({ observation: "Remy did not take the trash out or put the rugs out until 12:30pm." });
      await thread.create();
      const card = await thread.say("make me a CA for Remy Calder for being late to opening this morning");
      expect(card.formProposal, "no card of its own").toMatchObject({ templateKey: "dpoa", employeeName: "Remy Calder" });
      const observation = /\*\*Observation of Offense:\*\*([^\n]*)/.exec(card.content)?.[1] ?? "";
      expect(observation, "the card reads back the earlier incident").not.toMatch(/trash|rugs/i);
    },
  },
];
