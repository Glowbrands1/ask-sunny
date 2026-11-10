import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayCase } from "./cases";

/**
 * ============================================================================
 * "HOW I DO ABOUT HER FRUSTERATION" AND "TELL ME HOW WHAT TO SAY BACK" ARE NO ACCOUNT (Pau's P14(b), Sunny production, 9 Nov 2026)
 * ============================================================================
 *
 * The manager's turns, verbatim except the person (invented: Wrenna Oakhurst; the manager typed the first name only).
 * The app's answers are shortened: only the manager's words reach the card. The Coaching card's Observation pasted every
 * manager turn, the questions to the app included ("how i do about her frusteration", "tell me how what to say back.").
 * ADVICE_ASK_NOT_ACCOUNT_ENABLED. (That the draft is handed the account at all is #776, ACCOUNT_BEFORE_REQUEST.)
 */

const WRENNA: DirectoryRow = {
  id: "e-aa-wrenna-oakhurst",
  firstName: "Wrenna",
  lastName: "Oakhurst",
  preferredFirstName: null,
  employmentStatus: "active",
  salonIds: ["loc-0309"],
  positionName: "Tanning Consultant",
};

/** The invented person of this file (a function: the registry reads exported arrays as cases). */
export function adviceAskPeople(): readonly DirectoryRow[] {
  return [WRENNA];
}

export const NOV10_ADVICE_ASK_CASES: ReplayCase[] = [
  {
    id: "nov10-p14b-advice-asks-not-on-the-card",
    title: "P14(b): the Coaching card's Observation keeps her account, never \"how i do about her frusteration\" or \"tell me how what to say back\"",
    report: 'Pau via QA, 10 Nov 2026 (P14, conv 9 Nov ~16:05Z): the proposal pasted the manager\'s messages into Observation word for word',
    status: { open: "the card's Observation carries \"how i do about her frusteration\" and \"tell me how what to say back. send a messageto me\"" },
    fixFlags: ["ADVICE_ASK_NOT_ACCOUNT_ENABLED"],
    async run(t) {
      vi.setSystemTime(new Date("2026-11-09T16:05:00Z"));
      t.directory([...STAFF, WRENNA]);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      t.modelSays("This is a common pushback. If I were documenting this, it'd fit a **Coaching Form** — want me to start one?");
      await thread.say("i have a girl upset that i am coaching on how to updateclients checking accounts and they think that our job is to serve them and not update their info. how i do about her frusteration");
      t.modelSays("She's conflating three different things. Tell me which one you're seeing and I can help you document it.");
      await thread.say('she said "well our job isto serve clients, not update their account info. if they want that then they need to make them go in and do it themselves or just not let us allow people t tan until they get the app and updateit. she thinks EFTS shouldnt be mandotory');
      t.modelSays("Here's a direct way to say it back to her. If you want this written up, I can start a Coaching Form for her by name.");
      await thread.say("tell me how what to say back. send a messageto me");
      t.modelSays("Got it — Wrenna. Just say \"create a coaching form for Wrenna\".");
      await thread.say("thank you her name is Wrenna");
      t.modelSays(null);
      const ask = await thread.say("create a coaching form for wrenna");
      const card = /Is this for/i.test(ask.content) ? await thread.say("yes") : ask;
      expect(thread.proposal, `no Coaching card for Wrenna Oakhurst:\n${card.content}`).toMatchObject({ templateKey: "coaching", employeeName: "Wrenna Oakhurst" });
      const observation = card.content.split("\n").find((line) => /^\*\*Observation of Offense:\*\*/.test(line)) ?? "";
      expect(observation, `the card shows no account:\n${card.content}`).toMatch(/checking accounts/);
      expect(observation, "the manager's question to the app is on the card").not.toMatch(/how i do about her frusteration/i);
      expect(observation, "the manager's request to the app is on the card").not.toMatch(/tell me how what to say back|send a messageto me/i);
    },
  },
];
