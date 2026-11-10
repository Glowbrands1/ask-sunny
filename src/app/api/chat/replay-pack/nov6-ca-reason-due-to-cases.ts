import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";
import { pauFivePeople } from "./nov4-ca-sales-pau-five-cases";

/**
 * Ported from the sibling app (CA_REASON_DUE_TO_ENABLED, default off). QA,
 * live, 4 Nov 2026: "CA for <name> due to under performance in salon metrics"
 * — the draft's Observation of Offense was the request as the model copied
 * it. Here that is fixed by CA_SALES_POLICY_ENABLED (`nov4-request-not-
 * observation-due-to`); CA_REASON_DUE_TO_ENABLED fixes it on its own, and
 * also "create a ca for <name> at <salon>, she was late …" (the #237 audit's
 * wording), which CA_SALES_POLICY alone leaves as the request. The stand-in
 * model copies the request. Every person is invented.
 */

type T = ReplayContext;

const REPORT = "QA, live, 4 Nov 2026: the draft's Observation of Offense was the manager's request";
const FLAG = ["CA_REASON_DUE_TO_ENABLED"];
const REQUEST_WORDS = /\b(?:due\s+to|because|create|ca\s+for|corrective\s+action\s+for)\b/i;

function start(t: T) {
  vi.setSystemTime(new Date("2026-11-04T15:30:00Z"));
  t.directory([...STAFF, ...pauFivePeople()]);
  t.as("salon_director", KEARNEY);
  return t.thread();
}

export const NOV6_CA_REASON_DUE_TO_CASES: ReplayCase[] = [
  {
    id: "nov6-ca-reason-due-to-draft-observation",
    title: "\"CA for <name> due to under performance in salon metrics\": the drafted Observation is the reason, not the request",
    report: `${REPORT} (#3)`,
    // Changed on purpose (10 Nov 2026, the group-4 gate on main ed18d1fc): it holds with production's flags now that
    // CA_SALES_POLICY is on here; the at-salon row below is still open without CA_REASON_DUE_TO.
    status: "fixed",
    fixFlags: FLAG,
    async run(t) {
      const thread = start(t);
      await thread.say("CA for Briony Fellwater due to under performance in salon metrics");
      expect(thread.proposal, "no Corrective Action card").toMatchObject({ templateKey: "dpoa", employeeName: "Briony Fellwater" });
      t.draftWrites({ observation: "Observed:\nCA for Briony Fellwater due to under performance in salon metrics" });
      const observation = t.values(await thread.create()).observation ?? "";
      expect(observation, `the Observation is the request:\n${observation}`).not.toMatch(REQUEST_WORDS);
      expect(observation, `the reason is gone:\n${observation}`).toMatch(/under performance in salon metrics/i);
    },
  },
  {
    id: "nov6-ca-reason-at-salon-then-account",
    title: "\"create a ca for <name> at <salon>, she was late on 10-5 and 10-15 …\": the drafted Observation is the account, not the request",
    report: "audit of the sibling app's #237 (live, 26 Oct 2026): the request words led the account",
    status: { open: "with production's flags the Observation is the request as the model copied it" },
    fixFlags: FLAG,
    async run(t) {
      vi.setSystemTime(new Date("2026-10-26T15:30:00Z"));
      t.directory([...STAFF]);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      await thread.say("create a ca for remy calder at kearney, she was late on 10-5 and 10-15. i coached her on 10-16 about being late");
      expect(thread.proposal, "no Corrective Action card").toMatchObject({ templateKey: "dpoa", employeeName: "Remy Calder" });
      t.draftWrites({ observation: "Observed:\ncreate a ca for Remy Calder at kearney, she was late on 10-5 and 10-15." });
      const observation = t.values(await thread.create()).observation ?? "";
      expect(observation, `the Observation is the request:\n${observation}`).not.toMatch(REQUEST_WORDS);
      expect(observation).toMatch(/late on 10-5 and 10-15/);
    },
  },
  {
    id: "nov6-ca-reason-negative-account",
    title: "negative control: an Observation that is the account is left as the model wrote it",
    report: `${REPORT}, negative control`,
    status: "fixed",
    fixFlags: FLAG,
    async run(t) {
      const thread = start(t);
      await thread.say("CA for Briony Fellwater due to under performance in salon metrics");
      t.draftWrites({ observation: "Observed:\nBriony Fellwater did not meet her salon metrics in October." });
      const observation = t.values(await thread.create()).observation ?? "";
      expect(observation, `the account was rewritten:\n${observation}`).toMatch(/Briony Fellwater did not meet (?:her|the) salon metrics/);
      expect(observation).not.toMatch(/under performance in salon metrics/i);
    },
  },
];
