import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";
import { evidenceFrom, lastResult, loopStandIn, type LoopDecision, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * THE ANSWER TO "WHO IS THIS EXIT FORM FOR?" MAKES THAT PERSON'S CARD WITH ANOTHER DRAFT OPEN (production, 26 Nov 2026)
 * ============================================================================
 *
 * A manager's chat, word for word but for the people (Sunny's invented <A> Remy Calder, <B> Marnie Holloway, and the
 * manager's own name, Dorian Quill): "exit form for <A>" drew <A>'s exit card; "exit form <manager>" got "Who is this
 * exit form for?"; the answer "<B>" was refused (person_change_not_asked), and so was "yes" to the model's own "is this
 * exit form for <B>, as a new request?": "I'm not able to open an exit form for <B> while <A>'s draft is still open".
 *
 * Cause: new_form_evidence counted only the message being answered, so the message that asked for the form and the
 * message that named the person never met. An earlier message of THIS request (after the last card) whose words name
 * the form now counts, when the manager names the card's person in it or after it.
 */

const FLAG = "AGENT_LOOP_ENABLED";
const REPORT = "Production, 26 Nov 2026: with an exit draft open for <A>, \"exit form <manager>\" → \"Who is this exit form for?\" → \"<B>\" and then \"yes\" were refused (person_change_not_asked)";
const T1 = "exit form for remy calder";
const T2 = "exit form dorian quill";
const T3 = "marnie holloway";
const CONFIRM = "I want to make sure I get this right: is this exit form for **Marnie Holloway**, as a new request (separate from Remy's draft)?";

function start(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-11-26T14:52:00Z"));
  t.directory([...STAFF]);
  t.as("salon_director", KEARNEY);
}

const said = (view: LoopView) => view.turns.filter((turn) => turn.role === "user" && (turn.messageIds?.length ?? 0) > 0).at(-1)?.text ?? "";

/** The stand-in model: A's card at T1, asks who at T2, and B's card quoting T2's ask at the turn it is told to make it. */
function standIn(makeAt: string, backToAsk: number, confirmFirst: boolean) {
  return loopStandIn((view): LoopDecision => {
    const message = said(view);
    const last = lastResult(view, "propose_form") as { reason_code?: string; ask_exactly?: string } | null;
    if (last) return { text: last.ask_exactly ?? (last.reason_code ? `I'm unable to carry this through right now (${last.reason_code}).` : "Here's the Resignation/Exit Form.") };
    if (message === T1) {
      return { tool: "propose_form", input: { template_key: "stc-exit", exit_evidence: { ...evidenceFrom(view), kind: "asks_for_exit_form" }, employee_id: "e-2", person_evidence: evidenceFrom(view, "remy calder") } };
    }
    if (message === T2) return { tool: "propose_form", input: { template_key: "stc-exit", exit_evidence: { ...evidenceFrom(view, "exit form"), kind: "asks_for_exit_form" } } };
    if (confirmFirst && message === T3) return { text: CONFIRM };
    if (message !== makeAt) return { text: "OK." };
    return {
      tool: "propose_form",
      input: {
        template_key: "stc-exit",
        exit_evidence: { ...evidenceFrom(view, "exit form", backToAsk), kind: "asks_for_exit_form" },
        employee_id: "e-1",
        person_evidence: evidenceFrom(view, "marnie holloway", confirmFirst ? 1 : 0),
        new_form_evidence: evidenceFrom(view, "exit form", backToAsk),
        request_evidence: [evidenceFrom(view, "exit form", backToAsk)],
      },
    };
  });
}

async function run(t: ReplayContext, makeAt: string, backToAsk: number, confirmFirst: boolean) {
  start(t);
  const thread = t.thread();
  const model = standIn(makeAt, backToAsk, confirmFirst);
  t.loopModel!(model);
  await thread.say(T1);
  expect(thread.proposal?.employeeName, "the case proves nothing: A's exit card never came").toBe("Remy Calder");
  await thread.say(T2);
  await thread.say(T3);
  if (confirmFirst) await thread.say("yes");
  const codes = model.views.map((view) => (lastResult(view, "propose_form") as { reason_code?: string } | null)?.reason_code).filter(Boolean);
  expect(codes, "the answer to \"who is this exit form for?\" was refused as a change of person").not.toContain("person_change_not_asked");
  expect(thread.proposal?.employeeName, "B's exit card was not made").toBe("Marnie Holloway");
}

export const NOV26_AGENT_LOOP_WHO_ANSWER_NEW_FORM_CASES: ReplayCase[] = [
  {
    id: "nov26-who-answer-new-form-name",
    title: "<A>'s exit card on screen, \"exit form <manager>\" asks who, the answer \"<B>\" makes <B>'s exit card (new_form_evidence quotes the ask)",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      await run(t, T3, 1, false);
    },
  },
  {
    id: "nov26-who-answer-new-form-yes",
    title: "<A>'s exit card on screen, asks who, \"<B>\", the model checks the name, \"yes\" makes <B>'s exit card",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      await run(t, "yes", 2, true);
    },
  },
  {
    id: "nov26-who-answer-new-form-not-before-card",
    title: "The guard holds: an ask from BEFORE <A>'s card (\"exit form for <A>\") is no ask for <B>'s card when a later message names <B> in an account",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      start(t);
      const thread = t.thread();
      const told = "marnie holloway messaged me that remy quit";
      const model = loopStandIn((view): LoopDecision => {
        const last = lastResult(view, "propose_form") as { reason_code?: string } | null;
        if (last) return { text: last.reason_code ?? "Here's the Resignation/Exit Form." };
        if (said(view) === T1) return { tool: "propose_form", input: { template_key: "stc-exit", exit_evidence: { ...evidenceFrom(view), kind: "asks_for_exit_form" }, employee_id: "e-2", person_evidence: evidenceFrom(view, "remy calder") } };
        return {
          tool: "propose_form",
          input: { template_key: "stc-exit", exit_evidence: { ...evidenceFrom(view, "exit form", 1), kind: "asks_for_exit_form" }, employee_id: "e-1", person_evidence: evidenceFrom(view, "marnie holloway"), new_form_evidence: evidenceFrom(view, "exit form", 1), request_evidence: [evidenceFrom(view, "exit form", 1)] },
        };
      });
      t.loopModel!(model);
      await thread.say(T1);
      expect(thread.proposal?.employeeName, "the case proves nothing: A's exit card never came").toBe("Remy Calder");
      await thread.say(told);
      const codes = model.views.map((view) => (lastResult(view, "propose_form") as { reason_code?: string } | null)?.reason_code).filter(Boolean);
      expect(codes, "an ask made before A's card moved the form to a person named in an account").toContain("person_change_not_asked");
      expect(thread.proposal?.employeeName).toBe("Remy Calder");
    },
  },
];
