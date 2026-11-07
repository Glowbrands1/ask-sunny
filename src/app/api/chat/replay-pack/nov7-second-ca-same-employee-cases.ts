import { expect } from "vitest";

import { KEARNEY, STAFF, type ReplayAnswer, type ReplayCase, type ReplayContext, type ReplayThread } from "./cases";

/**
 * ============================================================================
 * A SECOND CORRECTIVE ACTION FOR THE SAME EMPLOYEE IN ONE CHAT (QA's audit, 7 Nov 2026)
 * ============================================================================
 *
 * The audit item: "a second CA for the same employee in one chat may reopen the first (the second form is not
 * created)". Live, DRAFT_DEDUPE's lookup read every turn of the chat as the incident, so the first draft matched and
 * was reopened (`forms/second-request-reopen.test.ts`; replay's store never returns that draft). Where a second form
 * was made, it carried the first request's account: its Policy Violated, the card's Policy line ("Late Opening, as you
 * said") and Action Plan, and — when the request was not worded as a create request — its Observation.
 * SECOND_REQUEST_OWN_ACCOUNT_ENABLED reads each request on its own. Three parts per wording, each with its own status:
 * the form (a second form, the first untouched, its Policy Violated the second request's), the card's policy line (in
 * `ai/form-proposal.ts`, Pau-approved 7 Nov 2026), and the Observation (in `ai/remap-incident.ts`, with coding 4). A realistic
 * two-request chat; the person is invented (STAFF's Remy Calder).
 */
const FLAG = "SECOND_REQUEST_OWN_ACCOUNT_ENABLED";
const FIRST = "create a corrective action for Remy Calder, he was late opening the salon on 11/2";
const SECONDS: Record<string, string> = {
  another: "I need another corrective action for Remy Calder, his cash drawer was short $20 on 11/3",
  separate: "now make a separate CA for Remy Calder for his cash drawer being short $20 on 11/3",
  create: "create a corrective action for Remy Calder, his cash drawer was short $20 on 11/3",
};
const REPORT = "QA's audit (7 Nov 2026): a second CA for the same employee in one chat may reopen the first";

const line = (content: string, label: string) => new RegExp(String.raw`\*\*${label}:\*\*[^\n]*`).exec(content)?.[0] ?? "";

async function secondRequest(t: ReplayContext, second: string): Promise<{ thread: ReplayThread; first: string; firstBefore: Record<string, string>; reply: ReplayAnswer }> {
  t.directory(STAFF);
  t.as("salon_director", KEARNEY);
  const thread = t.thread();
  await thread.say(FIRST);
  const first = await thread.create();
  const firstBefore = { ...t.values(first) };
  const reply = await thread.say(second);
  return { thread, first, firstBefore, reply };
}

export const NOV7_SECOND_CA_SAME_EMPLOYEE_CASES: ReplayCase[] = Object.entries(SECONDS).flatMap(([key, second]): ReplayCase[] => [
  {
    id: `nov7-second-ca-same-employee-${key}`,
    title: `a CA for <name> (late opening), created; then "${second.slice(0, 50)}…": a second form, and the first is never reopened or changed`,
    report: REPORT,
    // Replay's store never returns the first draft to DRAFT_DEDUPE's lookup, so this holds here; the live reopen and
    // its fix are proved in forms/second-request-reopen.test.ts.
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      const { thread, first, firstBefore, reply } = await secondRequest(t, second);
      expect(reply.formOpened?.instanceId ?? null, `the first form is reopened:\n${reply.content}`).not.toBe(first);
      const secondForm = await thread.create();
      expect(secondForm, "no second form").not.toBe(first);
      expect(t.values(first), "the first form changed").toEqual(firstBefore);
    },
  },
  {
    id: `nov7-second-ca-same-employee-${key}-card-policy`,
    title: `the same chat: the second card's Policy line and Action Plan, and the second form's Policy Violated, are not the first request's (Late Opening)`,
    report: REPORT,
    status: { open: "the second card says \"Late Opening, as you said\", its Action Plan reviews Late Opening, and the second form's Policy Violated is Late Opening" },
    fixFlags: [FLAG],
    // Changed on purpose (7 Nov 2026): holds with the flag since Pau approved the two ai/form-proposal.ts lines; the
    // card's citation step and the saved state's incident read this request too (ai/form-card-slots.ts, ai/form-state.ts).
    async run(t) {
      const { thread, reply } = await secondRequest(t, second);
      expect(line(reply.content, "Policy"), `the Policy is the first request's:\n${reply.content}`).not.toMatch(/late opening/i);
      expect(line(reply.content, "Action Plan"), `the Action Plan is the first request's:\n${reply.content}`).not.toMatch(/late opening/i);
      const secondForm = await thread.create();
      expect(t.values(secondForm).policy_violated ?? "", "the second form's Policy Violated is the first request's").not.toMatch(/late opening/i);
    },
  },
  {
    id: `nov7-second-ca-same-employee-${key}-observation`,
    title: `the same chat: the second card's Observation is only the cash-drawer account`,
    report: REPORT,
    ...(key === "create"
      ? { status: "fixed" as const }
      : {
          status: { open: "the Observation reads both requests run together" },
          fixFlags: [FLAG],
          fixStatus: { open: "the request start is read in ai/remap-incident.ts (with coding 4, after ask-sunny #611)" },
        }),
    async run(t) {
      const { reply } = await secondRequest(t, second);
      const observation = line(reply.content, "Observation of Offense");
      expect(observation, `no Observation:\n${reply.content}`).toMatch(/cash drawer/i);
      expect(observation, `the Observation keeps the first request:\n${reply.content}`).not.toMatch(/late opening/i);
    },
  },
]);
