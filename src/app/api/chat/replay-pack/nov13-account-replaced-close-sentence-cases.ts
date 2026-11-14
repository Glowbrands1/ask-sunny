import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayCase, type ReplayContext } from "./cases";
import { patch } from "./nov7-step-b-refusals-scenarios";

/**
 * ============================================================================
 * A TYPO OR DATE FIX IS NOT A NEW ACCOUNT (ACCOUNT_REPLACED_CLOSE_SENTENCE_KEPT_ENABLED)
 * ============================================================================
 *
 * Ported from Ask Bubbles. QA, 13 Nov 2026, follow-up to ACCOUNT_CHANGE_REDERIVES_POLICY: "accountReplaced() counts a close sentence as kept, so
 * small date or typo edits do not re-derive." With that flag on, an Observation edit whose old sentence is not still
 * there word for word reads as a new account, so a one-letter fix re-derives the policy: a Corrective Action drafted on
 * the Attendance policy, with an Observation about cell phone use, moves to Cell Phone when "shfit" becomes "shift" (the
 * saved Observation says "the cell phone" where the manager retypes "her cell phone"). On: the
 * fixed sentence is the same sentence and the policy stays. An account that really changed still re-derives (the
 * second case). The person is invented (on no directory).
 *
 * WHAT THIS REPLAY SHOWS, AND DOES NOT: the edit's reading is scripted (the manager's own corrected sentence). A date
 * said in the edit goes through the date path, which moves the Observation's date without this step; the date arm of
 * the close-sentence rule is covered by `forms/close-sentence.test.ts`.
 */

const NELL: DirectoryRow = { id: "e-nell-orrin-arc", firstName: "Nell", lastName: "Orrin", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0309"], positionName: "Tanning Consultant" };
const REQUEST = "create ca form for nell orrin for violating the attendance policy, she was late on 10/20/26 because she was on her phone. verbal. no payroll deduct.";
const TYPO_FIX = "change the observation to: Nell Orrin was on her cell phone the whole shift.";
const NEW_ACCOUNT = "change the observation to: Nell Orrin was rude to a customer at the register.";
const REPORT = "QA, 13 Nov 2026 (follow-up to ACCOUNT_CHANGE_REDERIVES_POLICY): \"accountReplaced() counts a close sentence as kept, so small date or typo edits do not re-derive\"";
const REDERIVE = "ACCOUNT_CHANGE_REDERIVES_POLICY_ENABLED";
const FLAG = "ACCOUNT_REPLACED_CLOSE_SENTENCE_KEPT_ENABLED";

async function attendanceCa(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-10-25T15:00:00Z"));
  t.directory([...STAFF, NELL]);
  t.as("salon_director", KEARNEY);
  const thread = t.thread();
  await thread.say(REQUEST);
  t.draftWrites({ observation: "Observed:\nNell Orrin was on her cell phone the whole shfit." });
  const id = await thread.create();
  expect(t.checked(id).offense_type ?? [], "the draft is not on Attendance").toContain("attendance_policy");
  return { thread, id };
}

async function typoFix(t: ReplayContext) {
    const { thread, id } = await attendanceCa(t);
    const before = { ...t.values(id) };
    t.patchReads!({
      [TYPO_FIX]: patch("this_form", [{ field: "observation", value: "Observed:\nNell Orrin was on her cell phone the whole shift.", how: "replace", evidence: "Nell Orrin was on her cell phone the whole shift" }]),
    });
    const reply = await thread.say(TYPO_FIX);
    expect(t.values(id).observation ?? "", "the typo fix was not saved").toMatch(/the whole shift\./);
    expect(t.checked(id).offense_type ?? [], `a typo fix moved the offense:\n${reply.content}`).toEqual(["attendance_policy"]);
    for (const key of ["policy_violated", "policy_language", "action_plan"]) {
      expect(t.values(id)[key] ?? "", `a typo fix moved ${key}:\n${reply.content}`).toBe(before[key] ?? "");
    }
}

/*
 * Ported from Ask Bubbles: Gate-Bubbles-5's probe on #876 (14 Nov 2026), its wording with an invented person: on an Attendance CA whose account
 * says "…texting on the cell phone the whole shift on 11/3/26", "in the observation change 11/3/26 to November 4, 2026"
 * moved the policy to Cell Phone with both flags on: the date written another way was three differing words. A date in
 * any form is one word now (`close-sentence.ts`).
 */
const DATE_REQUEST = "create ca form for nell orrin for violating the attendance policy, she was late on 11/3/26 because she was texting on her cell phone the whole shift. verbal. no payroll deduct.";
const DATE_FIX = "in the observation change 11/3/26 to November 4, 2026";
const DATE_REPORT = "Gate-Bubbles-5 on #876 (14 Nov 2026): \"in the observation change 11/3/26 to November 4, 2026\" moved an Attendance CA to Cell Phone with both flags on";

async function dateFix(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-11-10T15:00:00Z"));
  t.directory([...STAFF, NELL]);
  t.as("salon_director", KEARNEY);
  const thread = t.thread();
  await thread.say(DATE_REQUEST);
  t.draftWrites({ observation: "Observed:\nNell Orrin was texting on the cell phone the whole shift on 11/3/26." });
  const id = await thread.create();
  expect(t.checked(id).offense_type ?? [], "the draft is not on Attendance").toContain("attendance_policy");
  const before = { ...t.values(id) };
  t.patchReads!({
    [DATE_FIX]: patch("this_form", [{ field: "observation", value: "Observed:\nNell Orrin was texting on the cell phone the whole shift on November 4, 2026.", how: "replace", evidence: "change 11/3/26 to November 4, 2026" }]),
  });
  const reply = await thread.say(DATE_FIX);
  expect(t.values(id).observation ?? "", `the date fix was not saved:\n${reply.content}`).toMatch(/November 4, 2026/);
  expect(t.checked(id).offense_type ?? [], `a date fix moved the offense:\n${reply.content}`).toEqual(["attendance_policy"]);
  for (const key of ["policy_violated", "policy_language", "action_plan"]) {
    expect(t.values(id)[key] ?? "", `a date fix moved ${key}:\n${reply.content}`).toBe(before[key] ?? "");
  }
}

export const NOV13_ACCOUNT_REPLACED_CLOSE_SENTENCE_CASES: ReplayCase[] = [
  {
    id: "nov13-account-replaced-close-sentence-typo-rederives-before-fix",
    title: `"${REQUEST}" then "${TYPO_FIX}" (a one-letter fix), ACCOUNT_CHANGE_REDERIVES_POLICY alone: the policy moves`,
    report: REPORT,
    status: "fixed",
    fixFlags: [REDERIVE],
    fixStatus: { open: "the typo fix re-derives the policy: Attendance moves to Cell Phone" },
    // Changed on purpose (QA, on Gate-Sunny-2's #956 verdict, 14 Nov 2026): this case records the before-fix bug, so its
    // fix-flag run pins the close-sentence flag off even when that flag is on globally. Its production run is not pinned.
    fixOffFlags: [FLAG],
    run: typoFix,
  },
  {
    id: "nov13-account-replaced-close-sentence-typo-keeps-policy",
    title: `"${REQUEST}" then "${TYPO_FIX}" (a one-letter fix): the Attendance policy, its lines and plan stay`,
    report: REPORT,
    status: "fixed",
    fixFlags: [REDERIVE, FLAG],
    run: typoFix,
  },
  {
    id: "nov13-account-replaced-close-sentence-new-account-still-rederives",
    title: `"${REQUEST}" then "${NEW_ACCOUNT}": a changed account still leaves Attendance with both flags on`,
    report: `${REPORT}; negative (a real account change still re-derives)`,
    status: { open: "production has ACCOUNT_CHANGE_REDERIVES_POLICY off: a changed account keeps Attendance" },
    fixFlags: [REDERIVE, FLAG],
    async run(t) {
      const { thread, id } = await attendanceCa(t);
      t.patchReads!({
        [NEW_ACCOUNT]: patch("this_form", [{ field: "observation", value: "Observed:\nNell Orrin was rude to a customer at the register.", how: "replace", evidence: "Nell Orrin was rude to a customer at the register" }]),
      });
      await thread.say(NEW_ACCOUNT);
      expect(t.checked(id).offense_type ?? [], "a changed account kept Attendance").not.toContain("attendance_policy");
    },
  },
  {
    id: "nov14-account-replaced-close-sentence-date-rewritten-keeps-policy",
    title: `"${DATE_REQUEST}" then "${DATE_FIX}" (only the date, written another way): the Attendance policy, its lines and plan stay`,
    report: DATE_REPORT,
    status: "fixed",
    fixFlags: [REDERIVE, FLAG],
    run: dateFix,
  },
  {
    id: "nov14-account-replaced-close-sentence-date-rewritten-before-fix",
    title: `"${DATE_REQUEST}" then "${DATE_FIX}", ACCOUNT_CHANGE_REDERIVES_POLICY alone: the policy moves`,
    report: DATE_REPORT,
    status: "fixed",
    fixFlags: [REDERIVE],
    fixStatus: { open: "the date fix re-derives the policy: Attendance moves to Cell Phone" },
    // Changed on purpose (QA, on Gate-Sunny-2's #956 verdict, 14 Nov 2026): this case records the before-fix bug, so its
    // fix-flag run pins the close-sentence flag off even when that flag is on globally. Its production run is not pinned.
    fixOffFlags: [FLAG],
    run: dateFix,
  },
];
