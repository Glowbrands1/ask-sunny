import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase } from "./cases";

/**
 * ============================================================================
 * "CREATE A TERMINATION FOR <A>" IS A CORRECTIVE ACTION REQUEST (TERMINATION_REQUEST_IS_CA_ENABLED)
 * ============================================================================
 *
 * QA, 15 Nov 2026: "create a termination for <A>, she no call no showed on 11/12" got a policy answer and no card.
 * With the flag it is a Corrective Action card for that person. "Termination" alone is still no form's name, the
 * termination paperwork is still the Exit form, and a question is still answered. Names are the pack's invented staff.
 */

const REPORT = "QA, 15 Nov 2026: \"create a termination for <A>, she no call no showed on 11/12\" gave a policy answer and no card";
const FLAG = "TERMINATION_REQUEST_IS_CA_ENABLED";

function start(t: Parameters<ReplayCase["run"]>[0]) {
  vi.setSystemTime(new Date("2026-11-14T16:00:00Z"));
  t.directory(STAFF);
  t.as("salon_director", KEARNEY);
}

export const NOV15_TERMINATION_REQUEST_IS_CA_CASES: ReplayCase[] = [
  ...[
    "create a termination for Marnie Holloway, she no call no showed on 11/12",
    "make a termination for marnie holloway, she no call no showed on 11/12",
    "I need to do a termination for Marnie Holloway, she no call no showed on 11/12",
  ].map(
    (said, index): ReplayCase => ({
      id: `nov15-termination-request-is-ca-${index + 1}`,
      title: `"${said}": a Corrective Action card for Marnie Holloway`,
      report: REPORT,
      status: { open: "a policy answer and no card" },
      fixFlags: [FLAG],
      async run(t) {
        start(t);
        const thread = t.thread();
        const reply = await thread.say(said, { employeeName: "Marnie Holloway" });
        expect(thread.proposal?.templateKey, reply.content).toBe("dpoa");
        expect(thread.proposal?.employeeName, reply.content).toBe("Marnie Holloway");
      },
    }),
  ),
  {
    id: "nov15-termination-request-is-ca-paperwork-is-exit",
    title: "\"create termination paperwork for Marnie Holloway\": still the Exit form, not a Corrective Action",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      start(t);
      const thread = t.thread();
      const reply = await thread.say("create termination paperwork for Marnie Holloway", { employeeName: "Marnie Holloway" });
      expect(thread.proposal?.templateKey ?? null, reply.content).not.toBe("dpoa");
    },
  },
  {
    id: "nov15-termination-request-is-ca-question",
    title: "\"should we do a termination for Marnie Holloway?\": a question, never a card",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      start(t);
      const thread = t.thread();
      const reply = await thread.say("should we do a termination for Marnie Holloway?", { employeeName: "Marnie Holloway" });
      expect(thread.proposal ?? null, reply.content).toBeNull();
    },
  },
];
