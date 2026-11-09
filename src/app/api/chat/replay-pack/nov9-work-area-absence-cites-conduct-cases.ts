import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayCase, type ReplayContext } from "./cases";

/**
 * ============================================================================
 * LEAVING THE FRONT DESK UNATTENDED IS THE STANDARDS OF CONDUCT, NOT ATTENDANCE (Pau's decision, 9 Nov 2026)
 * ============================================================================
 *
 * Ported from the sibling app: QA's live round-6 trace there (9 Nov 2026; the people invented): a card for "leaving the front desk unattended
 * on 11/6/26" cited "Attendance Policy, JBA Policy Manual p.14": no reader of the code knew the incident, so the model's
 * heading stood. Pau: it is the Standards of Conduct's "Unauthorized absence from the work area during the workday", and
 * only that, whatever else the account says (leaving the building, going to the car); Attendance does not apply.
 * WORK_AREA_ABSENCE_CITES_CONDUCT_ENABLED (`forms/specific-policy-topics.ts`, `forms/coaching-card-policy.ts`). Pages
 * are the pack's manual's printed pages (its wording invented): the line on 13.
 */
const MAVE: DirectoryRow = {
  id: "e-mave-thistlewood",
  firstName: "Mave",
  lastName: "Thistlewood",
  preferredFirstName: null,
  employmentStatus: "active",
  salonIds: ["loc-0309"],
  positionName: "Tanning Consultant",
};
const FIX = ["WORK_AREA_ABSENCE_CITES_CONDUCT_ENABLED"];
const REPORT = "Pau's decision via QA, 9 Nov 2026 (QA's live round-6 trace: \"Attendance Policy, JBA Policy Manual p.14\")";
const OPEN = { open: "no section of the manual is cited: the card falls to the model's heading (live: Attendance p.14)" };

/*
 * The pack's manual (wording invented) words its Standards of Conduct line differently, and other suites pin that chunk
 * as it is: the line the topic is cited by is given here, on printed page 13, inside the Standards of Conduct.
 */
const WORK_AREA_LINE = {
  chunkIndex: 39.5,
  chunkId: "jba-39-5",
  locator: "Page 13 — Standards of Conduct",
  page: 14,
  content: "o Unapproved absence from the work area during a shift",
  section: "Standards of Conduct",
  printedPage: 13,
  sections: [],
};

function start(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-11-08T19:40:00Z"));
  t.directory([...STAFF, MAVE]);
  t.as("salon_director", KEARNEY);
  t.manualAlsoHas?.([WORK_AREA_LINE]);
  return t.thread();
}

const policyLine = (content: string) => /\*\*Policy:\*\*[^\n]*/.exec(content)?.[0] ?? "";

export const NOV9_WORK_AREA_ABSENCE_CITES_CONDUCT_CASES: ReplayCase[] = [
  {
    id: "nov9-work-area-absence-ca",
    title: "a CA for \"left the front desk unattended on 11/6/26\": the card and the saved form cite the Standards of Conduct, never Attendance",
    report: REPORT,
    status: OPEN,
    fixFlags: FIX,
    async run(t) {
      const thread = start(t);
      const reply = await thread.say("create a ca for Mave Thistlewood, she left the front desk unattended on 11/6/26");
      expect(policyLine(reply.content), `the card's Policy line:\n${reply.content}`).toMatch(/Standards of Conduct[^\n]*page 13/);
      expect(reply.content, "the card cites Attendance").not.toMatch(/Attendance/);
      const id = await thread.create();
      const saved = t.values(id);
      expect(saved.policy_violated ?? "", "Policy Violated").toBe("Standards of Conduct");
      expect(saved.policy_language ?? "", "Direct policy").toMatch(/absence from the work area[\s\S]*Standards of Conduct, p\. 13/);
      expect(`${saved.policy_violated} ${saved.policy_language}`, "the saved form cites Attendance").not.toMatch(/Attendance/);
    },
  },
  {
    id: "nov9-work-area-absence-left-the-building",
    title: "a CA for \"left the front desk unattended and went to her car\": the Standards of Conduct only (Pau, 9 Nov 2026)",
    report: REPORT,
    status: OPEN,
    fixFlags: FIX,
    async run(t) {
      const thread = start(t);
      const reply = await thread.say("create a ca for Mave Thistlewood, she left the front desk unattended and went to her car");
      expect(policyLine(reply.content), `the card's Policy line:\n${reply.content}`).toMatch(/Standards of Conduct[^\n]*page 13/);
      const id = await thread.create();
      const saved = t.values(id);
      expect(policyLine(reply.content), "the card names the Meal and Rest Policy").not.toMatch(/Meal and Rest/);
      expect(saved.policy_violated ?? "", "Policy Violated").toBe("Standards of Conduct");
      expect(saved.policy_language ?? "", "Direct policy").toMatch(/absence from the work area[\s\S]*Standards of Conduct, p\. 13/);
      expect(saved.policy_language ?? "", "Direct policy cites the Meal and Rest Policy").not.toMatch(/Meal and Rest/);
      expect(`${saved.policy_violated} ${saved.policy_language}`, "the saved form cites Attendance").not.toMatch(/Attendance/);
    },
  },
  {
    id: "nov9-work-area-absence-coaching-card",
    title: "a Coaching card for \"left the front desk unattended on 11/6/26\": the Standards of Conduct by its printed page",
    report: REPORT,
    status: OPEN,
    fixFlags: FIX,
    async run(t) {
      const thread = start(t);
      const reply = await thread.say("create a coaching form for Mave Thistlewood, she left the front desk unattended on 11/6/26");
      expect(thread.proposal?.templateKey, "no Coaching card").toBe("coaching");
      expect(reply.content, `the card's citation:\n${reply.content}`).toMatch(/Standards of Conduct Policy, JBA Policy Manual p\.13/);
      expect(reply.content, "the card cites Attendance").not.toMatch(/Attendance/);
    },
  },
  {
    id: "nov9-work-area-absence-coaching-made-about",
    title: "a Coaching card about a missed meeting, then \"make it about leaving the front desk unattended on 11/6/26\": the Standards of Conduct, not the meeting's Attendance",
    report: REPORT,
    status: { open: "the card cites Attendance p.14, read from the missed meeting before the \"make it about\"" },
    fixFlags: FIX,
    async run(t) {
      const thread = start(t);
      await thread.say("create a coaching form for Mave Thistlewood, she missed the monthly meeting on 10/10/26");
      const reply = await thread.say("make it about leaving the front desk unattended on 11/6/26");
      expect(reply.content, `the card's citation:\n${reply.content}`).toMatch(/Standards of Conduct Policy, JBA Policy Manual p\.13/);
      expect(reply.content, "the card cites Attendance").not.toMatch(/Attendance Policy/);
    },
  },
  ...[
    ["nov9-work-area-absence-late-stays-attendance", "create a ca for Mave Thistlewood, she was late to her shift on 11/6/26"],
    ["nov9-work-area-absence-no-show-stays-attendance", "create a ca for Mave Thistlewood, she was a no call no show on 11/6/26"],
  ].map(
    ([id, said]): ReplayCase => ({
      id: id!,
      title: `negative: "${said}" stays Attendance`,
      report: `${REPORT} (the condition: Attendance still applies to lateness and absence)`,
      status: "fixed",
      fixFlags: FIX,
      async run(t) {
        const thread = start(t);
        const reply = await thread.say(said!);
        expect(policyLine(reply.content), `the card's Policy line:\n${reply.content}`).toMatch(/^\*\*Policy:\*\* Attendance\b/);
      },
    }),
  ),
];
