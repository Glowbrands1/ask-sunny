import { expect } from "vitest";

import { KEARNEY, STAFF, type ReplayCase } from "./cases";

/** QA's live check, 3 Nov 2026 (10:55 UTC). The tester's words; "<name>" as typed. */
export const NOV3_STREET_NAME_CASES: readonly ReplayCase[] = [
  {
    id: "nov3-street-address-coaching",
    title: "\"coaching form for 123 Main Street\" is not a form for a person called Main Street",
    report: '"coaching form for 123 Main Street" → a Coaching card for Employee "Main Street", no "who is this for?" (QA live check)',
    // Open again: QA rolled ADDRESS_NOT_PERSON back to 0 in production (3 Nov 2026, ~15:05 UTC) because it
    // refused real names after a date ("On 10-20-26 Jane Doe was late", "on 10/05/2026 <name> was working").
    status: { open: "ADDRESS_NOT_PERSON is off in production (rolled back: a date's digits before a name read as a house number)" },
    fixFlags: ["ADDRESS_NOT_PERSON_ENABLED"],
    async run(t) {
      t.directory(STAFF);
      t.as("salon_director", KEARNEY);
      const reply = await t.thread().say("coaching form for 123 Main Street");
      expect(String(reply.formProposal?.employeeName ?? "")).not.toMatch(/main|street/i);
    },
  },
  {
    id: "nov3-street-then-placeholder",
    title: "the next request names no one: the earlier non-person is not kept, and \"<name>\" is not a name",
    report: 'then "make a coaching form for <name>, she was late today" kept Employee "Main Street" and did not ask who (QA live check)',
    // Open again: QA rolled ADDRESS_NOT_PERSON back to 0 in production (3 Nov 2026, ~15:05 UTC) because it
    // refused real names after a date ("On 10-20-26 Jane Doe was late", "on 10/05/2026 <name> was working").
    status: { open: "ADDRESS_NOT_PERSON is off in production (rolled back: a date's digits before a name read as a house number)" },
    fixFlags: ["ADDRESS_NOT_PERSON_ENABLED"],
    async run(t) {
      t.directory(STAFF);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      await thread.say("coaching form for 123 Main Street");
      const reply = await thread.say("make a coaching form for <name>, she was late today");
      expect(String(reply.formProposal?.employeeName ?? "")).not.toMatch(/main|street|name/i);
      expect(reply.formProposal?.status ?? "needs_employee").toBe("needs_employee");
    },
  },
];
