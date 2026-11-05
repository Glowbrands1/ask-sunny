import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";
import { pauFivePeople } from "./nov4-ca-sales-pau-five-cases";

/**
 * QA, live, 4 Nov 2026 (CA_SALES_POLICY_ENABLED on): "CA for <name> due to
 * under performance in salon metrics" made the card, but the draft's
 * Observation of Offense was that whole sentence: the model copied the
 * request. The stand-in model copies it the same way here. With the flag on,
 * the Observation begins with the request's reason (`request-observation.ts`).
 * Every person is invented.
 */

type T = ReplayContext;

const REPORT = "QA, live, 4 Nov 2026: the draft's Observation of Offense was the manager's request";

function start(t: T) {
  vi.setSystemTime(new Date("2026-11-04T15:30:00Z"));
  t.directory([...STAFF, ...pauFivePeople()]);
  t.as("salon_director", KEARNEY);
  return t.thread();
}

export const NOV4_REQUEST_OBSERVATION_CASES: ReplayCase[] = [
  {
    id: "nov4-request-not-observation-due-to",
    title: "\"CA for <name> due to under performance in salon metrics\": the Observation is the reason, not the request",
    report: `${REPORT} (#3)`,
    status: { open: "with production's flags the Observation is the request as the model copied it" },
    fixFlags: ["CA_SALES_POLICY_ENABLED"],
    async run(t) {
      const thread = start(t);
      await thread.say("CA for Briony Fellwater due to under performance in salon metrics");
      expect(thread.proposal, "no Corrective Action card").toMatchObject({ templateKey: "dpoa", employeeName: "Briony Fellwater" });
      t.draftWrites({ observation: "Observed:\nCA for Briony Fellwater due to under performance in salon metrics" });
      const observation = t.values(await thread.create()).observation ?? "";
      expect(observation, `the Observation is the request:\n${observation}`).not.toMatch(/\bCA\s+for\b/i);
      expect(observation, `the reason is gone:\n${observation}`).toMatch(/under performance in salon metrics/i);
    },
  },
  {
    id: "nov4-request-not-observation-negative-account",
    title: "negative control: an Observation that is the account is left as the model wrote it",
    report: `${REPORT}, negative control`,
    status: "fixed",
    fixFlags: ["CA_SALES_POLICY_ENABLED"],
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
