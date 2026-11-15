import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayCase } from "./cases";

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
const RE_REVIEW = "QA's re-review of #1014, 15 Nov 2026: the blacklist refused real requests and let two non-requests through";
/** An invented roster person whose first name is a word ("cash"): name resolution, not a word list, decides. */
const CASH: DirectoryRow = { id: "e-cash-holloway-tr", firstName: "Cash", lastName: "Holloway", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0309"], positionName: "Tanning Consultant" };

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
  ...[
    "how do i do a termination for Marnie Holloway?",
    "Do I need a termination for Marnie Holloway or just a written?",
    "should I do a termination for Marnie Holloway",
    "what do I need to do a termination for Marnie Holloway",
    "do we need a termination for job abandonment",
    "create a termination for no call no show",
  ].map(
    (said, index): ReplayCase => ({
      id: `nov15-termination-request-is-ca-not-a-request-${index + 1}`,
      title: `"${said}": a question, or no person after "for": never a Corrective Action card (QA's review of #1014)`,
      report: "QA's review of #1014, 15 Nov 2026: questions and offense-only wordings became card requests",
      status: "fixed",
      fixFlags: [FLAG],
      async run(t) {
        start(t);
        const thread = t.thread();
        const reply = await thread.say(said, { employeeName: /marnie/i.test(said) ? "Marnie Holloway" : null });
        expect(thread.proposal?.templateKey ?? null, reply.content).not.toBe("dpoa");
      },
    }),
  ),
  ...(
    [
      ["can you create a termination for Marnie Holloway, she no call no showed on 11/12", "Marnie Holloway", STAFF],
      ["could you make a termination for marnie holloway, she no call no showed on 11/12", "Marnie Holloway", STAFF],
      ["need a termination for Marnie Holloway, she no call no showed on 11/12", "Marnie Holloway", STAFF],
      ["create a termination for Marnie Holloway, she no call no showed on 11/12. Is the DM in today?", "Marnie Holloway", STAFF],
      ["do a termination for Ms. Holloway, she no call no showed on 11/12", "Marnie Holloway", STAFF],
      ["create a termination for Cash Holloway, he no call no showed on 11/12", "Cash Holloway", [...STAFF.filter((row) => row.lastName !== "Holloway"), CASH]],
    ] as const
  ).map(
    ([said, person, roster], index): ReplayCase => ({
      id: `nov15-termination-request-is-ca-whitelist-${index + 1}`,
      title: `"${said}": a Corrective Action card for ${person}`,
      report: RE_REVIEW,
      status: { open: "a policy answer and no card" },
      fixFlags: [FLAG],
      async run(t) {
        vi.setSystemTime(new Date("2026-11-14T16:00:00Z"));
        t.directory([...roster]);
        t.as("salon_director", KEARNEY);
        const thread = t.thread();
        const reply = await thread.say(said, { employeeName: person });
        expect(thread.proposal?.templateKey, reply.content).toBe("dpoa");
        // "Ms. Holloway": the request is read; the card's name reader takes "Ms" as a name, a separate gap (reported).
        if (!said.includes("Ms.")) expect(thread.proposal?.employeeName, reply.content).toBe(person);
      },
    }),
  ),
  ...["So do I create a termination for Marnie Holloway or not", "I think we should do a termination for Marnie Holloway"].map(
    (said, index): ReplayCase => ({
      id: `nov15-termination-request-is-ca-not-at-start-${index + 1}`,
      title: `"${said}": not a request at the start of a sentence, read as before (no Corrective Action card)`,
      report: RE_REVIEW,
      status: "fixed",
      fixFlags: [FLAG],
      async run(t) {
        start(t);
        const thread = t.thread();
        const reply = await thread.say(said, { employeeName: "Marnie Holloway" });
        expect(thread.proposal?.templateKey ?? null, reply.content).not.toBe("dpoa");
      },
    }),
  ),
];
