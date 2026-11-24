import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayCase } from "./cases";
import { evidenceFrom, headingWith, lastResult, loopStandIn, type LoopDecision } from "./loop-stand-in";

/**
 * ============================================================================
 * THE SAVED POLICY VIOLATED IS THE LINE THE CARD SHOWS, MANUAL AND PAGE INCLUDED, EVERY HEADING (port from the sibling
 * app, its QA's live re-run A7 / U09; Pau's ruling, 23 Nov 2026, "add the page everywhere")
 * ============================================================================
 *
 * The card's policy line read "Standards of Conduct — Time Records, JBA Policy Manual p.36" and the saved Policy Violated
 * read "Standards of Conduct — Time Records": the heading listed in `readers-line-headings.ts` kept the readers' line,
 * without the manual and page (f071). Pau, 23 Nov 2026: the page everywhere. Invented person (on no fixture): Quennith
 * Marrowby.
 */

const REPORT = "Sibling app QA's live re-run (23 Nov 2026, A7 / U09) and Pau's ruling the same day: the saved policy_violated dropped \"JBA Policy Manual p.<n>\" the card showed";
const QUENNITH: DirectoryRow = { id: "e-quennith-marrowby", firstName: "Quennith", lastName: "Marrowby", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0309"], positionName: "Tanning Consultant" };

async function savedFor(t: Parameters<ReplayCase["run"]>[0], said: string, heading: RegExp, account: string) {
  vi.setSystemTime(new Date("2026-11-22T18:00:00Z"));
  t.directory([...STAFF, QUENNITH]);
  t.as("salon_director", KEARNEY);
  t.loopModel!(loopStandIn((view): LoopDecision => (lastResult(view, "propose_form")
    ? { text: "Here's the Corrective Action Form." }
    : {
        tool: "propose_form",
        input: {
          template_key: "dpoa", employee_id: QUENNITH.id, person_evidence: evidenceFrom(view, "Quennith Marrowby"),
          what_happened: account, incident_date: "2026-11-21", warning_level: "verbal", level_evidence: evidenceFrom(view, "verbal"),
          payroll_deduct: "no", payroll_evidence: evidenceFrom(view, "no payroll deduct"), policy: headingWith(view, heading),
        },
      })));
  const thread = t.thread();
  await thread.say(said);
  const card = String((thread.proposal as { policyLine?: string | null } | null)?.policyLine ?? "");
  const id = await thread.create();
  return { card, saved: t.values(id).policy_violated ?? "" };
}

export const NOV23_AGENT_LOOP_SAVED_POLICY_KEEPS_PAGE_CASES: ReplayCase[] = [
  {
    id: "nov23-saved-policy-violated-time-records-keeps-page",
    title: "Port (Pau, 23 Nov 2026, \"add the page everywhere\"): a verbal CA citing Time Records saves the card's \"Standards of Conduct — Time Records, JBA Policy Manual p.36\"",
    report: REPORT,
    status: "fixed",
    async run(t) {
      /* Time Records as the production manual's chunks lay it out (printed page 36), as the 17 Nov clock-out case does. */
      t.manualAlsoHas!([{ chunkIndex: 120, chunkId: "jba-120", locator: "Page 36 — Timekeeping & Payroll", page: 37, section: "Timekeeping & Payroll", printedPage: 36, sections: [{ page: 36, heading: "Timekeeping & Payroll" }, { page: 36, heading: "Time Records" }], content: "Timekeeping & Payroll\nEmployees record their own working time accurately.\nTime Records\nEmployees clock in at the start of their scheduled shift and clock out at its end, no more than a\nshort time after it unless a manager approves the extra time." }]);
      const { card, saved } = await savedFor(t, "verbal CA for Quennith Marrowby, she stayed clocked in until 10:40 on 11/21 without approval, time records, no payroll deduct", /^time records/i, "On 11/21/26 Quennith stayed clocked in until 10:40 without approval.");
      expect(card).toBe("Standards of Conduct — Time Records, JBA Policy Manual p.36");
      expect(saved).toBe(card);
    },
  },
];
