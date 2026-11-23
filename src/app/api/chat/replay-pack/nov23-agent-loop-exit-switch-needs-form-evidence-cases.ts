import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";
import { evidenceFrom, headingWith, lastResult, loopStandIn, type LoopDecision, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * A SWITCH TO THE EXIT FORM NEEDS THE SAME EVIDENCE AS ANY FORM CHANGE (port of Ask Bubbles #1082, 309ec42; QA, 23 Nov 2026)
 * ============================================================================
 *
 * The form lock (f108) keeps the card on screen's form unless this turn's words ask for another form and the quote names
 * it (`quoteNamesForm`) or answers the app's own offer of it. A switch to the exit form skipped that: any real quote of
 * this turn passed as exit_evidence, so "she told me she is thinking about quitting" made the CA on screen an exit card.
 * Sunny's lock is the same code. quoteNamesForm now reads "Resignation/Exit Form" by its own shape ("Resignation Form",
 * "Exit Form"), so "make it an exit form instead" still switches. Invented person: the pack's Remy Calder.
 */

const FLAG = "AGENT_LOOP_ENABLED";
const REPORT = "Ask Bubbles #1082 (QA, 23 Nov 2026): the form lock let a switch to the exit form through on any quote of this turn";
const T1 = "ca for remy calder, she was late on 11/20";
const ACCOUNT = "Remy was late on 11/20.";
const users = (view: LoopView) => view.turns.filter((turn) => turn.role === "user" && (turn.messageIds?.length ?? 0) > 0);

/** T1: the CA card. T2: the model proposes the exit form, quoting T2 as exit_evidence. */
const model = () =>
  loopStandIn((view): LoopDecision => {
    const result = lastResult(view, "propose_form") as { card?: { form?: string }; reason_code?: string } | null;
    if (result) return { text: result.card ? `Here's the ${result.card.form ?? "form"} for **Remy**.` : `refused: ${result.reason_code}` };
    if (users(view).length === 1) return { tool: "propose_form", input: { template_key: "dpoa", employee_id: "e-2", what_happened: ACCOUNT, incident_date: "2026-11-20", policy: headingWith(view, /attendance/i), person_evidence: evidenceFrom(view, "remy calder") } };
    const said = users(view).at(-1)!.text;
    return { tool: "propose_form", input: { template_key: "stc-exit", employee_id: "e-2", exit_type: "resignation", exit_evidence: { ...evidenceFrom(view, said), kind: "asks_for_exit_form" } } };
  });

async function chat(t: ReplayContext, said: string) {
  vi.setSystemTime(new Date("2026-11-22T18:00:00Z"));
  t.directory([...STAFF]);
  t.as("salon_director", KEARNEY);
  t.loopModel!(model());
  const thread = t.thread();
  await thread.say(T1);
  expect(thread.proposal?.templateKey, "T1 made no CA card (the case proves nothing)").toBe("dpoa");
  const reply = await thread.say(said);
  return { thread, reply };
}

const fixed = (id: string, title: string, run: (t: ReplayContext) => Promise<void>): ReplayCase => ({
  id, title, report: REPORT, status: "fixed", fixFlags: [FLAG],
  async run(t) {
    if (!t.loopOn?.() || process.env.AGENT_LOOP_LIVE === "1") return;
    await run(t);
  },
});

export const NOV23_AGENT_LOOP_EXIT_SWITCH_NEEDS_FORM_EVIDENCE_CASES: ReplayCase[] = [
  fixed("nov23-1082-exit-switch-not-asked-keeps-ca", "Port of Bubbles #1082: a CA card on screen and \"she told me she is thinking about quitting\" (no ask for an exit form), passed as exit_evidence: the card stays the Corrective Action", async (t) => {
    const { thread, reply } = await chat(t, "she told me she is thinking about quitting");
    expect(thread.proposal?.templateKey, `the CA became an exit card:\n${reply.content}`).toBe("dpoa");
  }),
  fixed("nov23-1082-exit-switch-asked-by-name-switches", "Control: \"make it an exit form instead\" names the exit form, so the card switches to the exit form", async (t) => {
    const { thread, reply } = await chat(t, "make it an exit form instead");
    expect(thread.proposal?.templateKey, reply.content).toBe("stc-exit");
  }),
];
