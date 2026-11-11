import { expect } from "vitest";

import { STAFF, type ReplayCase } from "./cases";

/**
 * ============================================================================
 * SUNNY ROUND 22 LIVE TEST (QA, 11 Nov 2026; dpl_4Jtpc6cy, main c1385e45) — the tester's account covers every salon
 * ============================================================================
 *
 * (1) "create a CA for <full name on nobody's roster>, he was late on 11/3/26" made a card for the typed name with no
 *     confirm and no "use <name>" offer. Cause: the off-roster ask holds back a salon-scoped manager only (round 12's
 *     rule, kept by QA's ruling of 10 Nov 2026, `off-roster-ask.ts`, `roster-only-names.ts`). OPEN pending QA's ruling.
 * (2) "create a CA for ima employee" rightly made no card, but the reply said "for the the employee" twice and "You can
 *     create it now" with no Create button. The slot model reads the employee as "ima employee" (as live). Fixed by
 *     NO_NAME_REPLY_WORDING_ENABLED. The off-roster person is invented.
 */
const EVERY_SALON = { level: "global", primaryAreaId: null, alsoCoversAreaIds: [] };
const REPORT = "Sunny round 22 live test (QA, 11 Nov 2026), an account covering every salon";
const LATE = "create a CA for Thaddeus Wrenfield, he was late on 11/3/26";
const IMA = "create a CA for ima employee";

export const NOV11_R22_LIVE_NO_NAME_CASES: ReplayCase[] = [
  {
    id: "nov11-r22-live-off-roster-every-salon-asked",
    title: `"${LATE}" (every salon): asked about the name, never a silent card for it`,
    report: `${REPORT} (1)`,
    status: { open: "a manager who is not salon-scoped keeps the typed name on the card (round 12's rule; QA ruling pending)" },
    async run(t) {
      t.directory(STAFF);
      t.as("admin", EVERY_SALON as never);
      const thread = t.thread();
      const reply = await thread.say(LATE);
      expect(reply.content, reply.content).not.toMatch(/I'll draft a \*\*Corrective Action Form\*\* for \*\*Thaddeus Wrenfield\*\*/);
      expect(reply.content, reply.content).toMatch(/use Thaddeus Wrenfield/i);
    },
  },
  {
    id: "nov11-r22-live-ima-employee-no-doubled-the",
    title: `"${IMA}" (every salon): no card, never "the the employee", never "You can create it now"`,
    report: `${REPORT} (2)`,
    status: { open: "\"for the the employee\" twice, and \"You can create it now\" with no Create button" },
    fixFlags: ["NO_NAME_REPLY_WORDING_ENABLED"],
    async run(t) {
      t.directory(STAFF);
      t.as("admin", EVERY_SALON as never);
      t.slotsRead({ employee: "ima employee", formType: "Corrective Action Form", formTurn: true });
      const thread = t.thread();
      const reply = await thread.say(IMA);
      expect(thread.proposal?.employeeName ?? null, "no card for the words").toBeNull();
      expect(reply.content, reply.content).not.toMatch(/\bthe the\b/i);
      expect(reply.content, reply.content).not.toMatch(/You can create it now/);
      expect(reply.content, reply.content).toMatch(/the employee/);
    },
  },
];
