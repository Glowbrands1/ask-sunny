import { expect } from "vitest";

import { KEARNEY, STAFF, type ReplayAnswer, type ReplayCase } from "./cases";

/**
 * SECOND_REQUEST_OWN_ACCOUNT_ENABLED with CARD_POLICY_OWN_REQUEST_ENABLED (QA, round 5, 8 Nov 2026; coding 2's note on
 * the one server-ask.ts line). The card's citation step now cuts the request by turn (`turns`), while
 * CARD_POLICY_OWN_REQUEST (Glowbrands1/ask-sunny#639) passes only some turns as the notes; the cut reads the same turns
 * as the notes (`form-card-slots.ts` turnsOfNotes). With both on: a second request's card never cites the first
 * request's policy, and a single request's card keeps its Policy line. Until #639 merges its flag is inert here. The
 * person is the pack's invented Remy Calder.
 */
const BOTH = ["SECOND_REQUEST_OWN_ACCOUNT_ENABLED", "CARD_POLICY_OWN_REQUEST_ENABLED"];
const REPORT = "QA, round 5 (8 Nov 2026): SECOND_REQUEST_OWN_ACCOUNT and CARD_POLICY_OWN_REQUEST both on";
const FIRST = "create a corrective action for Remy Calder, he was late opening the salon on 11/2";

const line = (content: string, label: string) => new RegExp(String.raw`\*\*${label}:\*\*[^\n]*`).exec(content)?.[0] ?? "";

export const NOV8_SECOND_REQUEST_WITH_CARD_POLICY_CASES: ReplayCase[] = [
  {
    id: "nov8-second-request-with-card-policy-second-card",
    title: "both flags on: after a late-opening CA, \"I need another corrective action for <A>, his cash drawer was short $20\" cites nothing of Late Opening",
    report: REPORT,
    status: { open: "with production's flags (SECOND_REQUEST_OWN_ACCOUNT off) the second card cites Late Opening" },
    fixFlags: BOTH,
    async run(t) {
      t.directory(STAFF);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      const first = await thread.say(FIRST);
      expect(first.content, `the first card does not cite Late Opening (the premise):\n${first.content}`).toMatch(/Late Opening/);
      await thread.create();
      const reply: ReplayAnswer = await thread.say("I need another corrective action for Remy Calder, his cash drawer was short $20 on 11/3");
      expect(reply.content, `the second card cites the first request's policy:\n${reply.content}`).not.toMatch(/Late Opening/i);
    },
  },
  {
    id: "nov8-second-request-with-card-policy-single-request",
    title: "both flags on: one request, its account first (\"<A> was rude to a guest …\" → \"make a CA for <A>\"), keeps its Policy line",
    report: REPORT,
    status: "fixed",
    fixFlags: BOTH,
    async run(t) {
      t.directory(STAFF);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      await thread.say("Remy Calder was rude to a guest at the front desk on 11/2 and raised his voice at her");
      const reply = await thread.say("make a CA for Remy Calder");
      expect(line(reply.content, "Policy"), `the single request's card lost its Policy line:\n${reply.content}`).toMatch(/standards of conduct/i);
    },
  },
];
