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
  /*
   * QA live check, 16:27 UTC, with ADDRESS_NOT_PERSON on: the sentence below
   * gave "Who is this Corrective Action Form for?" with no employee. The same
   * reply comes with the flag OFF through this route, and the address guard's
   * own reply always names the street address, so it is not the guard: the
   * name is a lower-case name that is not on the roster, and nothing reads it.
   */
  {
    id: "nov3-lowercase-name-not-an-address",
    title: "\"… on Monday 10/05/2026 corin bellweather …\" after a role: the address guard never calls it a street address",
    report:
      '"Corrective action for the primary salon manager: on Monday 10/05/2026 corin bellweather was working a shift at the front desk and was rude to a guest" (QA live check, 16:27 UTC)',
    status: "fixed",
    fixFlags: ["ADDRESS_NOT_PERSON_ENABLED"],
    async run(t) {
      t.directory(STAFF);
      t.as("salon_director", KEARNEY);
      const reply = await t
        .thread()
        .say(
          "Corrective action for the primary salon manager: on Monday 10/05/2026 corin bellweather was working a shift at the front desk and was rude to a guest",
        );
      expect(reply.content).not.toMatch(/street address/i);
    },
  },
  {
    id: "nov3-lowercase-name-off-roster",
    title: "a lower-case name that is not on the roster, after a role and a date, goes on the card",
    report:
      '"Corrective action for the primary salon manager: on Monday 10/05/2026 corin bellweather was working a shift at the front desk and was rude to a guest" → "Who is this Corrective Action Form for?", Employee "Not yet" (QA live check, 16:27 UTC; same with ADDRESS_NOT_PERSON off)',
    // Open until SLOT_NAME_ON_FORM_REQUEST is on. The slot reading held the name (production trace), but with
    // FORM_STATE off in production it was not put in front of the question, and the proposal reads capitalised
    // names only.
    status: { open: "SLOT_NAME_ON_FORM_REQUEST is off: a lower-case name the slot reading holds does not reach the card" },
    fixFlags: ["SLOT_NAME_ON_FORM_REQUEST_ENABLED"],
    async run(t) {
      t.directory(STAFF);
      // What the live models read for this turn (production trace, 16:24 UTC): the slot model, the name in lower
      // case, the lead-in as a job title, not a form turn; the AI reader quoted the same name (rejected: off the roster).
      t.slotsRead({ employee: "corin bellweather", title: "primary salon manager", formTurn: false }, "corin bellweather");
      t.as("salon_director", KEARNEY);
      const reply = await t
        .thread()
        .say(
          "Corrective action for the primary salon manager: on Monday 10/05/2026 corin bellweather was working a shift at the front desk and was rude to a guest",
        );
      expect(reply.formProposal?.employeeName).toBe("Corin Bellweather");
    },
  },
];
