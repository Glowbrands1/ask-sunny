import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase } from "./cases";

/**
 * ============================================================================
 * THE CARD'S OBSERVATION SAYS WHAT THE "ADDED" NOTE SAYS (QA's Sunny 38f live test, 13 Nov 2026;
 * CARD_ADDED_FACT_IN_OBSERVATION_ENABLED, with CARD_CHECKED_AGAINST_WORDS_ENABLED)
 * ============================================================================
 *
 * "create a CA for <A>, she was late on 11/3/26", then in the same chat "she yelled at a guest and she maybe forgot".
 * The reply said "Added to the Observation of Offense: she yelled at a guest" (right), but the card's Observation held
 * the whole turn joined with a space: "she was late on 11/3/26 she yelled at a guest and she maybe forgot". The card's
 * Observation line is built before the card check (`ai/keep-filled-slots.ts`); the check only added the note. Card
 * check rolled back in production after this. The person is the pack's invented one.
 */

const REPORT = "QA's Sunny 38f live test (13 Nov 2026, main 24e0fb74): the note said \"Added …: she yelled at a guest\", the card's Observation held the whole turn";
const FIX = ["CARD_CHECKED_AGAINST_WORDS_ENABLED", "CARD_ADDED_FACT_IN_OBSERVATION_ENABLED"];

export const NOV13_CARD_ADDED_FACT_IN_OBSERVATION_CASES: ReplayCase[] = [
  {
    id: "nov13-card-added-fact-in-observation",
    title: "\"create a CA for Marnie Holloway, she was late on 11/3/26\" → \"she yelled at a guest and she maybe forgot\": the card's Observation is the account, then \"; she yelled at a guest\", and the hedge stays out",
    report: REPORT,
    // Changed on purpose (14 Nov 2026): fixed in production by CARD_CHECKED_AGAINST_WORDS + CARD_ADDED_FACT_IN_OBSERVATION, QA round 38g. Was OPEN.
    status: "fixed",
    fixFlags: FIX,
    async run(t) {
      vi.setSystemTime(new Date("2026-11-13T16:00:00Z"));
      t.directory(STAFF);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      await thread.say("create a CA for Marnie Holloway, she was late on 11/3/26");
      const reply = await thread.say("she yelled at a guest and she maybe forgot");
      const observation = (reply.content.match(/^\*\*Observation of Offense:\*\*\s*(.*)$/m) ?? [])[1] ?? "";
      expect(observation, `the card's Observation:\n${reply.content}`).toBe("she was late on 11/3/26; she yelled at a guest");
      expect(observation, "the hedge is never on the card").not.toMatch(/maybe forgot/i);
      expect(reply.content).toMatch(/\*\*Added to the Observation of Offense:\*\* she yelled at a guest$/m);
    },
  },
];
