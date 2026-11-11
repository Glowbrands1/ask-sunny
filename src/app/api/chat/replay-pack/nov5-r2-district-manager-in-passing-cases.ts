import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayAnswer, type ReplayCase } from "./cases";

/**
 * ============================================================================
 * R2 (QA, 5 Nov 2026; reported in the sibling app, checked here)
 * ============================================================================
 *
 * The shape, with every person invented and the story in this app's own
 * words: "create a ca form for <employee, a three-word name>", then one long
 * turn that tells ONE employee's story, names their district manager twice in
 * passing, and asks for a verbal warning. Two defects in the sibling app:
 *
 *   1. the card's Position is "District Manager" — the OTHER person's, read
 *      from the story.
 *   2. What happened (the card's Issue) is the first fragment only; the
 *      complaint itself (rude to a guest) is missing.
 *
 * In this app the card's title is only ever what the manager stated
 * (`ChatFormProposal.employeeRole`); a title the manager attached to somebody
 * else is not that. Recorded here, 5 Nov 2026 (main f11c7db4):
 *
 *   - production's flags: the card is for the employee, its Job title is
 *     "District Manager" (defect 1); the Observation carries the whole story
 *     (no defect 2 here).
 *   - with FORM_NAME_FROM_ROSTER_ENABLED + CA_SALES_POLICY_ENABLED on (the
 *     flip), the card is for THE DISTRICT MANAGER: "When Odalys" was set
 *     aside as shaped like nobody, leaving her as the only roster person.
 *
 * Fixes, both default off: TITLE_OF_THE_EMPLOYEE_ENABLED (port of the
 * sibling's; `ai/title-of-the-employee.ts`) and ROSTER_NAME_IN_CANDIDATE_ENABLED
 * (`forms/roster-shape.ts`).
 */

const person = (id: string, firstName: string, lastName: string, positionName: string): DirectoryRow => ({
  id,
  firstName,
  lastName,
  preferredFirstName: null,
  employmentStatus: "active",
  salonIds: ["loc-0309"],
  positionName,
});

const ODALYS = person("e-odalys-prewett-vansickle", "Odalys", "Prewett Vansickle", "Tanning Consultant");
const THESSALY = person("e-thessaly-brookhart", "Thessaly", "Brookhart", "District Manager");

const FLIP = ["FORM_NAME_FROM_ROSTER_ENABLED", "CA_SALES_POLICY_ENABLED"];

const REPORT = "QA, 5 Nov 2026, R2 (the sibling app's production chat, flags off, full conversation), in this app's words";

const T1 = "create a ca form for Odalys Prewett Vansickle";
const T2 =
  "verbal warning The date she complained was Oct 31st . The guest said she was giving her an attitude when she brought up that the register was charging her for a lotion she did not buy and it has never done that before. When Odalys spoke with District manager Thessaly Brookhart on the phone about how to fix this, Odalys told the guest that she was making her job really hard. The guest reached out to district manager Thessaly Brookhart saying Odalys was very rude to her and Odalys told her she knows how to do her job she has worked here for two years. no payroll deduct.";

/** The card's Observation of Offense line, or "". */
function observationLine(reply: ReplayAnswer): string {
  return reply.content.split("\n").find((line) => /\*\*Observation of Offense:?\*\*/i.test(line)) ?? "";
}

async function story(t: Parameters<ReplayCase["run"]>[0]) {
  vi.setSystemTime(new Date("2026-11-03T21:00:00Z"));
  t.directory([...STAFF, ODALYS, THESSALY]);
  t.as("salon_director", KEARNEY);
  const thread = t.thread();
  await thread.say(T1);
  const reply = await thread.say(T2);
  expect(thread.proposal, `no CA card for Odalys Prewett Vansickle:\n${reply.content}`).toMatchObject({ templateKey: "dpoa", employeeName: "Odalys Prewett Vansickle" });
  return { thread, reply };
}

/** The card is for the employee, never the district manager named in passing. */
async function employee(t: Parameters<ReplayCase["run"]>[0]) {
  await story(t);
}

/** Defect 1: the Job title is never the district manager's. */
async function position(t: Parameters<ReplayCase["run"]>[0]) {
  const { thread, reply } = await story(t);
  expect(thread.proposal?.employeeRole ?? "", "the Position is the district manager's").not.toMatch(/district manager/i);
  expect(reply.content, "the reply's Position is the district manager's").not.toMatch(/\*\*Position:\*\*\s*District Manager/i);
}

/** Defect 2: What happened carries the complaint. */
async function account(t: Parameters<ReplayCase["run"]>[0]) {
  const { reply } = await story(t);
  expect(observationLine(reply), `the Observation is only the first fragment:\n${observationLine(reply)}`).toMatch(/rude|attitude/i);
}

function withFlags(flags: readonly string[], check: (t: Parameters<ReplayCase["run"]>[0]) => Promise<void>) {
  return async (t: Parameters<ReplayCase["run"]>[0]) => {
    for (const flag of flags) vi.stubEnv(flag, "true");
    try {
      await check(t);
    } finally {
      vi.unstubAllEnvs();
    }
  };
}

const TITLE = "TITLE_OF_THE_EMPLOYEE_ENABLED";
const IN_CANDIDATE = "ROSTER_NAME_IN_CANDIDATE_ENABLED";

export const NOV5_R2_DISTRICT_MANAGER_IN_PASSING_CASES: ReplayCase[] = [
  {
    id: "nov5-r2-dm-in-passing-position",
    title: "R2 (1): one employee's story naming their district manager in passing: the card's Job title is never \"District Manager\"",
    report: `${REPORT}: Job title "District Manager", taken from the other person`,
    // Changed on purpose (7 Nov 2026): QA's flips of 5 and 6 Nov turned CA_SALES_POLICY, REPLY_MATCHES_CARD, TITLE_OF_THE_EMPLOYEE, METRIC_GUARD, TITLE_ENDS_AT_LINE, BARE_NOT_DENIAL and PLACE_FROM_CUE on in production (production-flags.json); this case now holds with production's flags.
    status: "fixed",
    fixFlags: [TITLE],
    run: position,
  },
  {
    id: "nov5-r2-dm-in-passing-account",
    title: "R2 (2): the same story: the Observation carries the complaint (rude to a guest), not just the first fragment",
    report: `${REPORT}: What happened truncated to the first fragment (the sibling app); here the Observation is the whole story`,
    status: "fixed",
    run: account,
  },
  {
    id: "nov5-r2-dm-in-passing-employee-with-the-flip",
    title: "R2 with FORM_NAME_FROM_ROSTER_ENABLED + CA_SALES_POLICY_ENABLED on: the card is for the employee, never the district manager named in passing",
    report: `${REPORT}: with the flip's flags, "I'll draft a Corrective Action Form for <the district manager>"`,
    // Changed on purpose (10 Nov 2026): fixed in production by the roster-name set (FORM_NAME_FROM_ROSTER and companions), QA round 22; it now holds with production's flags.
    status: "fixed",
    fixFlags: [IN_CANDIDATE],
    run: withFlags(FLIP, employee),
  },
  {
    id: "nov5-r2-dm-in-passing-position-with-the-flip",
    title: "R2 (1) with FORM_NAME_FROM_ROSTER_ENABLED + CA_SALES_POLICY_ENABLED on: the card is the employee's and its Job title is never the district manager's",
    report: `${REPORT}: does the sales flip change it? Recorded 5 Nov 2026: yes, the card is for the district manager`,
    // Changed on purpose (10 Nov 2026): fixed in production by the roster-name set (FORM_NAME_FROM_ROSTER and companions), QA round 22; it now holds with production's flags.
    status: "fixed",
    fixFlags: [IN_CANDIDATE, TITLE],
    run: withFlags(FLIP, position),
  },
  {
    id: "nov5-r2-dm-in-passing-account-with-the-flip",
    title: "R2 (2) with FORM_NAME_FROM_ROSTER_ENABLED + CA_SALES_POLICY_ENABLED on: the card is the employee's and the Observation carries the complaint",
    report: `${REPORT}: does the sales flip change it? Recorded 5 Nov 2026: the card is for the district manager`,
    // Changed on purpose (10 Nov 2026): fixed in production by the roster-name set (FORM_NAME_FROM_ROSTER and companions), QA round 22; it now holds with production's flags.
    status: "fixed",
    fixFlags: [IN_CANDIDATE],
    run: withFlags(FLIP, account),
  },
];
