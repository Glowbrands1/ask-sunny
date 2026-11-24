import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";
import { evidenceFrom, lastResult, loopStandIn, type LoopDecision, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * "WE DO NOT DO EXTRA CLEANING AFTER HOURS" IS A RULE, NOT A CLEANING DUTY LEFT UNDONE (QA, 20 Nov 2026: c259)
 * ============================================================================
 *
 * c259: "Please make me a CA form for <A> for staying overhours … <A> said <A> was cleaning but it has been clear that we
 * do not do extra cleaning after hours and this is not acceptable." propose_form told the model cleaning_duty "not do
 * extra cleaning", a cleaning duty left undone (whose policy is "Other — <topic>"), which pulled the card toward Other.
 * The manager stated the salon's rule ("we do not do …"); the employee left nothing undone. A rule said with "we", "you",
 * "employees" or "staff" before the "not" is never a cleaning duty; "she did not do the 10 minute cleaning" still is.
 * Invented names only (Remy Calder).
 */

const FLAG = "AGENT_LOOP_ENABLED";
const REPORT = "QA (20 Nov 2026), Coding-C's side finding on Runner 2's c259: a stated rule read as a cleaning duty left undone";

/** Timekeeping & Payroll with Time Records, as the production manual's chunks lay it out (wording invented). */
const TIME_RECORDS_CHUNK = { chunkIndex: 120, chunkId: "jba-120", locator: "Page 36 — Timekeeping & Payroll", page: 37, section: "Timekeeping & Payroll", printedPage: 36, sections: [{ page: 36, heading: "Timekeeping & Payroll" }, { page: 36, heading: "Time Records" }], content: "Timekeeping & Payroll\nEmployees record their own working time accurately.\nTime Records\nEmployees clock in at the start of their scheduled shift and clock out at its end, no more than a\nshort time after it unless a manager approves the extra time." };

function start(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-11-20T00:10:00Z"));
  t.directory([...STAFF]);
  t.as("salon_director", KEARNEY);
  t.manualAlsoHas!([TIME_RECORDS_CHUNK]);
}

/** One CA card with the given account and policy; the propose_form result is kept. */
function oneCard(account: string, policy: string, seen: Record<string, unknown>[]) {
  return loopStandIn((view: LoopView): LoopDecision => {
    const result = lastResult(view, "propose_form");
    if (result) {
      seen.push(result);
      return { text: "Here's the Corrective Action Form for **Remy**." };
    }
    return { tool: "propose_form", input: { template_key: "dpoa", employee_name: "Remy Calder", person_evidence: evidenceFrom(view, "Remy Calder"), what_happened: account, policy } };
  });
}

const factsOf = (result: Record<string, unknown> | undefined) => (result?.facts ?? {}) as Record<string, unknown>;

const fixed = (id: string, title: string, run: (t: ReplayContext) => Promise<void>): ReplayCase => ({
  id,
  title,
  report: REPORT,
  status: "fixed",
  fixFlags: [FLAG],
  async run(t) {
    if (!t.loopOn?.()) return;
    start(t);
    await run(t);
  },
});

export const NOV20_AGENT_LOOP_RULE_NOT_CLEANING_DUTY_CASES: ReplayCase[] = [
  fixed("nov20-rule-not-cleaning-duty-c259", "c259: \"… Remy said Remy was cleaning but it has been clear that we do not do extra cleaning after hours and this is not acceptable.\": propose_form gives no cleaning_duty fact, and the card cites Time Records alone", async (t) => {
    const seen: Record<string, unknown>[] = [];
    t.loopModel!(oneCard("Stayed over hours until 9:53 on 11/4 and on 11/11 until 10:19 pm. Remy said Remy was cleaning, but it has been clear that we do not do extra cleaning after hours and this is not acceptable.", "Time Records", seen));
    const reply = await t.thread().say("Please make me a CA form for Remy Calder for staying overhours until 9:53 on 11/4 and 11/11 until 10:19 pm. Remy said Remy was cleaning but it has been clear that we do not do extra cleaning after hours and this is not acceptable.");
    expect(factsOf(seen[0]).cleaning_duty, JSON.stringify(seen[0])).toBeUndefined();
    // Changed on purpose (QA2, 21 Nov 2026, c259 option (a)): a Time Records card names the box it is saved under, as the form does.
    expect(String((reply.formProposal as { policyLine?: string } | undefined)?.policyLine ?? "")).toMatch(/^Standards of Conduct \u2014 Time Records, JBA Policy Manual p\.\d+$/);
  }),
  fixed("nov20-rule-not-cleaning-duty-control-employee-did-not-clean", "Control: \"CA for Remy Calder, she did not do the 10 minute cleaning on the beds today\": propose_form still gives the cleaning_duty fact", async (t) => {
    const seen: Record<string, unknown>[] = [];
    t.loopModel!(oneCard("She did not do the 10 minute cleaning on the beds today.", "Other — 10 minute cleaning", seen));
    await t.thread().say("CA for Remy Calder, she did not do the 10 minute cleaning on the beds today");
    expect(factsOf(seen[0]).cleaning_duty, JSON.stringify(seen[0])).toBeDefined();
  }),
];
