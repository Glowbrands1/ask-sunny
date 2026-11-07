import { expect } from "vitest";

import { KEARNEY, STAFF, type ReplayCase } from "./cases";

/**
 * ============================================================================
 * A SECOND CORRECTIVE ACTION FOR THE SAME EMPLOYEE IN ONE CHAT (QA's audit, 7 Nov 2026)
 * ============================================================================
 *
 * The audit item: "a second CA for the same employee in one chat may reopen the first (the second form is not
 * created)". In replay the first form is never reopened — a second form is created every time. But the second card
 * carries the first request's account:
 * - its Policy line is "Late Opening, as you said" and its Action Plan reviews Late Opening, for a cash drawer short,
 *   and the created form's Policy Violated is Late Opening (every shape below);
 * - when the second request is not worded as a create request ("I need another corrective action for …", "now make a
 *   separate CA for …"), its Observation reads both turns run together.
 * A realistic two-request chat; the person is invented (STAFF's Remy Calder).
 */
const FIRST = "create a corrective action for Remy Calder, he was late opening the salon on 11/2";
const SECONDS: Record<string, string> = {
  another: "I need another corrective action for Remy Calder, his cash drawer was short $20 on 11/3",
  separate: "now make a separate CA for Remy Calder for his cash drawer being short $20 on 11/3",
  create: "create a corrective action for Remy Calder, his cash drawer was short $20 on 11/3",
};

const line = (content: string, label: string) => new RegExp(String.raw`\*\*${label}:\*\*[^\n]*`).exec(content)?.[0] ?? "";

export const NOV7_SECOND_CA_SAME_EMPLOYEE_CASES: ReplayCase[] = Object.entries(SECONDS).map(
  ([key, second]): ReplayCase => ({
    id: `nov7-second-ca-same-employee-${key}`,
    title: `a CA for <name> (late opening), created; then "${second.slice(0, 50)}…": a second form, and its card reads only the second request`,
    report: "QA's audit (7 Nov 2026): a second CA for the same employee in one chat may reopen the first",
    status: { open: "the second card's Policy and Action Plan are the first request's (Late Opening), and so is the created form's Policy Violated" },
    async run(t) {
      t.directory(STAFF);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      await thread.say(FIRST);
      const first = await thread.create();
      const reply = await thread.say(second);
      expect(reply.formOpened?.instanceId ?? null, `the first form is reopened:\n${reply.content}`).not.toBe(first);
      expect(line(reply.content, "Observation of Offense"), `the Observation keeps the first request:\n${reply.content}`).not.toMatch(/late opening/i);
      expect(line(reply.content, "Policy"), `the Policy is the first request's:\n${reply.content}`).not.toMatch(/late opening/i);
      expect(line(reply.content, "Action Plan"), `the Action Plan is the first request's:\n${reply.content}`).not.toMatch(/late opening/i);
      const secondForm = await thread.create();
      expect(secondForm, "no second form").not.toBe(first);
      expect(t.values(secondForm).policy_violated ?? "", "the second form's Policy Violated is the first request's").not.toMatch(/late opening/i);
    },
  }),
);
