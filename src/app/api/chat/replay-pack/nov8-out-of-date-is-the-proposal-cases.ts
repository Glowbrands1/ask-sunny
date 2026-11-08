import { expect, vi } from "vitest";

import { STAFF, KEARNEY, type DirectoryRow, type ReplayCase } from "./cases";

/**
 * ============================================================================
 * "WHAT DOES OUT OF DATE MEAN" AFTER A CARD IS ABOUT THE PROPOSAL (QA round 5, sf-s38; production, 7 Nov 2026)
 * ============================================================================
 *
 * The manager's words (the employee invented): a CA request, the same again, "create it", then "what does out of date
 * mean" (Create had answered "This proposal is out of date: …"). The turn went to the knowledge answer; live it replied
 * about tanning-bed schematics with a "[S1]-" left in. OUT_OF_DATE_IS_THE_PROPOSAL_ENABLED
 * (`ai/out-of-date-is-the-proposal.ts`): the answer is about the card, no retrieval, no source tag, the card kept.
 */
const RHEA: DirectoryRow = {
  id: "e-rhea-calloway-s38-ood",
  firstName: "Rhea",
  lastName: "Calloway",
  preferredFirstName: null,
  employmentStatus: "active",
  salonIds: ["loc-0309"],
  positionName: "Tanning Consultant",
};
const T1 =
  "make me an CA for Rhea Calloway missing her saturday and sunday shifts due to wanting to go home for the weekend but failed to communicate proporley";

export const NOV8_OUT_OF_DATE_IS_THE_PROPOSAL_CASES: ReplayCase[] = [
  {
    id: "nov8-s38-what-does-out-of-date-mean",
    title: "\"what does out of date mean\" after a CA card: answered about the proposal, never from the knowledge base",
    report: "QA round 5, sf-s38 (production chat f5e4e29a, 7 Nov 2026)",
    status: { open: "the turn goes to the knowledge answer" },
    fixFlags: ["OUT_OF_DATE_IS_THE_PROPOSAL_ENABLED"],
    async run(t) {
      vi.setSystemTime(new Date("2026-11-07T16:14:00Z"));
      t.directory([...STAFF, RHEA]);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      await thread.say(T1);
      await thread.say(T1);
      await thread.say("create it");
      const reply = await thread.say("what does out of date mean");
      expect(reply.content, `not about the proposal:\n${reply.content}`).toMatch(/Which part of the proposal looks out of date\?/);
      expect(reply.content, `a knowledge answer:\n${reply.content}`).not.toMatch(/grounded answer|knowledge base|schematic/i);
      expect(reply.content, `a source tag reached the reply:\n${reply.content}`).not.toMatch(/\[\s*S\d/i);
      expect(thread.proposal, `the card was dropped:\n${reply.content}`).toMatchObject({ templateKey: "dpoa" });
    },
  },
];
