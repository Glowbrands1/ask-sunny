import { expect, vi } from "vitest";

import type { ChatFormProposal } from "@/types";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";
import { lastResult, loopStandIn, type LoopDecision, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * CLOCKING OUT EARLY IS ATTENDANCE; STAYING LATE IS TIME RECORDS (Pau's rulings via QA, 17 Nov 2026; Runner 2's c198, c259)
 * ============================================================================
 *
 * c198 T3: "… scheduled until 9:15PM and clocked out at 9:01. She also took down the spray booths down at 8:11 PM before
 * the Salon was closed." cited Standards of Conduct ("the JBA manual has no closing policy"). c259: "staying overhours
 * until 9:53 on 11/4 and 11/11 until 10:19 pm …" cited Standards of Conduct too. Pau: clocking out early / leaving before
 * the scheduled end is Attendance (one heading per card; the closing detail stays in the account); staying after hours /
 * clocking out more than 15 minutes after the shift without approval is the manual's Time Records section. Which heading
 * fits is the model's choice, taught by the rules book (no word list in code); these cases check what code owns: the rules
 * are in the model's instructions, the heading is the manual's own with its printed page, and the account keeps its detail.
 * Invented names only (Remy Calder).
 */

const FLAG = "AGENT_LOOP_ENABLED";
const REPORT = "Pau's rulings via QA (17 Nov 2026), Runner 2's c198 and c259 on train 4: clocking out early and staying after hours cited Standards of Conduct";

function start(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-11-17T00:10:00Z"));
  t.directory([...STAFF]);
  t.as("salon_director", KEARNEY);
}

const managerTurns = (view: LoopView) => view.turns.filter((turn) => turn.role === "user" && (turn.messageIds?.length ?? 0) > 0);
const quoted = (view: LoopView, quote: string) => ({ message_id: [...managerTurns(view)].reverse().find((turn) => turn.text.toLowerCase().includes(quote.toLowerCase()))?.messageIds?.at(-1) ?? "current", quote });
const card = (reply: { formProposal?: unknown }) => reply.formProposal as ChatFormProposal | undefined;

/** One CA card with the policy the rules book teaches; the system prompt it was given is kept for the check. */
function caWith(policy: string, account: string, date: string | null, systems: string[]) {
  return loopStandIn((view): LoopDecision => {
    systems.push(view.system);
    if (lastResult(view, "propose_form")) return { text: "Here's the Corrective Action Form for **Remy**." };
    return { tool: "propose_form", input: { template_key: "dpoa", employee_name: "Remy Calder", person_evidence: quoted(view, "Remy Calder"), what_happened: account, ...(date ? { incident_date: date } : {}), policy } };
  });
}

export const NOV17_AGENT_LOOP_CLOCK_OUT_POLICY_CASES: ReplayCase[] = [
  {
    id: "nov17-clock-out-early-is-attendance-c198",
    title: "c198 T3: \"Write a CA for Remy Calder she is TC … scheduled until 9:15PM and clocked out at 9:01. She also took down the spray booths down at 8:11 PM before the Salon was closed.\": the rules book teaches Attendance for clocking out early (closing detail kept in the account), and the card cites Attendance with its page",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      start(t);
      const systems: string[] = [];
      const account = "On 11/3/26 Remy was scheduled until 9:15PM and clocked out at 9:01. Remy also took down the spray booths at 8:11 PM before the salon was closed.";
      t.loopModel!(caWith("Attendance", account, "2026-11-03", systems));
      const reply = await t.thread().say("Write a CA for Remy Calder she is TC works at NE Kearney and on 11/3/26 she was scheduled until 9:15PM and clocked out at 9:01. She also took down the spray booths down at 8:11 PM before the Salon was closed.");
      expect(systems[0], "the clock-out rule is not in the model's instructions").toMatch(/Clocking out early or leaving before the end of the scheduled shift is Attendance/);
      expect(card(reply)?.policyLine ?? "", JSON.stringify(card(reply))).toMatch(/^Attendance Policy, JBA Policy Manual p\.\d+$/);
      expect(card(reply)?.issue ?? "", "the closing detail left the account").toMatch(/spray booths at 8:11 PM/);
    },
  },
  {
    id: "nov17-staying-after-hours-is-time-records-c259",
    title: "c259 T1: \"Please make me a CA form for Remy Calder for staying overhours until 9:53 on 11/4 and 11/11 until 10:19 pm. Remy said Remy was cleaning …\": the rules book teaches Time Records for staying after hours, the manual's own heading is accepted, and the card cites it with its page",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      start(t);
      /*
       * Timekeeping & Payroll with Time Records, as the production manual's chunks lay it out (printed page 36, running on to
       * 37). The pack's pinned manual has only the CA sections; this case adds the one it needs. Wording invented.
       */
      t.manualAlsoHas!([{ chunkIndex: 120, chunkId: "jba-120", locator: "Page 36 — Timekeeping & Payroll", page: 37, section: "Timekeeping & Payroll", printedPage: 36, sections: [{ page: 36, heading: "Timekeeping & Payroll" }, { page: 36, heading: "Time Records" }], content: "Timekeeping & Payroll\nEmployees record their own working time accurately.\nTime Records\nEmployees clock in at the start of their scheduled shift and clock out at its end, no more than a\nshort time after it unless a manager approves the extra time." }]);
      const systems: string[] = [];
      const account = "Stayed over hours until 9:53 on 11/4 and on 11/11 until 10:19 pm. Remy said Remy was cleaning, but it has been clear that we do not do extra cleaning after hours and this is not acceptable.";
      t.loopModel!(caWith("Time Records", account, null, systems));
      const reply = await t.thread().say("Please make me a CA form for Remy Calder for staying overhours until 9:53 on 11/4 and 11/11 until 10:19 pm. Remy said Remy was cleaning but it has been clear that we do not do extra cleaning after hours and this is not acceptable.");
      /*
       * QA (17 Nov 2026; the 266 re-run on main 33863575: c259 cited "Other — Staying after hours", c242 "Other — Closing
       * duties and staying over hours"): the rule names the heading as the policy to pass and rules out Other, and the
       * heading is checked as its own line of the headings list (a match anywhere could be the rule's own words).
       */
      expect(systems[0], "the after-hours rule is not in the model's instructions").toMatch(/Staying after hours \("staying over hours", working past close\), or clocking out more than fifteen minutes after the end of the scheduled shift without a manager's approval, is policy "Time Records", a heading in the list above .*never Attendance and never "Other — <topic>"\. When the manager also says closing duties were done while staying over, it is still Time Records/);
      expect(systems[0], "Time Records is not among the manual headings the model is given").toMatch(/^- Time Records$/m);
      expect(card(reply)?.policyLine ?? "", JSON.stringify(card(reply))).toMatch(/^Time Records Policy, JBA Policy Manual p\.\d+$/);
    },
  },
];
