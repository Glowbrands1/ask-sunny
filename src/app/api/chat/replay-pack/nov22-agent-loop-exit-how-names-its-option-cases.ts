import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";
import { evidenceFrom, lastResult, loopStandIn, type LoopDecision } from "./loop-stand-in";

/**
 * ============================================================================
 * THE EXIT TYPE IS THE ONE THE MANAGER NAMED (QA's round 2, 22 Nov 2026, U24, HIGH; port of Ask Bubbles #1013)
 * ============================================================================
 *
 * Found in Ask Bubbles, the same loop in Sunny. The manager typed "Immediate Vol Resignation … resigned via phone call"
 * (QA's quote; the person invented, the pack's roster): the card said "Filed as: No Call No Show" and the saved
 * resignation_type was no_call_no_show — the model's exit_how quoting "resigned via phone call". exit_how is now kept
 * only when its quoted words name the option's own label on the form (at least half its words, exactly, by a prefix like
 * "Vol", or a close spelling): template data, no word list.
 */

const FLAG = "AGENT_LOOP_ENABLED";
const REPORT = "QA's round 2 (22 Nov 2026, U24; found in Ask Bubbles): \"Immediate Vol Resignation … resigned via phone call\" was filed and saved as No Call No Show";
const offline = process.env.AGENT_LOOP_LIVE !== "1";
const SAID = "exit form for Rowan Kestrel. Immediate Vol Resignation, she resigned via phone call on 11/18";

type Out = { facts?: { exit_ticks?: string[] } } | null;

async function run(t: ReplayContext, how: string, quote: string) {
  t.loopModel!(loopStandIn((view): LoopDecision => {
    const result = lastResult(view, "propose_form") as Out;
    if (result) return { text: `Here's the Resignation/Exit Form for **Rowan**. Filed as: ${(result.facts?.exit_ticks ?? []).join(", ") || "nothing yet"}.` };
    return {
      tool: "propose_form",
      input: {
        template_key: "stc-exit", employee_id: "e-4", exit_type: "resignation",
        exit_evidence: { ...evidenceFrom(view, "exit form for Rowan Kestrel"), kind: "asks_for_exit_form" },
        what_happened: "Rowan resigned via phone call on 11/18.",
        exit_how: how, exit_how_evidence: evidenceFrom(view, quote),
      },
    };
  }));
  const thread = t.thread();
  const reply = await thread.say(SAID);
  const id = await thread.create();
  return { reply, checked: t.checked(id) };
}

const loopCase = (id: string, title: string, body: (t: ReplayContext) => Promise<void>): ReplayCase => ({
  id,
  title,
  report: REPORT,
  status: "fixed",
  fixFlags: [FLAG],
  async run(t) {
    if (!t.loopOn?.() || !offline) return;
    vi.setSystemTime(new Date("2026-11-21T18:00:00Z"));
    t.directory([...STAFF]);
    t.as("salon_director", KEARNEY);
    await body(t);
  },
});

export const NOV22_AGENT_LOOP_EXIT_HOW_NAMES_ITS_OPTION_CASES: ReplayCase[] = [
  loopCase("nov22-r2-u24-phone-call-never-no-call-no-show", "U24: \"Immediate Vol Resignation … resigned via phone call\" with the model's exit_how no_call_no_show on \"resigned via phone call\": No Call No Show is never filed or saved", async (t) => {
    const { reply, checked } = await run(t, "no_call_no_show", "resigned via phone call");
    expect(reply.content, `the card files No Call No Show:\n${reply.content}`).not.toMatch(/No Call No Show/i);
    expect(checked.resignation_type ?? [], JSON.stringify(checked)).not.toContain("no_call_no_show");
  }),
  loopCase("nov22-r2-u24-vol-resignation-is-immediate-voluntary", "U24 control: the same words with exit_how immediate_voluntary_resignation on \"Immediate Vol Resignation\": Immediate Voluntary Resignation is filed and saved", async (t) => {
    const { checked } = await run(t, "immediate_voluntary_resignation", "Immediate Vol Resignation");
    expect(checked.resignation_type ?? [], JSON.stringify(checked)).toEqual(["immediate_voluntary_resignation"]);
  }),
];
