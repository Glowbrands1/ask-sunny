import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayCase, type ReplayContext } from "./cases";

/**
 * ============================================================================
 * SHIFT DATES GIVEN IN A CA REQUEST REACH THE OBSERVATION (QA, Sunny live test, 8 Nov 2026)
 * ============================================================================
 *
 * The manager's words (the name invented and on no directory): "make me CA for Rhea failing to complete shifts" →
 * "Is this for **Rhea Calloway**? Tell me if that should change." → "make me CA for Rhea Calloway failing to complete
 * shifts 11/7 and 11/8" (also "… not showing up to her shifts on 11/7 and 11/8" and "Rhea Calloway 11/7 and 11/8").
 * The card cited Attendance, but its Observation was "failing to complete shifts": 11/7 and 11/8 were lost, and no date
 * question was asked. Gate runner 2 replayed it on round 5 and round 6 alike.
 * FIRST_NAME_ANSWER_KEEPS_ACCOUNT_ENABLED (`ai/first-name-suggest.ts`): the answer that names the person in full keeps
 * what it says besides the name. SHIFT_ACCOUNT_IS_INCIDENT_ENABLED (`forms/corrective-action-intake.ts`): "<name> not
 * showing up to her shifts on …" is an account.
 */
const RHEA: DirectoryRow = {
  id: "e-rhea-calloway",
  firstName: "Rhea",
  lastName: "Calloway",
  preferredFirstName: null,
  employmentStatus: "active",
  salonIds: ["loc-0309"],
  positionName: "Tanning Consultant",
};
const T1 = "make me CA for Rhea failing to complete shifts";
const FIX = ["FIRST_NAME_ANSWER_KEEPS_ACCOUNT_ENABLED", "SHIFT_ACCOUNT_IS_INCIDENT_ENABLED"];
const REPORT = "QA, Sunny live test, 8 Nov 2026 (gate runner 2: the same on round 5 and round 6)";

function observation(content: string): string {
  return /\*\*Observation of Offense:\*\*\s*([^\n]*)/.exec(content)?.[1] ?? "";
}

async function told(t: ReplayContext, answer: string) {
  vi.setSystemTime(new Date("2026-11-08T15:00:00Z"));
  t.directory([...STAFF, RHEA]);
  t.as("salon_director", KEARNEY);
  const thread = t.thread();
  const asked = await thread.say(T1);
  expect(asked.content, "the first name is not asked about").toMatch(/Is this for \*\*Rhea Calloway\*\*\?/);
  const reply = await thread.say(answer);
  expect(thread.proposal, `no Corrective Action card:\n${reply.content}`).toMatchObject({ templateKey: "dpoa", employeeName: "Rhea Calloway" });
  expect(observation(reply.content), `the shift dates are lost:\n${reply.content}`).toMatch(/11\/7 and 11\/8/);
  expect(reply.content, `no date question:\n${reply.content}`).toMatch(/Which date goes on the form\?/);
}

export const NOV8_CA_SHIFT_DATES_KEPT_CASES: ReplayCase[] = [
  {
    id: "nov8-ca-shift-dates-request-again",
    title: "\"Is this for Rhea Calloway?\" → \"make me CA for Rhea Calloway failing to complete shifts 11/7 and 11/8\": the dates reach the Observation",
    report: REPORT,
    // Changed on purpose (9 Nov 2026): fixed in production by FIRST_NAME_ANSWER_KEEPS_ACCOUNT_ENABLED and SHIFT_ACCOUNT_IS_INCIDENT_ENABLED, QA round 7.
    status: "fixed",
    fixFlags: FIX,
    run: (t) => told(t, "make me CA for Rhea Calloway failing to complete shifts 11/7 and 11/8"),
  },
  {
    id: "nov8-ca-shift-dates-not-showing-up",
    title: "→ \"make me CA for Rhea Calloway not showing up to her shifts on 11/7 and 11/8\": the dates reach the Observation",
    report: REPORT,
    // Changed on purpose (9 Nov 2026): fixed in production by FIRST_NAME_ANSWER_KEEPS_ACCOUNT_ENABLED and SHIFT_ACCOUNT_IS_INCIDENT_ENABLED, QA round 7.
    status: "fixed",
    fixFlags: FIX,
    run: (t) => told(t, "make me CA for Rhea Calloway not showing up to her shifts on 11/7 and 11/8"),
  },
  {
    id: "nov8-ca-shift-dates-name-and-dates",
    title: "→ \"Rhea Calloway 11/7 and 11/8\": the dates follow the request",
    report: REPORT,
    // Changed on purpose (9 Nov 2026): fixed in production by FIRST_NAME_ANSWER_KEEPS_ACCOUNT_ENABLED and SHIFT_ACCOUNT_IS_INCIDENT_ENABLED, QA round 7.
    status: "fixed",
    fixFlags: FIX,
    run: (t) => told(t, "Rhea Calloway 11/7 and 11/8"),
  },
  {
    id: "nov8-ca-shift-dates-name-only",
    title: "negative: → \"Rhea Calloway\": the card for the request as before, with no dates",
    report: `${REPORT} (the condition)`,
    status: "fixed",
    fixFlags: FIX,
    async run(t) {
      vi.setSystemTime(new Date("2026-11-08T15:00:00Z"));
      t.directory([...STAFF, RHEA]);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      await thread.say(T1);
      const reply = await thread.say("Rhea Calloway");
      expect(thread.proposal, `no Corrective Action card:\n${reply.content}`).toMatchObject({ templateKey: "dpoa", employeeName: "Rhea Calloway" });
      expect(observation(reply.content), `the account is lost:\n${reply.content}`).toMatch(/failing to complete shifts/);
    },
  },
];
