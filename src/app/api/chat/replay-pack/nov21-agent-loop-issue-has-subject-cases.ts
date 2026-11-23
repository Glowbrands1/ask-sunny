import { expect, vi } from "vitest";

import type { ChatFormProposal } from "@/types";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";
import { evidenceFrom, lastResult, loopStandIn, type LoopDecision, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * THE CARD'S ISSUE LINE IS A SENTENCE ABOUT THE PERSON (port from the sibling app: its QA's live re-test of the loop,
 * 21 Nov 2026, A5)
 * ============================================================================
 *
 * The sibling's QA (loop on): "Card issue line has no subject: "Opening <place> late on 10-1-26."" for "create verbal ca
 * for <name> for opening <place> late on 10-1-26. previous coaching is jba policy manual 1-1-26. payroll deduct DOES
 * apply and state $25 will be payroll deducted". Expected: "<First> opened the <place> late on 10/1/26." The live model
 * put the request's for-clause in what_happened as typed. propose_form now hands a subjectless account back
 * (`account_no_subject`, `card-account.ts`), and writes a dashed date as the issue line writes dates. The stand-in sends
 * the for-clause first, as the live model did, and writes the sentence again when handed it back. Remy Calder is the
 * pack's invented person.
 */

const FLAG = "AGENT_LOOP_ENABLED";
const LIVE = process.env.AGENT_LOOP_LIVE === "1";
const REPORT = "Port from the sibling app (its QA's live re-test, 21 Nov 2026, A5, loop on): \"Card issue line has no subject: \\\"Opening <place> late on 10-1-26.\\\"\"";
const SAID = "create verbal ca for remy calder for opening the salon late on 10-1-26. previous coaching is jba policy manual 1-1-26. payroll deduct DOES apply and state $25 will be payroll deducted";

function start(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-11-21T18:40:00Z"));
  t.directory([...STAFF]);
  t.as("salon_director", KEARNEY);
}

const proposals = (view: LoopView) => view.results.filter((result) => result.tool === "propose_form").map((result) => result.output);

/** The live model's account first; handed back `account_no_subject`, the sentence with the first name as its subject. */
const liveModel = () =>
  loopStandIn((view): LoopDecision => {
    const handedBack = proposals(view).some((output) => output.reason_code === "account_no_subject");
    if (!lastResult(view, "propose_form") || (handedBack && !proposals(view).some((output) => output.card))) {
      return {
        tool: "propose_form",
        input: {
          template_key: "dpoa",
          employee_name: "remy calder",
          person_evidence: evidenceFrom(view, "remy calder"),
          warning_level: "verbal",
          level_evidence: evidenceFrom(view, "verbal"),
          what_happened: handedBack ? "Remy opened the salon late on 10-1-26." : "Opening the salon late on 10-1-26.",
          incident_date: "2026-10-01",
        },
      };
    }
    return { text: "Here's the Corrective Action Form for **Remy**." };
  });

export const NOV21_AGENT_LOOP_ISSUE_HAS_SUBJECT_CASES: ReplayCase[] = [
  {
    id: "nov21-agent-loop-issue-line-has-subject",
    title: `"${SAID}": the model sends "Opening the salon late on 10-1-26."; the card's issue line is "Remy opened the salon late on 10/1/26."`,
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      start(t);
      const model = liveModel();
      t.loopModel!(model);
      const reply = await t.thread().say(SAID);
      const card = reply.formProposal as ChatFormProposal | undefined;
      expect(card, "no card was made (the case proves nothing)").toBeTruthy();
      expect(card?.issue, `the issue line:\n${card?.issue}`).toBe("Remy opened the salon late on 10/1/26.");
      // QA's live run (22 Nov 2026): the real model wrote the subject the first time ("Remy opened the salon late on
      // 10/1/26."), so nothing was handed back. The issue line above is what the manager sees; the hand-back is the
      // stand-in's path (its first account has no subject) and is asserted there.
      if (!LIVE) expect(model.views.flatMap(proposals).some((output) => output.reason_code === "account_no_subject"), "the subjectless account was never handed back").toBe(true);
    },
  },
];
