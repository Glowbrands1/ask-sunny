import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext, type ReplayThread } from "./cases";

/**
 * Ported from Ask Bubbles: QA's Bubbles 17i live test (11 Nov 2026), the manager's turns as typed (the employee invented,
 * on the pack's roster). Both reproduce here with production's flags:
 *   - "can you make a CA for <C> for wearing a hoodie to work?" — a Corrective Action card with no Policy line, its Action
 *     Plan on "the applicable company policy" (WORN_CLOTHING_IS_DRESS_CODE_ENABLED);
 *   - "Do i need to copy and paste it?" — answered as if there were no card, with a form menu under it
 *     (COPY_PASTE_POINTS_TO_CARD_ENABLED).
 */
const REPORT = "QA's Bubbles 17i live test, 11 Nov 2026 (ported from Ask Bubbles; reproduced here)";

/** The manual's Dress Code section, as `nov10-not-following-dress-code-cases.ts` has it. */
const DRESS_CODE_CHUNK = {
  chunkIndex: 44,
  chunkId: "jba-44",
  locator: "Page 15 — Dress Code for The Company",
  page: 16,
  content:
    "Dress Code for The Company\nThe Company Employees are to keep a neat, clean, professional appearance at all times. Anyone\nviolating their Brand’s Dress code policy will be sent home to change into proper work attire.",
  section: "Dress Code for The Company",
  printedPage: 15,
  sections: [
    { heading: "Dress Code for The Company", page: 15 },
    { heading: "All Locations Dress Code", page: 15 },
  ],
};

const TURN_2 = "can you make a CA for Marnie Holloway for wearing a hoodie to work?";
const TURN_3 = "Do i need to copy and paste it?";

function start(t: ReplayContext): ReplayThread {
  vi.setSystemTime(new Date("2026-11-11T23:37:00Z"));
  t.directory(STAFF);
  t.as("salon_director", KEARNEY);
  t.manualAlsoHas?.([DRESS_CODE_CHUNK]);
  return t.thread();
}

export const NOV11_17I_LIVE_PORT_CASES: ReplayCase[] = [
  {
    id: "nov11-17i-hoodie-ca-dress-code",
    title: "\"can you make a CA for <C> for wearing a hoodie to work?\": the card's Policy is the Dress Code",
    report: REPORT,
    status: { open: "the card has no Policy line; the plan says \"the applicable company policy\"" },
    fixFlags: ["WORN_CLOTHING_IS_DRESS_CODE_ENABLED"],
    async run(t) {
      const reply = await start(t).say(TURN_2);
      expect(reply.content, reply.content).toMatch(/\*\*Policy:\*\* Dress Code/);
      expect(reply.content, reply.content).not.toMatch(/review the applicable company policy/);
    },
  },
  {
    id: "nov11-17i-copy-paste-points-to-card",
    title: "\"Do i need to copy and paste it?\" with the card on screen: the reply points to the card's Create draft",
    report: REPORT,
    status: { open: "the reply answers as if there were no card, with a form menu under it" },
    fixFlags: ["COPY_PASTE_POINTS_TO_CARD_ENABLED"],
    async run(t) {
      const thread = start(t);
      await thread.say(TURN_2);
      expect(thread.proposal, "no Corrective Action card for Marnie Holloway").toMatchObject({ templateKey: "dpoa", employeeName: "Marnie Holloway" });
      const reply = await thread.say(TURN_3);
      expect(reply.content, reply.content).toMatch(/Create draft/);
      expect(reply.content, reply.content).not.toMatch(/form card will appear|one of the forms below/i);
      expect(reply.formProposal, "the card is no longer on the reply").toMatchObject({ templateKey: "dpoa", employeeName: "Marnie Holloway" });
    },
  },
];
