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
const TICKS = "TERMINATION_STATED_TICKS_ENABLED";
const APPROVAL = "Termination needs your DM/HR approval before you finalize.";
const ROUND_3 = "QA's round 3 on #1014, 15 Nov 2026: nothing ticked Termination; off-roster full names never worked in production; a question in a later clause or sentence still made a card; a first name or a shared surname got no answer";
/** Two invented people who share a surname, for the \"Ms. Fairweather\" ask. */
const FAIRWEATHERS: DirectoryRow[] = [
  { id: "e-fw-opal", firstName: "Opal", lastName: "Fairweather", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0309"], positionName: "Tanning Consultant" },
  { id: "e-fw-cyrus", firstName: "Cyrus", lastName: "Fairweather", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0309"], positionName: "Tanning Consultant" },
];
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
      fixFlags: [FLAG, TICKS],
      async run(t) {
        start(t);
        const thread = t.thread();
        const reply = await thread.say(said, { employeeName: "Marnie Holloway" });
        expect(thread.proposal?.templateKey, reply.content).toBe("dpoa");
        expect(thread.proposal?.employeeName, reply.content).toBe("Marnie Holloway");
        // QA round 3: the request IS the stated termination: the level, the approval line, and Create ticks it.
        expect(reply.content, "the card does not say Termination").toMatch(/\*\*Type of Warning:\*\* Termination, as you said/);
        expect(reply.content.split(APPROVAL).length - 1, "the approval line, exactly once").toBe(1);
        expect(reply.content, "the card still leaves the level to the manager").not.toMatch(/verbal\/written warning level/);
        const id = await thread.create();
        expect(t.checked(id).warning_type ?? [], "Create did not tick Termination").toEqual(["termination"]);
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
    // QA round 3: a question in ANY clause or sentence, and a dot inside a date ends nothing.
    "create a termination for Marnie Holloway, she no call no showed on 11.12, is that enough?",
    "create a termination for Marnie Holloway. Is that enough?",
    "create a termination for Marnie Holloway, she no call no showed on 11/12. is that enough to terminate?",
    "create a termination for Marnie Holloway, she no call no showed on 11/12. Is the DM in today?",
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
        // QA's second re-review: the title is stripped, so "Ms. Holloway" is Holloway and never "Ms" (no "couldn't find **Ms**").
        expect(reply.content, "a title was read as the name").not.toMatch(/\*\*(?:Ms|Mr|Mrs|Mx|Dr)\*\*/);
        if (!/\b(?:Ms|Mr|Mrs|Mx|Dr)\./.test(said)) expect(thread.proposal?.employeeName, reply.content).toBe(person);
        // A title and a surname: the card is made and the app either seats the roster person or asks who; it never says it could not find the title.
        else expect([person, null], reply.content).toContain(thread.proposal?.employeeName ?? null);
      },
    }),
  ),
  ...["create a termination form for Marnie Holloway", "do a termination form for Marnie Holloway, she no call no showed on 11/12"].map(
    (said, index): ReplayCase => ({
      id: `nov15-termination-request-is-ca-form-is-exit-${index + 1}`,
      title: `"${said}": "form" is not in the whitelist, so it stays the Exit form as on main (QA's second re-review): never a Corrective Action card`,
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
  {
    id: "nov15-termination-request-is-ca-off-roster-full-name",
    title: "\"create a termination for Zebulon Marchbanks\" (off the roster, typed in capitals): a card or an ask about him, never a policy answer",
    report: ROUND_3,
    status: { open: "the router lower-cased the text before the capitals check, so an off-roster full name never passed" },
    fixFlags: [FLAG, TICKS],
    async run(t) {
      start(t);
      const thread = t.thread();
      const reply = await thread.say("create a termination for Zebulon Marchbanks, he no call no showed on 11/12", { employeeName: null });
      expect(thread.proposal?.templateKey === "dpoa" || /Zebulon/.test(reply.content), `a policy answer or nothing:\n${reply.content}`).toBe(true);
    },
  },
  {
    id: "nov15-termination-request-is-ca-first-name-only",
    title: "\"create a termination for Marnie\": a card that seats Marnie Holloway or asks who, never a policy answer",
    report: ROUND_3,
    status: { open: "a first name alone resolved to no name, so the request fell through to a policy answer" },
    fixFlags: [FLAG, TICKS],
    async run(t) {
      start(t);
      const thread = t.thread();
      const reply = await thread.say("create a termination for Marnie", { employeeName: null });
      // The app confirms the one Marnie on the roster ("Is this for **Marnie Holloway**?") or opens the card; it never goes quiet.
      expect(thread.proposal?.templateKey === "dpoa" || /Is this for \*\*Marnie Holloway\*\*/.test(reply.content), reply.content).toBe(true);
    },
  },
  {
    id: "nov15-termination-request-is-ca-shared-surname-asks-who",
    title: "\"create a termination for Ms. Fairweather\" with two Fairweathers: the card asks who, never a policy answer",
    report: ROUND_3,
    status: { open: "a surname two people share did not resolve, so the request fell through to a policy answer" },
    fixFlags: [FLAG, TICKS],
    async run(t) {
      vi.setSystemTime(new Date("2026-11-14T16:00:00Z"));
      t.directory([...STAFF, ...FAIRWEATHERS]);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      const reply = await thread.say("create a termination for Ms. Fairweather, she no call no showed on 11/12", { employeeName: null });
      expect(thread.proposal?.templateKey, reply.content).toBe("dpoa");
      expect(thread.proposal?.employeeName ?? null, "picked one of two people for the manager").toBeNull();
      expect(reply.content, "a title was read as the name").not.toMatch(/\*\*(?:Ms|Mr|Mrs|Mx|Dr)\*\*/);
    },
  },
];
