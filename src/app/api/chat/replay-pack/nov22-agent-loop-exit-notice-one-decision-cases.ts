import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";
import { evidenceFrom, lastResult, loopStandIn, type LoopDecision } from "./loop-stand-in";

/**
 * ============================================================================
 * "GAVE NOTICE AND IS FULFILLING IT" NEVER ALSO TICKS "DID NOT FULFILL" (QA's re-run, 22 Nov 2026, B6; port of Ask Bubbles #1011)
 * ============================================================================
 *
 * Found in Ask Bubbles, the same code in Sunny. The manager's first and last turns, word for word (names invented, the
 * pack's roster): T1 "can you make me an exit form for <P1> she is
 * in woven under <P2>. Her last day is nov 23 she is returning her key she gave 2 weeks notice and is fulfilling them.
 * no deduction at this time" … T6 "she is resigning due to second job I'm ready for the draft". From T4 the card said
 * "Filed as: Submitted & Fulfilled Notice, Did not fulfill required 14 day / 30 day notice", and the saved draft had
 * both boxes. The template's Resignation Details are one set of boxes split into two groups for the page's layout
 * (`exit-library.ts`): the exit reader's tick in either group is the one decision, and the model's exit_how is not
 * carried beside it, at card time and again at Create.
 *
 * Sunny's exit reader (`exit-facts.ts`) reads a notice served only in the past ("worked out her notice", "fulfilled her
 * notice"); it does not read the live "is fulfilling them" at all, so in Sunny the live wording files the model's
 * exit_how alone (reported to QA as its own gap). The first case is the live wording, guarding that the saved form never
 * holds both boxes; the second is the mechanism with a notice Sunny's reader does read.
 */

const REPORT = "QA's re-run (22 Nov 2026, B6; found in Ask Bubbles): the card and the saved draft ticked Submitted & Fulfilled Notice AND Did not fulfill required 14 day / 30 day notice";
const T1 = "can you make me an exit form for Marnie she is in woven under Marnie Holloway. Her last day is nov 23 she is returning her key she gave 2 weeks notice and is fulfilling them. no deduction at this time";
const T1_READ = T1.replace("is fulfilling them", "worked out her notice");
const T6 = "she is resigning due to second job I'm ready for the draft";

type Out = { facts?: { exit_ticks?: string[] } } | null;

const FLAG = "AGENT_LOOP_ENABLED";
const offline = process.env.AGENT_LOOP_LIVE !== "1";

function start(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-11-21T18:00:00Z"));
  t.directory([...STAFF]);
  t.as("salon_director", KEARNEY);
}

/** T1 then T6 with the live model (by default exit_how notice_not_fulfilled on "she gave 2 weeks notice"); the draft is created. */
async function exitChat(t: ReplayContext, first: string, how = { option: "notice_not_fulfilled", quote: "she gave 2 weeks notice" }) {
  const model = loopStandIn((view): LoopDecision => {
    const result = lastResult(view, "propose_form") as Out;
    if (result) return { text: `Here's the Resignation/Exit Form for **Marnie**. Filed as: ${(result.facts?.exit_ticks ?? []).join(", ") || "nothing yet"}.` };
    const asks = view.turns.filter((turn) => turn.role === "user" && (turn.messageIds?.length ?? 0) > 0);
    const firstBack = asks.length - 1 - asks.findIndex((turn) => turn.text.includes("can you make me an exit form"));
    return {
      tool: "propose_form",
      input: {
        template_key: "stc-exit", employee_id: "e-1", exit_type: "resignation",
        exit_evidence: { ...evidenceFrom(view, "can you make me an exit form", firstBack), kind: "asks_for_exit_form" },
        what_happened: "Marnie gave 2 weeks notice and is fulfilling it; Marnie is resigning due to a second job.",
        // The live model: the notice box read as "not fulfilled".
        exit_how: how.option, exit_how_evidence: evidenceFrom(view, how.quote, firstBack),
      },
    };
  });
  t.loopModel!(model);
  const thread = t.thread();
  await thread.say(first);
  const reply = await thread.say(T6);
  const card = thread.proposal as { exitHow?: string } | null | undefined;
  const id = await thread.create();
  return { reply, card, checked: t.checked(id) };
}

export const NOV22_AGENT_LOOP_EXIT_NOTICE_ONE_DECISION_CASES: ReplayCase[] = [
  {
    id: "nov22-b6-live-wording-never-both-notice-boxes",
    title: "B6: T1 \"… she gave 2 weeks notice and is fulfilling them …\" (the model passes exit_how notice_not_fulfilled), T6 \"she is resigning due to second job I'm ready for the draft\": the saved form never ticks Submitted & Fulfilled Notice AND Did not fulfill",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.() || !offline) return;
      start(t);
      const { checked } = await exitChat(t, T1);
      const both = (checked.resignation_notice ?? []).includes("submitted_fulfilled_notice") && (checked.resignation_type ?? []).includes("notice_not_fulfilled");
      expect(both, `the saved form ticks both notice boxes:\n${JSON.stringify(checked)}`).toBe(false);
    },
  },
  {
    id: "nov22-b6-fulfilled-notice-never-also-not-fulfilled",
    title: "B6: T1 \"… she gave 2 weeks notice and worked out her notice …\" (read by Sunny's exit reader; the model passes exit_how notice_not_fulfilled), T6 \"she is resigning due to second job I'm ready for the draft\": the card and the saved form tick Submitted & Fulfilled Notice only",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.() || !offline) return;
      start(t);
      const { reply, card, checked } = await exitChat(t, T1_READ);
      expect(reply.content, `the card says notice was not fulfilled:\n${reply.content}`).not.toMatch(/Did not fulfill/i);
      expect(reply.content, "the reader read no notice (the case proves nothing)").toMatch(/Submitted & Fulfilled Notice/);
      expect(card?.exitHow, "the card carries Did not fulfill beside the reader's tick").toBeUndefined();
      expect(checked.resignation_type ?? [], `the saved form ticks Did not fulfill:\n${JSON.stringify(checked)}`).not.toContain("notice_not_fulfilled");
    },
  },
  {
    id: "nov22-b6-exit-payroll-note-is-about-payroll-only",
    title: "B6: T6 \"she is resigning due to second job I'm ready for the draft\" with \"no deduction at this time\": the card's payroll note says the form lacks only payroll lines and that the resignation reason has its own line (the live reply said the form has no reason line)",
    report: "QA's re-run (22 Nov 2026, B6; found in Ask Bubbles): the T6 reply said \"The form has no amount or reason line, so those stay in Additional Details\" while the saved draft has resignation_reason",
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.() || !offline) return;
      start(t);
      const model = loopStandIn((view): LoopDecision => {
        if (lastResult(view, "propose_form")) return { text: "Here's the Resignation/Exit Form for **Marnie**." };
        const asks = view.turns.filter((turn) => turn.role === "user" && (turn.messageIds?.length ?? 0) > 0);
        const firstBack = asks.length - 1 - asks.findIndex((turn) => turn.text.includes("can you make me an exit form"));
        return { tool: "propose_form", input: { template_key: "stc-exit", employee_id: "e-1", exit_type: "resignation", exit_evidence: { ...evidenceFrom(view, "can you make me an exit form", firstBack), kind: "asks_for_exit_form" }, what_happened: "Marnie is resigning due to a second job.", payroll_deduct: "no", payroll_evidence: evidenceFrom(view, "no deduction at this time", firstBack) } };
      });
      t.loopModel!(model);
      const thread = t.thread();
      await thread.say(T1);
      await thread.say(T6);
      const facts = model.views.flatMap((view) => view.results.filter((result) => result.tool === "propose_form")).map((result) => JSON.stringify(result.output)).join("\n");
      expect(facts, "the payroll note is not on the card (the case proves nothing)").toMatch(/payroll_question_only/);
      expect(facts, "the payroll note tells the model the form has no reason line at all").not.toMatch(/it has no amount or reason line/);
      expect(facts).toMatch(/Reason for Resignation/);
    },
  },
  {
    id: "nov22-b6-live-wording-ticks-submitted-fulfilled-only",
    title: "B6 on Sunny (QA, 22 Nov 2026): T1 \"… she gave 2 weeks notice and is fulfilling them …\" with the model's exit_how submitted_fulfilled_notice on those words: the card and the saved form tick Submitted & Fulfilled Notice only",
    report: `${REPORT}; Sunny's exit reader does not read "is fulfilling them", so the model's exit_how carries it, kept by its label (#1214)`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.() || !offline) return;
      start(t);
      const { reply, card, checked } = await exitChat(t, T1, { option: "submitted_fulfilled_notice", quote: "she gave 2 weeks notice and is fulfilling them" });
      expect(reply.content, `the card does not file the fulfilled notice:\n${reply.content}`).toMatch(/Submitted & Fulfilled Notice/);
      expect(reply.content).not.toMatch(/Did not fulfill/i);
      expect(card?.exitHow).toBe("submitted_fulfilled_notice");
      expect(checked.resignation_notice ?? [], JSON.stringify(checked)).toEqual(["submitted_fulfilled_notice"]);
      expect(checked.resignation_type ?? [], JSON.stringify(checked)).toEqual([]);
    },
  },
  {
    id: "nov22-b6-live-wording-not-fulfilled-dropped",
    title: "B6 control: the same words with exit_how notice_not_fulfilled: \"Did not fulfill … notice\" is not named by them, so it is never filed or saved",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.() || !offline) return;
      start(t);
      const { reply, checked } = await exitChat(t, T1, { option: "notice_not_fulfilled", quote: "she gave 2 weeks notice and is fulfilling them" });
      expect(reply.content).not.toMatch(/Did not fulfill/i);
      expect(checked.resignation_type ?? [], JSON.stringify(checked)).not.toContain("notice_not_fulfilled");
    },
  },
];
