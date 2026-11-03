import { expect } from "vitest";

import { KEARNEY, STAFF, type ReplayCase } from "./cases";

const WITH_DATE_NAMES = [
  ...STAFF,
  { id: "e-jane", firstName: "Jane", lastName: "Doe", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0309"], positionName: "Tanning Consultant" },
  { id: "e-corin", firstName: "Corin", lastName: "Bellweather", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0309"], positionName: "Tanning Consultant" },
];

/**
 * QA, 3 Nov 2026 (15:22 UTC): ADDRESS_NOT_PERSON read the year of a date as a
 * house number — "On 10-20-26 Jane Doe" became the address "26 Jane Doe". The
 * tester sessions' exact wording; the people are invented. A number the date
 * reader reads as part of a date is not a house number.
 */
export const NOV3_ADDRESS_DATE_CASES: readonly ReplayCase[] = [
  {
    id: "nov3-date-then-name",
    title: "\"On 10-20-26 Jane Doe was late to open\": Jane Doe is a person, not a street address",
    report: '"On 10-20-26 Jane Doe was late to open" → "Jane Doe" reads as a street address, not a person (QA live check)',
    status: "fixed",
    fixFlags: ["ADDRESS_NOT_PERSON_ENABLED"],
    async run(t) {
      t.directory(WITH_DATE_NAMES);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      // The tester's sentence on its own makes no card here; it came as the details for a form already asked for.
      await thread.say("I need a coaching form");
      const reply = await thread.say("On 10-20-26 Jane Doe was late to open");
      expect(reply.content).not.toMatch(/street address/i);
      expect(String(reply.formProposal?.employeeName ?? thread.proposal?.employeeName ?? "")).toBe("Jane Doe");
    },
  },
  {
    id: "nov3-slashed-date-then-name",
    title: "\"on Monday 10/05/2026 corin bellweather was working …\": a person, not a street address",
    report:
      '"Put together a written CA for corin bellweather, primary salon is Manhattan. But on Monday 10/05/2026 corin bellweather was working a shift at Lawrence …" → read as a street address (QA live check)',
    status: "fixed",
    fixFlags: ["ADDRESS_NOT_PERSON_ENABLED"],
    async run(t) {
      t.directory(WITH_DATE_NAMES);
      t.as("salon_director", KEARNEY);
      const reply = await t
        .thread()
        .say(
          "Put together a written CA for corin bellweather, primary salon is Manhattan. But on Monday 10/05/2026 corin bellweather was working a shift at Lawrence and did not complete the 10 minute disinfect",
        );
      expect(reply.content).not.toMatch(/street address/i);
      expect(String(reply.formProposal?.employeeName ?? "Corin Bellweather")).toMatch(/corin bellweather/i);
    },
  },
  {
    id: "nov3-name-then-date",
    title: "\"Create a CA for Jane Doe, she was late on 10-20-26\": the name keeps its card",
    report: "QA, 3 Nov 2026: guard — the date after the name never made it an address",
    status: "fixed",
    fixFlags: ["ADDRESS_NOT_PERSON_ENABLED"],
    async run(t) {
      t.directory(WITH_DATE_NAMES);
      t.as("salon_director", KEARNEY);
      const reply = await t.thread().say("Create a CA for Jane Doe, she was late on 10-20-26");
      expect(reply.content).not.toMatch(/street address/i);
      expect(reply.formProposal?.employeeName).toBe("Jane Doe");
    },
  },
];
