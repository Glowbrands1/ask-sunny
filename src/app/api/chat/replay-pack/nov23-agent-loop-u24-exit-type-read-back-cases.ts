import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";
import { evidenceFrom, lastResult, loopStandIn, type LoopDecision } from "./loop-stand-in";

/**
 * ============================================================================
 * THE EXIT TYPE THE CARD TICKS IS ALWAYS READ BACK (port of Ask Bubbles #1061, its QA's flaky check, U24)
 * ============================================================================
 *
 * Found in Ask Bubbles, the same loop in Sunny: with the type stated ("Immediate Vol Resignation") the card ticked it, but
 * one live reply of five read back every reads_back line and never the type, because exit_ticks is a separate rules-book
 * line the model can skip. run.ts now adds the card's own "Filed as: <ticks>." line after the reply's opening paragraph
 * when the reply names none of the ticked types. The model's input is unchanged: reads_back gets no "Filed as" line (a
 * first Bubbles version that put it there made the rehire answer disappear from reads_back in its live check).
 * The tester's words in Sunny's shape (the U24 wording Sunny's nov22-r2-u24 cases use); the invented person is STAFF's
 * Rowan Kestrel.
 */

const FLAG = "AGENT_LOOP_ENABLED";
const REPORT = "Ask Bubbles' QA, flaky check of U24 (22 Nov 2026; port of #1061): one live reply of five read back every reads_back line but never the exit type the card ticked";
const SAID = "exit form for Rowan Kestrel. Immediate Vol Resignation, she resigned via phone call on 11/18";
const offline = process.env.AGENT_LOOP_LIVE !== "1";

type Out = { card?: { reads_back?: string[] }; facts?: { exit_ticks?: string[] } } | null;

/** The stand-in model: propose_form with exit_how on her words, then the reply `reply` builds from the tool result. */
function model(said: string, reply: (result: NonNullable<Out>) => string) {
  return loopStandIn((view): LoopDecision => {
    const result = lastResult(view, "propose_form") as Out;
    if (!result) {
      return {
        tool: "propose_form",
        input: {
          template_key: "stc-exit",
          employee_id: "e-4",
          exit_type: "resignation",
          exit_evidence: { ...evidenceFrom(view, said.split(/[.,]/)[0]!), kind: "asks_for_exit_form" },
          exit_how: "immediate_voluntary_resignation",
          exit_how_evidence: evidenceFrom(view, "Immediate Vol Resignation"),
        },
      };
    }
    return { text: reply(result) };
  });
}

const loopCase = (id: string, title: string, run: (t: ReplayContext) => Promise<void>): ReplayCase => ({
  id,
  title,
  report: REPORT,
  status: "fixed",
  fixFlags: [FLAG],
  async run(t) {
    if (!t.loopOn?.() || !offline) return;
    vi.setSystemTime(new Date("2026-11-22T18:00:00Z"));
    t.directory([...STAFF]);
    t.as("salon_director", KEARNEY);
    await run(t);
  },
});

export const NOV23_AGENT_LOOP_U24_EXIT_TYPE_READ_BACK_CASES: ReplayCase[] = [
  loopCase(
    "nov23-u24-type-read-back-when-reply-skips-it",
    `U24 (port of Bubbles #1061): "${SAID}"; the model reads back the card's other lines but no "Filed as" line: the reply still says Immediate Voluntary Resignation, once, after its opening paragraph`,
    async (t) => {
      /* As the live run: every reads_back line but the type, and no exit_ticks line. */
      t.loopModel!(model(SAID, (result) => ["Here's the Resignation/Exit Form for **Rowan**.", ...(result.card?.reads_back ?? []).filter((line) => !/^Filed as/i.test(line)).map((line) => `- ${line}`), "The card above is still open; press Create when it looks right, or tell me what to change."].join("\n\n")));
      const reply = await t.thread().say(SAID);
      expect(reply.formProposal?.templateKey, `no exit card (the case proves nothing):\n${reply.content}`).toBe("stc-exit");
      expect(reply.content.match(/Immediate Voluntary Resignation/gi) ?? [], `the type is not read back once:\n${reply.content}`).toHaveLength(1);
      expect(reply.content.split(/\n{2,}/)[1], `the Filed as line is not after the opening paragraph:\n${reply.content}`).toBe("Filed as: Immediate Voluntary Resignation.");
      expect(reply.content, reply.content).not.toMatch(/Filed as:?[^\n]*No Call No Show/i);
    },
  ),
  loopCase(
    "nov23-u24-type-named-once-no-second-line",
    `U24 control: "${SAID}"; the model says the exit_ticks line itself: the reply names the type once, and no second "Filed as" line is added`,
    async (t) => {
      /* As the other live runs: the exit_ticks line, then every reads_back line. */
      t.loopModel!(model(SAID, (result) => {
        const ticks = result.facts?.exit_ticks ?? [];
        return ["Here's the Resignation/Exit Form for **Rowan**.", ...(ticks.length > 0 ? [`Filed as: ${ticks.join(", ")}.`] : []), ...(result.card?.reads_back ?? [])].join("\n\n");
      }));
      const reply = await t.thread().say(SAID);
      expect(reply.formProposal?.templateKey, `no exit card (the case proves nothing):\n${reply.content}`).toBe("stc-exit");
      expect(reply.content.match(/Immediate Voluntary Resignation/gi) ?? [], `the type is not read back once:\n${reply.content}`).toHaveLength(1);
      expect(reply.content.match(/Filed as/gi) ?? [], `a second "Filed as" line:\n${reply.content}`).toHaveLength(1);
    },
  ),
  loopCase(
    "nov23-u24-rehire-stays-in-reads-back-with-type",
    "U24 (Bubbles' live check of #1061): \"exit form for Rowan Kestrel. Immediate Vol Resignation, she is eligible for rehire\": reads_back lists the rehire answer Create saves and never a Filed-as line (the model's input is unchanged); the reply names the type once",
    async (t) => {
      const said = "exit form for Rowan Kestrel. Immediate Vol Resignation, she is eligible for rehire";
      const standIn = model(said, (result) => ["Here's the Resignation/Exit Form for **Rowan**.", ...(result.card?.reads_back ?? [])].join("\n\n"));
      t.loopModel!(standIn);
      const reply = await t.thread().say(said);
      const readBack = (standIn.views.map((view) => lastResult(view, "propose_form") as Out).filter(Boolean).at(-1)?.card?.reads_back) ?? [];
      expect(readBack, `reads_back does not list the rehire answer:\n${readBack.join("\n")}`).toContain("**Is this employee eligible for rehire?** Yes");
      expect(readBack.some((line) => /^Filed as/i.test(line)), readBack.join("\n")).toBe(false);
      expect(reply.content.match(/Immediate Voluntary Resignation/gi) ?? [], reply.content).toHaveLength(1);
    },
  ),
];
