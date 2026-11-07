import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";

/**
 * A1 (port from the sibling app, where the flip-3 tester found it; QA 6 Nov 2026; the same statedIn here): after "take the attendance policy off the
 * form", the reply ADDED "**Policy:** Attendance, as you said. I'll quote that section …". A sentence that
 * removes a policy does not name it as the one to cite. The person is the pack's invented Marnie Holloway.
 */
const SAID = "take the attendance policy off the form";
const AS_YOU_SAID = /\*\*Policy:\*\*\s*Attendance[^\n]*as you said/i;
// Here the card's "Attendance, as you said" also comes from the app's own "Policy reference" line read as the
// manager's words; ask-sunny #588 (AS_YOU_SAID_MANAGER_WORDS_ENABLED) keeps that out, so both are on.
const FIX = ["REMOVE_POLICY_NOT_NAMED_ENABLED", "AS_YOU_SAID_MANAGER_WORDS_ENABLED"];
const REPORT = "QA, 6 Nov 2026 (A1, the flip-3 tester): \"take the attendance policy off the form\" read as naming Attendance";

function start(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-11-06T15:00:00Z"));
  t.directory(STAFF);
  t.as("salon_director", KEARNEY);
  return t.thread();
}

export const NOV7_REMOVE_POLICY_NOT_NAMED_CASES: ReplayCase[] = [
  {
    id: "nov7-a1-remove-policy-card",
    title: "A1 at the card: \"take the attendance policy off the form\" never gets \"Attendance, as you said\"",
    report: REPORT,
    status: { open: "the card adds \"**Policy:** Attendance, as you said\" after the removal" },
    fixFlags: FIX,
    async run(t) {
      const thread = start(t);
      await thread.say("corrective action");
      await thread.say("marnie holloway");
      await thread.say("marnie was 30 minutes late to her shift on 10/31");
      const reply = await thread.say(SAID);
      expect(reply.content, `the removal is read as naming the policy:\n${reply.content}`).not.toMatch(AS_YOU_SAID);
    },
  },
  {
    id: "nov7-a1-remove-policy-created",
    title: "A1 on a created form: \"take the attendance policy off the form\" never gets \"Attendance, as you said\"",
    report: REPORT,
    // A guard: on a created form the removal already holds (it is a policy change, not a card reading).
    status: "fixed",
    fixFlags: FIX,
    async run(t) {
      const thread = start(t);
      await thread.say("corrective action");
      await thread.say("marnie holloway");
      await thread.say("marnie was 30 minutes late to her shift on 10/31");
      t.draftWrites({});
      await thread.create();
      await thread.say("add the attendance policy");
      const reply = await thread.say(SAID);
      expect(reply.content, `the removal is read as naming the policy:\n${reply.content}`).not.toMatch(AS_YOU_SAID);
    },
  },
];
