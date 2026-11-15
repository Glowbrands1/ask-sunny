import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";
import { evidenceFrom, lastResult, loopStandIn, type LoopDecision, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * FIX BATCH ITEM 2: "FINAL WARNING" IS NO OPTION ON THE FORM (QA's live re-test, 16 Nov 2026; Pau's ruling)
 * ============================================================================
 *
 * "final warning CA" was ticked Written Warning and read back "as you said". The Corrective Action Form's Type of Warning
 * options are Verbal Warning, Written Warning and Termination; there is no Final. Pau's ruling (16 Nov 2026, via QA): a
 * bare "final warning" ticks nothing and the reply says the form has no Final option and asks which; "final written"
 * still ticks Written (Pau, 30 Oct). A level is kept only when the manager's quoted words name that option.
 * Invented names only (Remy Calder).
 */

const FLAG = "AGENT_LOOP_ENABLED";
const REPORT = "QA's live re-test (16 Nov 2026), fix batch item 2: \"final warning CA\" gave a Written warning and the reply said \"as you said\"";
const ASK = "Which is it: Verbal Warning, Written Warning or Termination?";
const offline = process.env.AGENT_LOOP_LIVE !== "1";

function start(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-11-15T22:40:00Z"));
  t.directory([...STAFF]);
  t.as("salon_director", KEARNEY);
}

type CardOut = { reason_code?: string; level_evidence?: string; facts?: { stated?: { warning_level?: string }; level_not_named?: { ask_exactly: string } }; card?: { warning_level?: unknown } };
const proposeOutputs = (views: readonly LoopView[]) => views.flatMap((view) => view.results.filter((result) => result.tool === "propose_form")).map((result) => result.output as CardOut);

/** The live model: written, with the manager's level words quoted as its evidence; the reply reads the facts back. */
function liveModel(quote: string) {
  return loopStandIn((view): LoopDecision => {
    if (!lastResult(view, "find_staff")) return { tool: "find_staff", input: { name: "remy calder" } };
    const card = lastResult(view, "propose_form") as CardOut | null;
    if (!card) {
      return { tool: "propose_form", input: { template_key: "dpoa", employee_id: "e-2", what_happened: "Remy Calder was late on 11/12.", incident_date: "2026-11-12", warning_level: "written", level_evidence: evidenceFrom(view, quote) } };
    }
    if (card.facts?.level_not_named) return { text: `Here's the Corrective Action Form for **Remy Calder**. The form has no Final Warning option. ${card.facts.level_not_named.ask_exactly}` };
    return { text: `Here's the Corrective Action Form for **Remy Calder**.${card.facts?.stated?.warning_level ? " **Type of Warning:** Written Warning, as you said." : ""}` };
  });
}

export const NOV16_FIX_BATCH_FINAL_WARNING_CASES: ReplayCase[] = [
  {
    id: "nov16-fix-batch-2-final-warning-ticks-no-level",
    title: "Fix batch item 2: \"final warning CA for remy calder, late on 11/12\" with warning_level written on the quote \"final warning\" ticks nothing (level_not_stated, level_not_in_evidence); the reply asks \"Which is it: Verbal Warning, Written Warning or Termination?\" and never says \"as you said\"",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.() || !offline) return;
      start(t);
      const model = liveModel("final warning");
      t.loopModel!(model);
      const thread = t.thread();
      const reply = await thread.say("final warning CA for remy calder, late on 11/12");
      const out = proposeOutputs(model.views).at(-1)!;
      expect(out.card?.warning_level ?? null, `"final warning" was ticked as a level:\n${JSON.stringify(out)}`).toBeNull();
      expect(out.reason_code).toBe("level_not_stated");
      expect(out.level_evidence).toBe("level_not_in_evidence");
      expect(reply.content).toContain(ASK);
      expect(reply.content).not.toMatch(/as you said/i);
    },
  },
  {
    id: "nov16-fix-batch-2-final-written-ticks-written",
    title: "Fix batch item 2 (Pau, 30 Oct): \"final written CA for remy calder, late on 11/12\" with the quote \"final written\" still ticks Written Warning",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.() || !offline) return;
      start(t);
      const model = liveModel("final written");
      t.loopModel!(model);
      await t.thread().say("final written CA for remy calder, late on 11/12");
      const out = proposeOutputs(model.views).at(-1)!;
      expect(out.reason_code, JSON.stringify(out)).toBeUndefined();
      expect(out.card?.warning_level).toBe("written");
    },
  },
  {
    id: "nov16-fix-batch-2-final-warning-on-a-draft-writes-nothing",
    title: "Fix batch item 2: on Remy's open draft, \"make it a final warning\" with warning_type written on that quote writes nothing (level_not_stated, level_not_in_evidence, ask_exactly the level question)",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.() || !offline) return;
      start(t);
      t.loopModel!(liveModel("late on 11/12"));
      const thread = t.thread();
      await thread.say("CA for remy calder, late on 11/12");
      const id = await thread.create();
      const before = JSON.stringify(t.values(id));
      const editor = loopStandIn((view): LoopDecision => {
        const edit = lastResult(view, "edit_form") as { reason_code?: string; evidence_reason?: string; ask_exactly?: string } | null;
        if (!edit) return { tool: "edit_form", input: { instance_id: id, values: { warning_type: "written" }, level_evidence: evidenceFrom(view, "make it a final warning") } };
        return { text: [edit.reason_code, edit.evidence_reason, edit.ask_exactly].join(" | ") };
      });
      t.loopModel!(editor);
      const reply = await thread.say("make it a final warning");
      expect(reply.content).toBe(`level_not_stated | level_not_in_evidence | ${ASK}`);
      expect(JSON.stringify(t.values(id)), "a final warning wrote a level on the draft").toBe(before);
    },
  },
];
