import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";
import { evidenceFrom, headingWith, lastResult, loopStandIn, type LoopDecision, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * THE FULL NAME THE MANAGER TYPED, NOT ITS FIRST WORD (port from Ask Bubbles #1025, R14)
 * ============================================================================
 *
 * The manager's turns, word for word (QA's own test name "Test Employee", nobody on the directory): T1 "create a written
 * corrective action for Team Member, Test Employee. Test was assigned to complete policy acknowledgements in woven by
 * 10-15-26 and failed to meet the deadline. Previous coaching was a Verbal CA 10-1-26. Payroll deduct is not applicable.",
 * T2 "name is Test Employee", T3 "this is a violation under Standards of Conduct". Every turn answered "I can't find
 * **Test** on your staff list. Reply **use Test** …": the model passed employee_name "Test" (from "Test was assigned …")
 * five times, never "Test Employee", and no card was made.
 *
 * Mechanism (`agent-loop/tools.ts`, the not_on_roster refusal): a one-word name that is the first word of exactly one
 * longer name the manager typed in this request (the app's own name reader over their turns) goes back with that full
 * name, once: propose again with it. The full name is then taken as typed (QA's c220/c224 rule) with the card's
 * off-roster line.
 */

const FLAG = "AGENT_LOOP_ENABLED";
const REPORT = "Port from Ask Bubbles (#1025): its QA's round 2 (22 Nov 2026, R14): \"… for Team Member, Test Employee. Test was assigned …\" asked \"use Test\" on every turn and never made a card";
const T1 =
  "create a written corrective action for Team Member, Test Employee. Test was assigned to complete policy acknowledgements in woven by 10-15-26 and failed to meet the deadline. Previous coaching was a Verbal CA 10-1-26. Payroll deduct is not applicable.";
const T2 = "name is Test Employee";

function start(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-11-21T18:00:00Z"));
  t.directory([...STAFF]);
  t.as("salon_director", KEARNEY);
}

const ACCOUNT = "Test was assigned to complete policy acknowledgements in Woven by 10/15/26 and failed to meet the deadline.";

/** The live model: employee_name "Test" until a refusal hands it a full name, then that name. */
const live = () =>
  loopStandIn((view: LoopView): LoopDecision => {
    const last = lastResult(view, "propose_form") as { reason_code?: string; full_name_typed?: string; card?: unknown } | null;
    if (last?.card) return { text: "Here's the Corrective Action Form." };
    if (last && !last.full_name_typed) return { text: String((last as { ask_exactly?: string }).ask_exactly ?? "Who is it for?") };
    const name = last?.full_name_typed ?? "Test";
    return {
      tool: "propose_form",
      input: { template_key: "dpoa", employee_name: name, what_happened: ACCOUNT, incident_date: "2026-10-15", policy: headingWith(view, /standards of conduct/i), person_evidence: evidenceFrom(view, name) },
    };
  });

export const NOV22_AGENT_LOOP_FULL_NAME_TYPED_CASES: ReplayCase[] = [
  {
    id: "nov22-r14-first-word-of-typed-full-name-gets-card",
    title: "R14: \"… for Team Member, Test Employee. Test was assigned …\" with the model passing \"Test\" — handed back with the full name the manager typed, and the card is for \"Test Employee\" (off-roster line), never \"use Test\" again",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      start(t);
      const thread = t.thread();
      const model = live();
      t.loopModel!(model);
      const said = await thread.say(T1);
      expect(said.content, "the reply asked \"use Test\"").not.toMatch(/use Test\*\*/);
      expect(thread.proposal?.employeeName, "no card for the full name the manager typed").toBe("Test Employee");
    },
  },
  {
    id: "nov22-r14-name-is-full-name-answer-gets-card",
    title: "R14, T2 \"name is Test Employee\" after the \"use Test\" offer: the card is made for \"Test Employee\"",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      start(t);
      const thread = t.thread();
      t.loopModel!(live());
      await thread.say(T1);
      await thread.say(T2);
      expect(thread.proposal?.employeeName).toBe("Test Employee");
    },
  },
];
