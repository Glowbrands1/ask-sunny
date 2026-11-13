import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayCase, type ReplayContext } from "./cases";
import { patch } from "./nov7-step-b-refusals-scenarios";

/**
 * ============================================================================
 * AN EDIT THAT REPLACES THE WHOLE ACCOUNT RE-DERIVES THE POLICY (ACCOUNT_CHANGE_REDERIVES_POLICY_ENABLED)
 * ============================================================================
 *
 * Ported from Ask Bubbles (QA, 13 Nov 2026; the same cases in both apps). In the tester's words there: on a
 * Corrective Action drafted for lateness, "make it about her phone use instead, she was on her phone the whole shift"
 * rewrote the Observation, but offense_type, Policy Violated, Direct policy
 * and the synced plan stayed on Attendance. The same happened after "change the issue to not doing the 10-minute
 * sanitation": the lateness plan stayed. On: the offense is read again from the new account and the policy lines and the
 * plan follow. A policy the manager names in the edit is kept. The person is invented (on no directory).
 *
 * WHAT THIS REPLAY SHOWS, AND DOES NOT: the "make it about …" turn goes through the made-about revision
 * (`chat-revision.ts`), which the sibling's harness stand-in cannot script for a Corrective Action (the revision is refused as
 * "I haven't changed …"). The phone account is replayed instead through the reader ("change the issue to she was on
 * her phone the whole shift", the tester's own account), and the step runs after any account rewrite live, by either path.
 */

const TESS: DirectoryRow = { id: "e-tess-varga-acr", firstName: "Tess", lastName: "Varga", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0309"], positionName: "Tanning Consultant" };
const LATE = "create ca form for tess varga for violating attendance policy, she was late on 10/20/26. verbal. no payroll deduct.";
const SANITATION = "change the issue to not doing the 10-minute sanitation";
const PHONE = "change the issue to she was on her phone the whole shift";
const PHONE_NAMED = "change the issue to she was on her phone the whole shift, it is still an attendance policy violation";
const REPORT = "QA, 13 Nov 2026: \"make it about her phone use instead, she was on her phone the whole shift\" / \"change the issue to not doing the 10-minute sanitation\" left Attendance on the policy lines and plan";
const FLAG = "ACCOUNT_CHANGE_REDERIVES_POLICY_ENABLED";

const PHONE_PATCH = (evidence: string) =>
  patch("this_form", [{ field: "observation", value: "Observed:\nShe was on her phone the whole shift.", how: "replace", evidence }]);

async function lateCa(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-10-25T15:00:00Z"));
  t.directory([...STAFF, TESS]);
  t.as("salon_director", KEARNEY);
  const thread = t.thread();
  await thread.say(LATE);
  t.draftWrites({ observation: "Observed:\nTess Varga was late on October 20, 2026." });
  const id = await thread.create();
  expect(t.checked(id).offense_type ?? [], "the lateness draft is not on Attendance").toContain("attendance_policy");
  return { thread, id };
}

function offAttendance(t: ReplayContext, id: string) {
  const values = t.values(id);
  expect(t.checked(id).offense_type ?? [], "the offense stayed Attendance").not.toContain("attendance_policy");
  expect(values.policy_violated ?? "", "Policy Violated stayed Attendance").not.toMatch(/attendance/i);
  expect(values.policy_language ?? "", "Direct policy stayed the Attendance text").not.toMatch(/arrives on time|punctuality/i);
  expect(values.action_plan ?? "", "the plan stayed the lateness plan").not.toMatch(/arrive on time|attendance/i);
  // Other is a box, not a policy: no plan says "review the Other policy".
  expect(values.action_plan ?? "", "the plan names Other as a policy").not.toMatch(/\bthe Other polic/i);
}

export const NOV13_ACCOUNT_CHANGE_REDERIVES_POLICY_CASES: ReplayCase[] = [
  {
    id: "nov13-account-change-rederives-policy-sanitation",
    title: `"${LATE}" then "${SANITATION}": the offense, Policy Violated, Direct policy and plan leave Attendance`,
    report: REPORT,
    status: { open: "the Observation is the sanitation, the offense, policy lines and plan stay Attendance" },
    fixFlags: [FLAG],
    async run(t) {
      const { thread, id } = await lateCa(t);
      t.patchReads!({
        [SANITATION]: patch("this_form", [
          { field: "observation", value: "Observed:\nTess Varga did not do the 10-minute sanitation.", how: "replace", evidence: "not doing the 10-minute sanitation" },
        ]),
      });
      await thread.say(SANITATION);
      expect(t.values(id).observation ?? "").toMatch(/10-minute sanitation/);
      offAttendance(t, id);
    },
  },
  {
    id: "nov13-account-change-rederives-policy-phone",
    title: `"${LATE}" then "${PHONE}": the policy lines and plan follow the phone account`,
    report: REPORT,
    status: { open: "the Observation is the phone use, the offense, policy lines and plan stay Attendance" },
    fixFlags: [FLAG],
    async run(t) {
      const { thread, id } = await lateCa(t);
      t.patchReads!({ [PHONE]: PHONE_PATCH("she was on her phone the whole shift") });
      await thread.say(PHONE);
      expect(t.values(id).observation ?? "").toMatch(/on her phone the whole shift/);
      offAttendance(t, id);
      expect(t.values(id).policy_violated ?? "", "Policy Violated is not the phone policy").toMatch(/cell phone/i);
    },
  },
  {
    id: "nov13-account-change-rederives-policy-named-policy-kept",
    title: `"${LATE}" then "${PHONE_NAMED}": the policy the manager named stays`,
    report: `${REPORT}; negative (QA: keep a policy the manager named explicitly)`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      const { thread, id } = await lateCa(t);
      t.patchReads!({ [PHONE_NAMED]: PHONE_PATCH("she was on her phone the whole shift") });
      await thread.say(PHONE_NAMED);
      expect(t.checked(id).offense_type ?? [], "the named Attendance policy was dropped").toContain("attendance_policy");
      expect(t.values(id).policy_violated ?? "", "the named Attendance policy was dropped").toMatch(/attendance/i);
    },
  },
];
