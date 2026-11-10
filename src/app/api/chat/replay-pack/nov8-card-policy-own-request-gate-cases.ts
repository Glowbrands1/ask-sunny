import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayAnswer, type ReplayCase, type ReplayContext } from "./cases";

/**
 * ============================================================================
 * CARD_POLICY_OWN_REQUEST: A NAME-ONLY ANSWER KEEPS THE REQUEST'S POLICY (QA's Sunny round-4 add-on gate, 8 Nov 2026)
 * ============================================================================
 *
 * The gate dropped CARD_POLICY_OWN_REQUEST (#639):
 * (1) "can you create a coaching form for attendance policy" → "<name>": the second turn reaches the policy step with
 *     the app's slot lines ahead of it ("The form is the Coaching Form. The employee is <name>. …"), which read as a new
 *     request for <name>; the first turn was cut and the card cited nothing (Attendance p.14 with the flag off). The
 *     same for "I need to make a corrective action for msb" → "<name>" (Standards of Conduct p.12).
 * (2) An apostrophe name ("O'Dallagher") made the name pattern throw, so the policy step was skipped and the Action
 *     Plan read "the applicable company policy".
 * The managers' words; the people are the pack's invented ones (`ai/card-policy-request.ts`).
 */
const FIX = ["CARD_POLICY_OWN_REQUEST_ENABLED"];
const REPORT = "QA's Sunny round-4 add-on gate, 8 Nov 2026 (CARD_POLICY_OWN_REQUEST)";

function person(id: string, firstName: string, lastName: string): DirectoryRow {
  return { id, firstName, lastName, preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0309"], positionName: "Tanning Consultant" };
}
const PERRIN = person("e-perrin-fennimore-639", "Perrin", "Fennimore");
const THADDEUS = person("e-thaddeus-quillane-639", "Thaddeus", "Quillane");
const CAOIMHE = person("e-caoimhe-odallagher-639", "Caoimhe", "O'Dallagher");

function start(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-11-04T15:30:00Z"));
  t.directory([...STAFF, PERRIN, THADDEUS, CAOIMHE]);
  t.as("salon_director", KEARNEY);
  return t.thread();
}

function actionPlan(reply: ReplayAnswer): string {
  return /\*\*Action Plan:\*\*[^\n]*/.exec(reply.content)?.[0] ?? "";
}

export const NOV8_CARD_POLICY_OWN_REQUEST_GATE_CASES: ReplayCase[] = [
  {
    id: "nov8-639-name-answer-keeps-attendance",
    title: "\"can you create a coaching form for attendance policy\" → \"<name>\": the card still cites Attendance p.14",
    report: `${REPORT} (nov7-refusal-sun-monthly-meeting t2)`,
    status: "fixed",
    fixFlags: FIX,
    async run(t) {
      const thread = start(t);
      await thread.say("can you create a coaching form for attendance policy");
      const reply = await thread.say("Perrin Fennimore");
      expect(thread.proposal, `no Coaching card:\n${reply.content}`).toMatchObject({ employeeName: "Perrin Fennimore" });
      expect(reply.content, `the policy asked for is lost:\n${reply.content}`).toMatch(/Attendance Policy, JBA Policy Manual p\.14/);
    },
  },
  {
    id: "nov8-639-name-answer-keeps-standards-of-conduct",
    title: "\"I need to make a corrective action for msb\" → \"<name>\": the card still cites Standards of Conduct p.12",
    report: `${REPORT} (nov4-pau5-2-ca-for-msb t2)`,
    status: "fixed",
    fixFlags: FIX,
    async run(t) {
      const thread = start(t);
      await thread.say("I need to make a corrective action for msb");
      const reply = await thread.say("Thaddeus Quillane");
      expect(reply.content, `the policy asked for is lost:\n${reply.content}`).toMatch(/Standards of Conduct Policy, JBA Policy Manual p\.12/);
      expect(actionPlan(reply), `the Action Plan fell back:\n${reply.content}`).not.toMatch(/the applicable company policy/i);
    },
  },
  {
    id: "nov8-639-apostrophe-name-keeps-action-plan",
    title: "\"create a ca form for Caoimhe O'Dallagher, they were late opening the salon on 11/2\": the Action Plan reviews the Late Opening policy",
    report: `${REPORT} (nov6-roster-shape-apostrophe-*)`,
    status: "fixed",
    fixFlags: FIX,
    async run(t) {
      const thread = start(t);
      const reply = await thread.say("create a ca form for Caoimhe O'Dallagher, they were late opening the salon on 11/2");
      expect(actionPlan(reply), `the Action Plan fell back:\n${reply.content}`).toMatch(/review the Late Opening policy/i);
    },
  },
];
