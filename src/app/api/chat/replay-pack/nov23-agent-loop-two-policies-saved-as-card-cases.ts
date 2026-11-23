import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayCase } from "./cases";
import { evidenceFrom, lastResult, loopStandIn, type LoopDecision } from "./loop-stand-in";

/**
 * ============================================================================
 * TWO POLICIES ON THE CARD ARE SAVED AS THE CARD SHOWS THEM (QA's f094, from the 21 Nov live retest, f075 / f093)
 * ============================================================================
 *
 * The card listed two policies joined by ";"; the saved Policy Violated read them joined by ",". A Corrective Action card
 * citing Late Opening and Time Records, then Create: the saved Policy Violated is the card's line. Invented person (on no
 * fixture): Wynfreda Pennycott.
 */

const REPORT = "QA's f094 (21 Nov 2026 live retest, f075 / f093): the card joined two policies with \";\" and the saved form with \",\"";
const WYNFREDA: DirectoryRow = { id: "e-wynfreda-pennycott", firstName: "Wynfreda", lastName: "Pennycott", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0309"], positionName: "Tanning Consultant" };
const ACCOUNT = "On 11/21/26 Wynfreda opened the salon 25 minutes late and stayed clocked in until 10:40 without approval.";
const TIME_RECORDS = { chunkIndex: 120, chunkId: "jba-120", locator: "Page 36 — Timekeeping & Payroll", page: 37, section: "Timekeeping & Payroll", printedPage: 36, sections: [{ page: 36, heading: "Timekeeping & Payroll" }, { page: 36, heading: "Time Records" }], content: "Timekeeping & Payroll\nEmployees record their own working time accurately.\nTime Records\nEmployees clock in at the start of their scheduled shift and clock out at its end, no more than a\nshort time after it unless a manager approves the extra time." };

export const NOV23_AGENT_LOOP_TWO_POLICIES_SAVED_AS_CARD_CASES: ReplayCase[] = [
  {
    id: "nov23-f094-two-policies-saved-as-the-card-shows",
    title: "f094: a written CA card citing Late Opening and Time Records: the saved Policy Violated is the card's line, both policies, joined as the card joins them",
    report: REPORT,
    status: "fixed",
    async run(t) {
      vi.setSystemTime(new Date("2026-11-22T18:00:00Z"));
      t.directory([...STAFF, WYNFREDA]);
      t.as("salon_director", KEARNEY);
      t.manualAlsoHas!([TIME_RECORDS]);
      t.loopModel!(loopStandIn((view): LoopDecision => (lastResult(view, "propose_form")
        ? { text: "Here's the Corrective Action Form." }
        : {
            tool: "propose_form",
            input: {
              template_key: "dpoa", employee_id: WYNFREDA.id, person_evidence: evidenceFrom(view, "Wynfreda Pennycott"),
              what_happened: ACCOUNT, incident_date: "2026-11-21", warning_level: "written", level_evidence: evidenceFrom(view, "written"),
              payroll_deduct: "no", payroll_evidence: evidenceFrom(view, "no payroll deduct"), policy: "Late Opening; Time Records",
            },
          })));
      const thread = t.thread();
      const reply = await thread.say("written CA for Wynfreda Pennycott, she opened the salon 25 minutes late on 11/21 and stayed clocked in until 10:40 without approval, no payroll deduct");
      const card = String((thread.proposal as { policyLine?: string | null } | null)?.policyLine ?? "");
      expect(card, `the card does not cite both policies (the case proves nothing):\n${reply.content}`).toMatch(/Late Opening.*;\s*.*Time Records/);
      const id = await thread.create();
      expect(t.values(id).policy_violated ?? "").toBe(card);
    },
  },
];
