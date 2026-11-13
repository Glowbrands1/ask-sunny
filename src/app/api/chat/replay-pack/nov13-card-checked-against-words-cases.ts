import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase } from "./cases";

/**
 * ============================================================================
 * THE CARD, CHECKED AGAINST THE MANAGER'S WORDS (CARD_CHECKED_AGAINST_WORDS_ENABLED; Pau's direction via QA, 13 Nov 2026)
 * ============================================================================
 *
 * Ported from the sibling app. One general check on every card before it is shown
 * (`forms/card-checked-against-words.ts`). This app's cards carry no Issue (the sibling's live failures were all in its
 * Issue line), so here the check reads the person: a job title or a salon is never the person on the card. The guard:
 * a card that is already right is shown exactly as built, with no model call. The person is invented.
 */

export const NOV13_CARD_CHECKED_AGAINST_WORDS_CASES: ReplayCase[] = [
  {
    id: "nov13-card-checked-right-card-unchanged",
    title: "\"create a CA for Marnie Holloway, she was late on 11/3/26\": a card that is already right is shown as built, with no model call",
    report: "Pau's direction via QA, 13 Nov 2026: check the card against the manager's own words before showing it (guard)",
    status: "fixed",
    fixFlags: ["CARD_CHECKED_AGAINST_WORDS_ENABLED"],
    async run(t) {
      vi.setSystemTime(new Date("2026-11-13T16:00:00Z"));
      t.directory(STAFF);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      const reply = await thread.say("create a CA for Marnie Holloway, she was late on 11/3/26");
      expect(thread.proposal, reply.content).toMatchObject({ employeeName: "Marnie Holloway", status: "ready" });
      expect(reply.content).not.toMatch(/Who is this card for\?|What happened\?/);
      expect(t.cardCheckCalls?.() ?? 0).toBe(0);
    },
  },
  {
    id: "nov13-17rc-added-detail-kept-on-card",
    title: "the sibling app's 17r-c live test, ported: \"create a CA for Marnie Holloway, she was late on 11/3/26\", then \"she also didn't call to say she'd be late\" on the open card: the Observation of Offense keeps both facts, and the reply names the change",
    report: "Ported from the sibling app: QA's 17r-c live test, 13 Nov 2026 (the added detail lost, the reply repeating the whole draft). Here the Observation already keeps both facts; the reply never said what changed",
    // Changed on purpose (13 Nov 2026): fixed in production by CARD_CHECKED_AGAINST_WORDS, QA round 38f. Was OPEN.
    status: "fixed",
    fixFlags: ["CARD_CHECKED_AGAINST_WORDS_ENABLED"],
    async run(t) {
      vi.setSystemTime(new Date("2026-11-13T16:00:00Z"));
      t.directory(STAFF);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      await thread.say("create a CA for Marnie Holloway, she was late on 11/3/26");
      const reply = await thread.say("she also didn't call to say she'd be late");
      const observation = reply.content.split("\n").find((line) => line.startsWith("**Observation of Offense:**")) ?? "";
      expect(observation, `the Observation lost the first fact:\n${reply.content}`).toMatch(/late on 11\/3\/26/i);
      expect(observation, `the Observation lost the added detail:\n${reply.content}`).toMatch(/didn'?t call/i);
      expect(reply.content, `the reply does not name the change:\n${reply.content}`).toMatch(/\*\*Added to the Observation of Offense:\*\*[^\n]*didn'?t call/i);
    },
  },
  {
    id: "nov13-card-checked-name-answer-not-a-detail",
    title: "a CA card, then the answer \"Marnie Holloway, Tanning Consultant\": the name and title never join the card's account (Gate-Bubbles-5, S22's class)",
    report: "Gate-Bubbles-5 / Gate-Sunny-2, 13 Nov 2026: a name+title answer was joined to What happened with CARD_CHECKED on",
    status: "fixed",
    fixFlags: ["CARD_CHECKED_AGAINST_WORDS_ENABLED"],
    async run(t) {
      vi.setSystemTime(new Date("2026-11-13T16:00:00Z"));
      t.directory(STAFF);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      await thread.say("create a CA for Marnie Holloway, she was late on 11/3/26");
      const reply = await thread.say("Marnie Holloway, Tanning Consultant");
      expect(reply.content, `the name answer was added to the account:\n${reply.content}`).not.toMatch(/\*\*Added to [^\n]*Tanning/i);
      const issue = String((thread.proposal as Record<string, unknown> | null)?.issue ?? "");
      expect(issue, `the name answer joined the Issue:\n${reply.content}`).not.toMatch(/Tanning/i);
    },
  },
  {
    id: "nov13-card-checked-request-not-a-detail",
    title: "two forms in one message, then \"marnie holloway needs a written warning for cash handling\": a new request never joins the card's account (Gate-Bubbles-5, owner-retest's class)",
    report: "Gate-Bubbles-5 / Gate-Sunny-2, 13 Nov 2026: a request line was joined to the second card's Issue with CARD_CHECKED on",
    status: "fixed",
    fixFlags: ["CARD_CHECKED_AGAINST_WORDS_ENABLED"],
    async run(t) {
      vi.setSystemTime(new Date("2026-11-13T16:00:00Z"));
      t.directory(STAFF);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      await thread.say("coaching form for Remy Calder and a CA for Marnie Holloway");
      const reply = await thread.say("marnie holloway needs a written warning for cash handling");
      expect(reply.content, `the request was added to the account:\n${reply.content}`).not.toMatch(/\*\*Added to [^\n]*needs a written warning/i);
      const issue = String((thread.proposal as Record<string, unknown> | null)?.issue ?? "");
      expect(issue, `the request joined the Issue:\n${reply.content}`).not.toMatch(/needs a written warning/i);
    },
  },
  {
    id: "nov13-card-checked-payroll-amount-not-a-detail",
    title: "a CA card for a late opening, then \"she owes $25 for the late opening\": a payroll amount is never added to the account (Gate-Sunny-2)",
    report: "Gate-Sunny-2, 13 Nov 2026: \"she owes $25 for the late opening\" joined as \"Added to the Observation of Offense\" with CARD_CHECKED on",
    status: "fixed",
    fixFlags: ["CARD_CHECKED_AGAINST_WORDS_ENABLED"],
    async run(t) {
      vi.setSystemTime(new Date("2026-11-13T16:00:00Z"));
      t.directory(STAFF);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      await thread.say("create a CA for Marnie Holloway, she was late to open on 11/3/26");
      const reply = await thread.say("she owes $25 for the late opening");
      expect(reply.content, `the payroll amount was added to the account:\n${reply.content}`).not.toMatch(/\*\*Added to [^\n]*owes/i);
      const issue = String((thread.proposal as Record<string, unknown> | null)?.issue ?? "");
      expect(issue, `the payroll amount joined the Issue:\n${reply.content}`).not.toMatch(/owes \$25/i);
    },
  },
];
