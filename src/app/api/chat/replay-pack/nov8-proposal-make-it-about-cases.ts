import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayAnswer, type ReplayCase, type ReplayContext } from "./cases";

/**
 * ============================================================================
 * "MAKE IT ABOUT …" ON A PROPOSAL CARD WAS PUT ON THE CARD AS THE ACCOUNT (QA, 8 Nov 2026)
 * ============================================================================
 *
 * QA's Sunny flip-9 tester, item 9 (live, Sonnet 5, reproduced 2/2 on main with production's flags, with
 * EDIT_MAKE_IT_ABOUT on and off): on a Coaching proposal card (no draft yet), "I need you to make it about showing
 * up late and please list the policy make the date for 10/14/26." was read as more of what happened. The card's
 * Observation and the drafting model's notes at Create held the instruction word for word ("I need you to make it
 * about …"). sf-s34's fix (EDIT_MAKE_IT_ABOUT) is for an open draft; a proposal card is not Step B's.
 * PROPOSAL_MAKE_IT_ABOUT_ENABLED (`ai/make-it-about.ts`). The manager's words; the employee is invented.
 */

const MERIDA: DirectoryRow = {
  id: "e-merida-ashcombe-p9",
  firstName: "Merida",
  lastName: "Ashcombe",
  preferredFirstName: null,
  employmentStatus: "active",
  salonIds: ["loc-0309"],
  positionName: "Tanning Consultant",
};

const REQUEST = "create a coaching form for Merida Ashcombe, he missed the monthly meeting on 10/10/26";
const EDIT = "I need you to make it about showing up late and please list the policy make the date for 10/14/26.";
const INSTRUCTION = /make it about|I need you to|please list/i;
const FIX = ["PROPOSAL_MAKE_IT_ABOUT_ENABLED"];
const REPORT = "QA's Sunny flip-9 tester, item 9 (8 Nov 2026; live, reproduced on main with production's flags)";

function start(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-11-07T14:00:00Z"));
  t.directory([...STAFF, MERIDA]);
  t.as("salon_director", KEARNEY);
  return t.thread();
}

function observationLine(reply: ReplayAnswer): string {
  return reply.content.split("\n").find((line) => /\*\*Observation of Offense:?\*\*/i.test(line)) ?? "";
}

export const NOV8_PROPOSAL_MAKE_IT_ABOUT_CASES: ReplayCase[] = [
  {
    id: "nov8-proposal-make-it-about-card",
    title: "on a Coaching proposal card, \"I need you to make it about showing up late …\": the card's account is \"showing up late\", never the instruction",
    report: REPORT,
    status: { open: "the card's Observation of Offense is the request's account and the instruction, word for word" },
    fixFlags: FIX,
    async run(t) {
      const thread = start(t);
      await thread.say(REQUEST);
      expect(thread.proposal, "a Coaching card for Merida").toMatchObject({ templateKey: "coaching", employeeName: "Merida Ashcombe" });
      const reply = await thread.say(EDIT);
      expect(thread.proposal?.templateKey, "still the Coaching card").toBe("coaching");
      const line = observationLine(reply);
      expect(line, `no account on the card:\n${reply.content}`).toMatch(/showing up late/i);
      expect(line, "the instruction is on the card as the account").not.toMatch(INSTRUCTION);
      expect(line, "the account set aside is still on the card").not.toMatch(/monthly meeting/i);
      expect(reply.content, "the date asked for is on the card").toMatch(/\*\*Date:\*\*\s*10\/14\/2026/);
    },
  },
  {
    id: "nov8-proposal-make-it-about-create",
    title: "…then Create: the drafting model is told \"showing up late\", and the drafted Details never hold the instruction",
    report: REPORT,
    status: { open: "the drafting model's notes are both turns as typed, and the drafted Details read \"Observed: I need you to make it about …\"" },
    fixFlags: FIX,
    async run(t) {
      const thread = start(t);
      await thread.say(REQUEST);
      await thread.say(EDIT);
      const id = await thread.create();
      const described = t.draftPrompts().map((prompt) => (prompt.split("WHAT THE MANAGER DESCRIBED:")[1] ?? "").split("FIELDS YOU MAY WRITE:")[0] ?? "");
      expect(described.length, "a draft was written").toBeGreaterThan(0);
      for (const text of described) {
        expect(text, "the drafting model is told the instruction as what happened").not.toMatch(INSTRUCTION);
        expect(text, "the drafting model is not told what the form is about").toMatch(/showing up late/i);
      }
      const details = t.values(id).coaching_details ?? "";
      expect(details, "the drafted Details hold the instruction").not.toMatch(INSTRUCTION);
      expect(t.values(id).form_date, "the date asked for").toBe("2026-10-14");
    },
  },
  {
    id: "nov8-proposal-make-it-about-negative",
    title: "negative: a proposal card's follow-up account with no \"make it about\" is kept as before",
    report: `${REPORT} (the condition)`,
    status: "fixed",
    fixFlags: FIX,
    async run(t) {
      const thread = start(t);
      await thread.say(REQUEST);
      const reply = await thread.say("she also left her station early that day");
      expect(observationLine(reply), `the account lost words:\n${reply.content}`).toMatch(/monthly meeting/i);
    },
  },
];
