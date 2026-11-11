import { expect } from "vitest";

import { KEARNEY, STAFF, type ReplayCase } from "./cases";

const WITH_TESTY = [
  ...STAFF,
  { id: "e-testy", firstName: "Testy", lastName: "Testerson", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0309"], positionName: "Tanning Consultant" },
];

/** The replay eval's b10 (QA, 3 Nov 2026): a card shown again that asks nothing. Turns verbatim; the person is the test fixture's. */
export const NOV3_SAME_ASK_CASES: readonly ReplayCase[] = [
  {
    id: "nov3-same-ask-b10",
    title: "a card shown again that asks nothing never says \"I still need …\"",
    report: 'eval b10 with SAME_ASK_NO_REPEAT on: "I still need the same answer before I can make this card." on a card that asked nothing (QA, 3 Nov 2026)',
    status: "fixed",
    fixFlags: ["SAME_ASK_NO_REPEAT_ENABLED"],
    async run(t) {
      t.directory(WITH_TESTY);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      let last = "";
      for (const turn of [
        "create a verbal CA for team member Testy Testerson at Dodge, NE. location. On 10-16-26 Testy was not properly measuring and weighing product. payroll deduct is not applicable",
        "employee name is Testy Testerson",
        "cite standards of conduct as policy violated",
        "show draft",
        "violation is that on 10-16-26 Testy was not measuring and weighing product",
        "show draft with edits",
      ]) {
        last = (await thread.say(turn)).content;
      }
      // The harness checks every reply; this case is the path that tripped it.
      expect(last).not.toMatch(/^I still need the same answer/m);
    },
  },
];
