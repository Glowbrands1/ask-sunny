import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";

/**
 * ============================================================================
 * A METRIC SAID TO BE LOW IS NOT THE EMPLOYEE (ported from Ask Bubbles: QA's prod-env reading there, 10 Nov 2026, D4;
 * METRIC_ALONE_NOT_A_NAME_ENABLED)
 * ============================================================================
 *
 * With production's flags (CA_SALES_POLICY on: a metric may ground a Corrective Action), "Their Club Close is low. Create
 * a corrective action." (`corrective-action-conversation.test.ts`) drafted the form for an employee named "Club Close".
 * The metric guard knew only a metric written with "%", a list item or an offense word.
 */
const SAID = "Their Club Close is low. Create a corrective action.";
const FIX = ["METRIC_ALONE_NOT_A_NAME_ENABLED"];
const REPORT = "Ported from Ask Bubbles (QA's prod-env reading, 10 Nov 2026, D4): a metric said to be low was read as the employee's name";

function start(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-11-10T15:00:00Z"));
  t.directory(STAFF);
  t.as("salon_director", KEARNEY);
  return t.thread();
}

export const NOV10_METRIC_ALONE_NOT_A_NAME_CASES: ReplayCase[] = [
  {
    id: "nov10-metric-alone-not-a-name",
    title: `"${SAID}": no card names "Club Close" as the employee`,
    report: REPORT,
    status: { open: "the card's employee is \"Club Close\"" },
    fixFlags: FIX,
    async run(t) {
      const thread = start(t);
      const reply = await thread.say(SAID);
      expect(thread.proposal?.employeeName ?? "", `the metric is the card's person:\n${reply.content}`).not.toMatch(/club close/i);
      expect(reply.content, "the reply names the metric as the person").not.toMatch(/for \*\*Club Close\*\*|Club Close's position/i);
    },
  },
];
