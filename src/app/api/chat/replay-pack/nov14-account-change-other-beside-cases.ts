import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayCase, type ReplayContext } from "./cases";
import { patch } from "./nov7-step-b-refusals-scenarios";

/**
 * ============================================================================
 * A CLEANING DUTY BESIDE A NEW ACCOUNT'S OFFENSE TICKS BOTH, AS AT CREATE (ACCOUNT_CHANGE_OTHER_BESIDE_ENABLED)
 * ============================================================================
 *
 * Gate-Bubbles-5's finding in the sibling app (14 Nov 2026, via QA), the same here: on an existing lateness draft,
 * "change the issue to she was on her phone and did not do the sanitation" re-derived to Other ONLY (Policy Violated
 * "Other", the plan "applicable company policy", the phone dropped), while a Create from the same words ticks Cell Phone
 * and Other (OTHER_BESIDE_DESCRIBED, QA's ruling (b)). The re-derive read the cleaning duty first. On: the offense is
 * read from the account without the cleaning duty, and Other is ticked beside it. A cleaning duty alone stays Other
 * alone (`nov13-account-change-rederives-policy-sanitation`). The person is invented (on no directory).
 */

const TESS: DirectoryRow = { id: "e-tess-varga-acr", firstName: "Tess", lastName: "Varga", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0309"], positionName: "Tanning Consultant" };
const LATE = "create ca form for tess varga for violating attendance policy, she was late on 10/20/26. verbal. no payroll deduct.";
const PHONE_AND_SANITATION = "change the issue to she was on her phone and did not do the sanitation";
// No date in this wording: a date said in an edit goes through the date path, which moves only the date (see the note to QA).
const LATE_AND_SANITATION = "change the issue to she was late to her shift and did not do the sanitation";
const REPORT = "Gate-Bubbles-5 via QA, 14 Nov 2026: \"change the issue to she was on her phone and did not do the sanitation\" on a lateness draft re-derived to Other only; at Create the same words tick Cell Phone and Other";
const FLAGS = ["ACCOUNT_CHANGE_REDERIVES_POLICY_ENABLED", "ACCOUNT_CHANGE_OTHER_BESIDE_ENABLED"];

async function lateCa(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-11-10T15:00:00Z"));
  t.directory([...STAFF, TESS]);
  t.as("salon_director", KEARNEY);
  const thread = t.thread();
  await thread.say(LATE);
  t.draftWrites({ observation: "Observed:\nTess Varga was late on October 20, 2026." });
  const id = await thread.create();
  expect(t.checked(id).offense_type ?? [], "the lateness draft is not on Attendance").toContain("attendance_policy");
  return { thread, id };
}

export const NOV14_ACCOUNT_CHANGE_OTHER_BESIDE_CASES: ReplayCase[] = [
  {
    id: "nov14-account-change-other-beside-phone",
    title: `"${LATE}" then "${PHONE_AND_SANITATION}": Cell Phone and Other are ticked, and the policy lines and plan follow the phone`,
    report: REPORT,
    status: { open: "production has ACCOUNT_CHANGE_REDERIVES_POLICY off: the offense, policy lines and plan stay Attendance" },
    fixFlags: FLAGS,
    async run(t) {
      const { thread, id } = await lateCa(t);
      t.patchReads!({
        [PHONE_AND_SANITATION]: patch("this_form", [
          { field: "observation", value: "Observed:\nShe was on her phone and did not do the sanitation.", how: "replace", evidence: "she was on her phone and did not do the sanitation" },
        ]),
      });
      const reply = await thread.say(PHONE_AND_SANITATION);
      const values = t.values(id);
      const boxes = t.checked(id).offense_type ?? [];
      expect(boxes, `Other is not ticked:\n${reply.content}`).toContain("other");
      expect(boxes, `the phone was dropped (Other alone):\n${reply.content}`.slice(0, 2000)).not.toEqual(["other"]);
      expect(boxes, "the offense stayed Attendance").not.toContain("attendance_policy");
      expect(values.policy_violated ?? "", "Policy Violated does not name the phone policy").toMatch(/cell phone/i);
      expect(values.policy_violated ?? "", "Policy Violated does not record Other").toMatch(/\bOther\b/);
      expect(values.policy_language ?? "", "Direct policy is not the phone section").toMatch(/phone/i);
      expect(values.action_plan ?? "", "the plan does not follow the phone policy").toMatch(/cell phone/i);
      expect(values.action_plan ?? "", "the plan names Other as a policy").not.toMatch(/\bthe Other polic/i);
    },
  },
  {
    id: "nov14-account-change-other-beside-late",
    title: `"${LATE}" then "${LATE_AND_SANITATION}": the lateness keeps Attendance, and Other is ticked beside it`,
    report: `${REPORT}; the lateness wording of ruling (b)`,
    status: { open: "production has ACCOUNT_CHANGE_REDERIVES_POLICY off: Other is never added on an edit" },
    fixFlags: FLAGS,
    async run(t) {
      const { thread, id } = await lateCa(t);
      t.patchReads!({
        [LATE_AND_SANITATION]: patch("this_form", [
          { field: "observation", value: "Observed:\nShe was late to her shift and did not do the sanitation.", how: "replace", evidence: "she was late to her shift and did not do the sanitation" },
        ]),
      });
      const reply = await thread.say(LATE_AND_SANITATION);
      const boxes = t.checked(id).offense_type ?? [];
      expect(boxes, `Other is not ticked:\n${reply.content}`).toContain("other");
      expect(boxes, `the lateness was dropped:\n${reply.content}`).not.toEqual(["other"]);
      expect(t.values(id).policy_violated ?? "", "Policy Violated lost Attendance").toMatch(/attendance|tardiness/i);
      expect(t.values(id).action_plan ?? "", "the plan names Other as a policy").not.toMatch(/\bthe Other polic/i);
    },
  },
];
