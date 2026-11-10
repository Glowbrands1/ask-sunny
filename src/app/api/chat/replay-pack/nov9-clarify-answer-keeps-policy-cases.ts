import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayAnswer, type ReplayCase, type ReplayContext } from "./cases";

/**
 * ============================================================================
 * THE ANSWER TO THE APP'S OWN QUESTION IS THE SAME REQUEST (QA, live round 7b, 9 Nov 2026; Sunny rolled back)
 * ============================================================================
 *
 * With SECOND_REQUEST_OWN_ACCOUNT_ENABLED on: "make me CA for <first name> failing to complete shifts" was asked "Is
 * this for **<Full Name>**?", and the manager answered "Make me a CA for <Full Name> not showing up to her shifts on
 * 11/7 and 11/8". That answer was read as a new request (`ai/form-state.ts` stateForTurn), so the card kept the dates
 * but lost its Policy line (Attendance p.14), and its Action Plan said "the applicable company policy". The same on
 * turns 7-8 of the long sf-s38 chat. The managers' words; the employee is the pack's invented Rowan Kestrel (the
 * live name swapped, in every variant). The models read Attendance for these accounts (stubbed, as live).
 */
const REPORT = "QA, live round 7b (9 Nov 2026): the answer to \"Is this for <Full Name>?\" lost the Attendance Policy line";
const FLAG = "SECOND_REQUEST_OWN_ACCOUNT_ENABLED";

const T1 = "make me CA for rowan failing to complete shifts";
const T2 = "Make me a CA for Rowan Kestrel not showing up to her shifts on  11/7 and 11/8";
/** sf-s38's manager turns (Sunny production, 7 Nov 2026, conv f5e4e29a), the name swapped. */
const SF_S38 = [
  "make me an CA for Rowan Kestrel missing her saturday and sunday shifts due to wanting to go home for the weekend but failed to communicate proporley",
  "make me an CA for Rowan Kestrel missing her saturday and sunday shifts due to wanting to go home for the weekend but failed to communicate proporley",
  "create it",
  "what does out of date mean",
  "this proposal is out od fate",
  "create  the draft",
  T1,
  T2,
];

function start(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-11-09T01:30:00Z"));
  t.directory(STAFF);
  t.as("salon_director", KEARNEY);
  t.slotsRead({ policyHeading: "Attendance" });
  return t.thread();
}

function line(content: string, label: string): string {
  return new RegExp(String.raw`\*\*${label}:\*\*[^\n]*`).exec(content)?.[0] ?? "";
}

function keepsAttendance(reply: ReplayAnswer, turn: string): void {
  const policy = reply.content.split("\n").find((row) => /\*\*Policy:?\*\*|Attendance Policy, JBA Policy Manual/i.test(row)) ?? "";
  expect(policy, `${turn}: no Attendance Policy line:\n${reply.content}`).toMatch(/attendance/i);
  expect(reply.content, `${turn}: the Attendance page is gone:\n${reply.content}`).toMatch(/p\.\s*14|page 14/i);
  expect(line(reply.content, "Action Plan"), `${turn}: the Action Plan says "applicable company policy":\n${reply.content}`).not.toMatch(/applicable company policy/i);
}

export const NOV9_CLARIFY_ANSWER_KEEPS_POLICY_CASES: ReplayCase[] = [
  {
    id: "nov9-clarify-answer-keeps-policy-two-turns",
    title: "\"make me CA for <first name> failing to complete shifts\", then the answer \"Make me a CA for <Full Name> not showing up …\": T2 keeps Attendance p.14",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      const thread = start(t);
      await thread.say(T1);
      keepsAttendance(await thread.say(T2), "T2");
    },
  },
  {
    id: "nov9-clarify-answer-keeps-policy-sf-s38",
    title: "sf-s38's eight turns: turns 7 and 8 keep Attendance p.14",
    report: `${REPORT} (the same inside the long sf-s38 chat, turns 7-8)`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      const thread = start(t);
      const replies: ReplayAnswer[] = [];
      for (const turn of SF_S38) replies.push(await thread.say(turn));
      keepsAttendance(replies[6]!, "turn 7");
      keepsAttendance(replies[7]!, "turn 8");
    },
  },
];
