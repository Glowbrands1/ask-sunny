import { expect, vi } from "vitest";

import { KEARNEY, type ReplayCase, type ReplayContext } from "./cases";
import { REFUSAL_ROSTER, patch } from "./nov7-step-b-refusals-scenarios";

/**
 * ============================================================================
 * A MADE-ABOUT REWRITE: THE OFFENSE, POLICY VIOLATED, DIRECT POLICY AND THE PLAN AGREE (QA's live 17x item 2a, 14 Nov)
 * ============================================================================
 *
 * Ported from Ask Bubbles. QA's live 17x check (Ask Bubbles production, ACCOUNT_CHANGE_REDERIVES_POLICY on; rolled back 14 Nov 00:09Z): a saved
 * lateness CA draft (Attendance), then the exact "make it about her phone use instead, she was on her phone the whole
 * shift". The Observation was rewritten to the phone use and Type of Offense moved to Standards of Conduct, but Policy
 * Violated stayed "Attendance Policy", Direct policy stayed Attendance p.14, and the plan was rewritten as "Management
 * will review the Attendance policy with <B>". On the made-about path the old revision rewrites the account and ticks
 * the box itself; the re-derive then found the box already moved and left the policy lines. The person is invented.
 *
 * WHAT THIS REPLAY SHOWS: the made-about revision is scripted (`revisionWrites`); it rewrites the account with the date
 * kept. The stand-in's ticks do not land, so the live revision's Standards of Conduct tick is replayed through the
 * reader instead (the second case): the box moved in the same turn as the account.
 */

const LATE = "create a ca for Ottoline Ormsworth, she was late on 11/3/26";
const EXACT = "make it about her phone use instead, she was on her phone the whole shift";
const PHONE_ACCOUNT = "Observed:\nOttoline Ormsworth was on her phone the whole shift on 11/3/26.\n\nExpectation:\nPhone use is limited to breaks.";
const REPORT = "QA's live 17x check (14 Nov 2026), item 2a: after \"make it about her phone use instead, she was on her phone the whole shift\" the offense said Standards of Conduct while Policy Violated, Direct policy and the plan said Attendance";
const REDERIVE = "ACCOUNT_CHANGE_REDERIVES_POLICY_ENABLED";
/** The tester's account through the reader, with the box ticked in the same turn (as the live revision ticked it). */
const READER = "change the issue to she was on her phone the whole shift";

async function lateDraft(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-11-13T18:00:00Z"));
  t.directory(REFUSAL_ROSTER);
  t.as("salon_director", KEARNEY);
  const thread = t.thread();
  await thread.say(LATE);
  t.draftWrites({ observation: "Observed:\nOttoline Ormsworth arrived late for her shift on 11/3/26." }, { offense_type: ["attendance_policy"] });
  const id = await thread.create();
  return { thread, id };
}

async function madeAbout(t: ReplayContext) {
  const { thread, id } = await lateDraft(t);
  expect(t.values(id).policy_violated ?? "", "the draft is not on Attendance").toMatch(/attendance/i);
  // The made-about revision rewrites the account (the date kept, as the live revision kept it).
  t.revisionWrites({ observation: PHONE_ACCOUNT });
  const reply = await thread.say(EXACT);
  return { id, reply };
}

/** All four agree on the phone account: Standards of Conduct box, the Cell Phone section, no Attendance anywhere. */
function allAgree(t: ReplayContext, id: string, content: string) {
  const values = t.values(id);
  const offense = t.checked(id).offense_type ?? [];
  const where = `\n${content}\n${JSON.stringify({ offense, pv: values.policy_violated, plan: values.action_plan })}`;
  expect(values.observation ?? "", `the account was not rewritten${where}`).toMatch(/phone/i);
  expect(offense, `the offense left the phone account${where}`).toEqual(["standards_of_conduct"]);
  expect(values.policy_violated ?? "", `Policy Violated stayed Attendance${where}`).not.toMatch(/attendance/i);
  expect(values.policy_violated ?? "", `Policy Violated is not the phone policy${where}`).toMatch(/cell phone/i);
  expect(values.policy_language ?? "", `Direct policy stayed Attendance${where}`).not.toMatch(/arrives on time|punctuality|attendance, p\. ?14/i);
  expect(values.policy_language ?? "", `Direct policy is not the Cell Phone section${where}`).toMatch(/cell phone/i);
  expect(values.action_plan ?? "", `the plan stayed Attendance${where}`).not.toMatch(/attendance|arrive on time/i);
}

export const NOV14_ACCOUNT_CHANGE_MADE_ABOUT_AGREES_CASES: ReplayCase[] = [
  {
    id: "nov14-account-change-box-already-moved-policy-follows",
    title: `a lateness CA draft, then "${READER}": the box moves to Standards of Conduct in the same turn as the account, and Policy Violated, Direct policy and the plan follow it`,
    report: `${REPORT} (the box already moved this turn: the re-derive left Policy Violated on Attendance)`,
    status: { open: "with ACCOUNT_CHANGE_REDERIVES_POLICY off nothing follows the new account" },
    fixFlags: [REDERIVE],
    async run(t) {
      const { thread, id } = await lateDraft(t);
      t.patchReads!({
        [READER]: patch("this_form", [
          { field: "observation", value: "Observed:\nOttoline Ormsworth was on her phone the whole shift on 11/3/26.", how: "replace", evidence: "she was on her phone the whole shift" },
          { field: "offense_type", options: ["standards_of_conduct"], how: "replace", evidence: "she was on her phone the whole shift" },
        ]),
      });
      const reply = await thread.say(READER);
      allAgree(t, id, reply.content);
    },
  },
  {
    id: "nov14-account-change-made-about-all-four-agree",
    title: `a lateness CA draft, then the exact "${EXACT}": the offense, Policy Violated, Direct policy and the plan all follow the phone account`,
    report: REPORT,
    status: { open: "with ACCOUNT_CHANGE_REDERIVES_POLICY off nothing follows the new account" },
    fixFlags: [REDERIVE],
    async run(t) {
      const { id, reply } = await madeAbout(t);
      allAgree(t, id, reply.content);
    },
  },
];
