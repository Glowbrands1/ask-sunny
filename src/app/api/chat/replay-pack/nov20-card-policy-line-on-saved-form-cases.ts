import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";
import { evidenceFrom, lastResult, loopStandIn, type LoopDecision } from "./loop-stand-in";

/**
 * ============================================================================
 * THE SAVED POLICY VIOLATED IS THE CARD'S OWN POLICY LINE (QA f071, 20 Nov 2026; low)
 * ============================================================================
 *
 * Live test item 15 (conv_mwp35nup2qevrmq, saved 27a023a1 on Test Testy): the card and the reply said "Policy: Late
 * Opening Policy, JBA Policy Manual p.15"; the saved form's Policy Violated said "Attendance Policy — Late Opening". The
 * manager saw one label on the card and another on the form. The 18 Nov live fix wrote the card's line into Policy
 * Violated only when a Type of Offense label named the heading (Dress Code); a heading no label names (Late Opening,
 * Time Records) kept the readers' "<box> — <section>". General rule: a loop card's policy line is the saved Policy
 * Violated, word for word; the Type of Offense tick is left as the readers set it (Attendance Policy for Late Opening).
 * Time Records keeps "Standards of Conduct — Time Records", as Pau was last told (QA).
 */

const FLAG = "AGENT_LOOP_ENABLED";
const REPORT = "QA's live test item 15 (20 Nov 2026, conv_mwp35nup2qevrmq): card \"Late Opening Policy, JBA Policy Manual p.15\", saved Policy Violated \"Attendance Policy — Late Opening\"";
const offline = process.env.AGENT_LOOP_LIVE !== "1";

const DRAFTED = "Observed:\nRemy did not open the salon on time on 11/19.\n\nExpectation:\nRemy is expected to open on time.\n\nGoing Forward:\nRemy will open on time on every scheduled opening shift.";

function caFor(policy: string, account: string) {
  return loopStandIn((view): LoopDecision =>
    lastResult(view, "propose_form")
      ? { text: "Here's the Corrective Action Form for **Remy Calder**." }
      : { tool: "propose_form", input: { template_key: "dpoa", employee_name: "Remy Calder", person_evidence: evidenceFrom(view, "remy calder"), what_happened: account, policy, incident_date: "2026-11-19" } },
  );
}

async function created(t: ReplayContext, said: string, policy: string, account: string, ticked: string) {
  vi.setSystemTime(new Date("2026-11-20T15:00:00Z"));
  t.directory([...STAFF]);
  t.as("salon_director", KEARNEY);
  t.loopModel!(caFor(policy, account));
  t.draftWrites({ observation: DRAFTED }, { offense_type: [ticked] });
  const thread = t.thread();
  await thread.say(said);
  const line = (thread.proposal as { policyLine?: string } | null)?.policyLine ?? "";
  const id = await thread.create();
  return { id, line };
}

const fixed = (id: string, title: string, run: (t: ReplayContext) => Promise<void>): ReplayCase => ({
  id,
  title,
  report: REPORT,
  status: "fixed",
  fixFlags: [FLAG],
  async run(t) {
    if (!t.loopOn?.() || !offline) return;
    await run(t);
  },
});

export const NOV20_CARD_POLICY_LINE_ON_SAVED_FORM_CASES: ReplayCase[] = [
  fixed("nov20-card-policy-line-late-opening", "Card \"Late Opening Policy, JBA Policy Manual p.15\", Create: the saved Policy Violated is that line (never \"Attendance Policy — Late Opening\"); Type of Offense stays Attendance Policy", async (t) => {
    const { id, line } = await created(t, "ca for remy calder, she didn't open the salon on time on 11/19", "Late Opening", "Remy did not open the salon on time on 11/19.", "attendance_policy");
    expect(line).toBe("Late Opening Policy, JBA Policy Manual p.15");
    expect(t.values(id).policy_violated ?? "", "the saved Policy Violated is not the card's line").toBe(line);
    expect(t.checked(id).offense_type ?? []).toEqual(["attendance_policy"]);
  }),
  fixed("nov20-card-policy-line-time-records", "Card \"Time Records Policy, JBA Policy Manual p.36\" (staying after hours), the drafter ticking Standards of Conduct: Time Records keeps \"Standards of Conduct — Time Records\" (as Pau was told) and the box stays", async (t) => {
    /* Time Records as the production manual's chunks lay it out (printed page 36); copied from the 17 Nov clock-out case. */
    t.manualAlsoHas!([{ chunkIndex: 120, chunkId: "jba-120", locator: "Page 36 — Timekeeping & Payroll", page: 37, section: "Timekeeping & Payroll", printedPage: 36, sections: [{ page: 36, heading: "Timekeeping & Payroll" }, { page: 36, heading: "Time Records" }], content: "Timekeeping & Payroll\nEmployees record their own working time accurately.\nTime Records\nEmployees clock in at the start of their scheduled shift and clock out at its end, no more than a\nshort time after it unless a manager approves the extra time." }]);
    const { id, line } = await created(t, "ca for remy calder, stayed over hours until 9:53 on 11/19 without approval", "Time Records", "Remy stayed over hours until 9:53 on 11/19 without approval.", "standards_of_conduct");
    // Changed on purpose (QA2, 21 Nov 2026, c259 option (a)): a Time Records card names the box it is saved under, as the form does.
    expect(line).toBe("Standards of Conduct \u2014 Time Records, JBA Policy Manual p.36");
    /* QA (20 Nov 2026): Time Records is the one heading that keeps the readers' line (`READERS_LINE_HEADINGS`, draft route). */
    expect(t.values(id).policy_violated ?? "").toBe("Standards of Conduct — Time Records");
    expect(t.checked(id).offense_type ?? []).toEqual(["standards_of_conduct"]);
  }),
];
