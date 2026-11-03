import { expect } from "vitest";

import { KEARNEY, STAFF, type ReplayCase } from "./cases";

/** The 2 Nov scan's "read as a person" reports (P6, P7), and the rule that a roster person is never blocked. */
export const NOV2_PERSON_CASES: readonly ReplayCase[] = [
  {
    id: "nov2-p6-must-see-behaviors",
    title: "\"CA for must see behaviors\" is not a form for a person called Must See Behaviors",
    report: "\"In 'CA for must see behaviors,' the bot read 'Must' as a name.\"",
    status: { open: "every name reader takes \"must see behaviors\" for a person" },
    fixFlags: ["PERSON_GUARD_ENABLED"],
    async run(t) {
      t.directory(STAFF);
      t.as("salon_director", KEARNEY);
      const reply = await t.thread().say("can you create a CA for must see behaviors");
      expect(String(reply.formProposal?.employeeName ?? "")).not.toMatch(/must|behavior/i);
    },
  },
  {
    id: "nov2-p7-practice",
    title: "\"a mock coaching form for practice\" is not a form for a person called Practice",
    report: "\"'Practice' was saved as an employee name on a practice coaching form.\"",
    status: { open: "every name reader takes \"practice\" for a person" },
    fixFlags: ["PERSON_GUARD_ENABLED"],
    async run(t) {
      t.directory(STAFF);
      t.as("salon_director", KEARNEY);
      const reply = await t.thread().say("Give me a mock coaching form for practice");
      expect(String(reply.formProposal?.employeeName ?? "")).not.toMatch(/practice/i);
    },
  },
  {
    id: "person-guard-roster-wins",
    title: "somebody on the roster named like a listed word is still that person",
    report: "QA, 3 Nov 2026: the roster rule must hold for a real-looking name that equals a listed word",
    status: "fixed",
    fixFlags: ["PERSON_GUARD_ENABLED"],
    async run(t) {
      t.directory([
        ...STAFF,
        { id: "e-8", firstName: "Mark", lastName: "Practice", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0309"], positionName: "Tanning Consultant" },
        { id: "e-9", firstName: "Grace", lastName: "Behaviors", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0309"], positionName: "Tanning Consultant" },
      ]);
      t.as("salon_director", KEARNEY);
      const mark = await t.thread().say("coaching form for Mark Practice, he was late today");
      expect(mark.formProposal?.employeeName).toBe("Mark Practice");
      const grace = await t.thread().say("CA for Grace Behaviors, she was late today");
      expect(grace.formProposal?.employeeName).toBe("Grace Behaviors");
    },
  },
];
