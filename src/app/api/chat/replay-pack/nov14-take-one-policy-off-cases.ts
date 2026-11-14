import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayCase, type ReplayContext } from "./cases";

/**
 * ============================================================================
 * TAKING ONE POLICY OFF A TWO-POLICY CARD KEEPS THE OTHER (the two-offense chain)
 * ============================================================================
 *
 * Ported from Ask Bubbles: Gate-Bubbles-4's NO-GO probe on that app's chain (14 Nov 2026, via QA), checked here too: after the both-policies card for "she was late on
 * 11/3/26 and she yelled at a customer", "take the attendance policy off the form" (NAMED + LINE, and all three flags)
 * gave a card saying "Policy: none — you took the Attendance policy off" with a generic plan, a draft with Policy
 * Violated blank and Direct policy empty, and the saved form still ticking Attendance + Standards of Conduct with the
 * Attendance plan. "take standards of conduct off" failed the same way. The bar: a removal takes out only that
 * policy's section, tick and plan line; the other policy stays on the card, Policy Violated, Direct policy and plan;
 * and the card and the saved form agree. With the chain off the card cites one policy for this account, so these are
 * open there. The person is invented (on no directory).
 */

const NELL: DirectoryRow = { id: "e-nell-orrin-mpp", firstName: "Nell", lastName: "Orrin", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0309"], positionName: "Tanning Consultant" };
const BOTH = "create a ca for Nell Orrin, she was late on 11/3/26 and she yelled at a customer. verbal. no payroll deduct.";
const ATTENDANCE_OFF = "take the attendance policy off the form";
const CONDUCT_OFF = "take standards of conduct off";
const REPORT = "Ported from Ask Bubbles, Gate-Bubbles-4's chain probe (14 Nov 2026): \"take the attendance policy off the form\" after the both-policies card left the card with no policy and the saved form with both ticks and the Attendance plan";
const CHAIN = ["NAMED_POLICIES_ALL_KEPT_ENABLED", "POLICY_LINE_COVERS_EVERY_SECTION_ENABLED"];

async function takeOff(t: ReplayContext, ask: string) {
  vi.setSystemTime(new Date("2026-11-10T15:00:00Z"));
  t.directory([...STAFF, NELL]);
  t.as("salon_director", KEARNEY);
  const thread = t.thread();
  await thread.say(BOTH);
  const card = (await thread.say(ask)).content;
  t.draftWrites({ observation: "Observed:\nNell Orrin was late on November 3, 2026 and she yelled at a customer." });
  const id = await thread.create();
  const policyLine = /^\*\*Policy:\*\*.*$/im.exec(card)?.[0] ?? "";
  const cardPlan = /^\*\*Action plan:\*\*\s*(.+)$/im.exec(card)?.[1]?.trim() ?? "";
  return { id, card, policyLine, cardPlan };
}

function keepsOnly(t: ReplayContext, run: Awaited<ReturnType<typeof takeOff>>, kept: RegExp, gone: RegExp, keptBox: RegExp, goneBox: RegExp) {
  const { id, card, policyLine, cardPlan } = run;
  const values = t.values(id);
  const boxes = t.checked(id).offense_type ?? [];
  const where = JSON.stringify({ boxes, violated: values.policy_violated, plan: values.action_plan });
  // The card.
  expect(policyLine, `the card cites no policy:\n${card}`).not.toMatch(/\bnone\b/i);
  expect(policyLine, `the card dropped the policy that stays:\n${card}`).toMatch(kept);
  // The line says what was taken off ("— you took the Attendance policy off"); what it cites is before that.
  expect(policyLine.split(/\s+—\s+you took\b/)[0], `the card still cites the policy taken off:\n${card}`).not.toMatch(gone);
  expect(cardPlan, `the card's plan still names the policy taken off:\n${card}`).not.toMatch(gone);
  // The saved form.
  expect(boxes.some((key) => keptBox.test(key)), `the box that stays is not ticked ${where}`).toBe(true);
  expect(boxes.some((key) => goneBox.test(key)), `the box taken off is still ticked ${where}`).toBe(false);
  expect(values.policy_violated ?? "", `Policy Violated dropped the policy that stays ${where}`).toMatch(kept);
  expect(values.policy_violated ?? "", `Policy Violated still names the policy taken off ${where}`).not.toMatch(gone);
  expect((values.policy_language ?? "").trim(), `Direct policy is empty ${where}`).not.toBe("");
  expect(values.action_plan ?? "", `the plan still names the policy taken off ${where}`).not.toMatch(gone);
  // The card and the saved form agree. Pau's attendance plan reaches this app's card only with CARD_PLAN_MATCHES_CREATE
  // (ported in #894, not on this branch), so where Create saved that plan the card's general line is not compared here.
  if (!/^\w+ is expected to arrive on time/.test(values.action_plan ?? "")) {
    expect(cardPlan, `the card's plan and the saved plan differ:\n${card}\n---\n${values.action_plan}`).toBe(values.action_plan ?? "");
  }
}

export const NOV14_TAKE_ONE_POLICY_OFF_CASES: ReplayCase[] = [
  {
    id: "nov14-take-one-policy-off-attendance",
    title: `"${BOTH}" then "${ATTENDANCE_OFF}": Standards of Conduct stays on the card and the form; Attendance goes from both`,
    report: REPORT,
    status: { open: "with the chain off the card reads one policy for this account, so taking one off does not leave the other on both" },
    fixFlags: CHAIN,
    async run(t) {
      const run = await takeOff(t, ATTENDANCE_OFF);
      keepsOnly(t, run, /standards of conduct/i, /attendance|lateness|arrive on time/i, /^standards_of_conduct$/, /attendance|tardiness/);
    },
  },
  {
    id: "nov14-take-one-policy-off-conduct",
    title: `"${BOTH}" then "${CONDUCT_OFF}": Attendance stays on the card and the form; Standards of Conduct goes from both`,
    report: `${REPORT} ("take standards of conduct off" failed the same way)`,
    // In this app the chain-off card cites Attendance alone for this account, so taking Standards of Conduct off leaves it.
    status: "fixed",
    fixFlags: CHAIN,
    async run(t) {
      const run = await takeOff(t, CONDUCT_OFF);
      keepsOnly(t, run, /attendance/i, /standards of conduct/i, /attendance|tardiness/, /^standards_of_conduct$/);
    },
  },
];
