import { expect, vi } from "vitest";

import { STEP_LIMIT_REPLY } from "@/lib/ai/agent-loop/replies";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";
import { evidenceFrom, lastResult, loopStandIn, type LoopDecision, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * THREE SAVED EDITS IN ONE TURN FINISH WITH A REPLY (rebuild plan PR 6, owner's addition, 15 Nov 2026)
 * ============================================================================
 *
 * Pau: "a replay test for a turn that makes 3 saved edits in a row. It must finish under AGENT_LOOP_MAX_STEPS with a
 * reply that lists all 3 saved changes, and never the step-limit reply."
 *
 * PR 6 counts the form reviser's model calls (edit_form with no values) toward AGENT_LOOP_MAX_STEPS. This case is the
 * guard that the count never pushes an ordinary three-edit turn into the step-limit reply. The turn is the one a live
 * model takes: read_form on the open draft, two targeted edits with values (the level, the date), one account edit
 * left to the form's reviser (no values), then the reply, written only from the `saved` lists the three calls returned.
 * Invented names (Remy Calder).
 */

const FLAG = "AGENT_LOOP_ENABLED";
const REPORT = "Owner's addition to the rebuild plan, PR 6 (15 Nov 2026): 3 saved edits in a row finish under AGENT_LOOP_MAX_STEPS";

type Saved = { field: string; before: string; after: string };

const loopTraceOf = (t: ReplayContext) => {
  const row = [...(t.rows?.("chat_traces") ?? [])].reverse().find((entry) => (entry.slots as { agent_loop?: unknown } | undefined)?.agent_loop);
  return (row?.slots as { agent_loop: { stopped: string; steps_used: number; step_limit: number; model_calls: number; steps: { tool: string }[] } } | undefined)?.agent_loop;
};

/** A Corrective Action draft for Remy Calder, created and open on screen, dated 11/12. */
async function remyDraft(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-11-14T22:40:00Z"));
  t.directory([...STAFF]);
  t.as("salon_director", KEARNEY);
  t.loopModel!(loopStandIn((view): LoopDecision => {
    if (!lastResult(view, "find_staff")) return { tool: "find_staff", input: { name: "remy calder" } };
    if (!lastResult(view, "propose_form")) return { tool: "propose_form", input: { template_key: "dpoa", employee_id: "e-2", what_happened: "Remy Calder was 20 minutes late on 11/12.", incident_date: "2026-11-12" } };
    return { text: "Here's the Corrective Action Form for **Remy Calder**." };
  }));
  const thread = t.thread();
  await thread.say("ca for remy calder, she was 20 minutes late on 11/12");
  return { thread, id: await thread.create() };
}

const MESSAGE = "make it a written, change the date to 11/13, and add that she said her car broke down";
const ADDED = "She said her car broke down.";

/** The reply a model writes from the three edit_form results: each saved field and its new value, nothing else. */
function replyFromSaved(view: LoopView): string {
  const saved = view.results.filter((result) => result.tool === "edit_form").flatMap((result) => (result.output.saved ?? []) as Saved[]);
  return `I saved these changes on Remy Calder's Corrective Action:\n${saved.map((change) => `- ${change.field}: ${change.after}`).join("\n")}`;
}

export const NOV16_AGENT_LOOP_THREE_SAVED_EDITS_CASES: ReplayCase[] = [
  {
    id: "nov16-pr6-three-saved-edits-reply-lists-all",
    title: "PR 6 (owner's addition): read_form, then 3 saved edits in a row (level and date with values, the account through the form's reviser), finish under AGENT_LOOP_MAX_STEPS with the model's own reply naming all 3 saved changes, never the step-limit reply",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      /*
       * PR 6 (changed on purpose): the reviser's own 2 model calls now count toward AGENT_LOOP_MAX_STEPS, so this turn is
       * 5 loop calls + 2 = 7. QA sets AGENT_LOOP_MAX_STEPS=8 in production with PR 6 (the code default stays 6); this case
       * runs at production's 8. At 6 the reviser is refused instead and the turn still ends with a reply
       * (nov16-pr6-step-budget-keeps-the-reply).
       */
      vi.stubEnv("AGENT_LOOP_MAX_STEPS", "8");
      try {
      const { thread, id } = await remyDraft(t);
      // The reviser's edit (no values): the form-patch model adds the sentence the manager gave, quoted from this message.
      t.patchWrites([{ turn: "this_form", set: [{ field: "observation", value: ADDED, how: "add", evidence: "she said her car broke down" }], clear: [] }]);
      const callsBefore = t.calls().patch + (t.patchCheckCalls?.() ?? 0);
      const edits = [
        (view: LoopView) => ({ instance_id: id, values: { warning_type: "written" }, level_evidence: evidenceFrom(view, "make it a written") }),
        () => ({ instance_id: id, values: { form_date: "11/13" } }),
        () => ({ instance_id: id }),
      ];
      const model = loopStandIn((view): LoopDecision => {
        if (!lastResult(view, "read_form")) return { tool: "read_form", input: { instance_id: id } };
        const done = view.results.filter((result) => result.tool === "edit_form").length;
        return done < edits.length ? { tool: "edit_form", input: edits[done]!(view) } : { text: replyFromSaved(view) };
      });
      t.loopModel!(model);
      const reply = await thread.say(MESSAGE);
      const trace = loopTraceOf(t);
      const reviserCalls = t.calls().patch + (t.patchCheckCalls?.() ?? 0) - callsBefore;
      const summary = JSON.stringify({ trace, reviserCalls, reply: reply.content });

      // Each edit saved what it was asked: the form holds all three.
      const results = model.views.at(-1)!.results.filter((result) => result.tool === "edit_form").map((result) => result.output as { saved?: Saved[]; error?: string });
      expect(results, summary).toHaveLength(3);
      for (const [index, result] of results.entries()) expect(result.saved?.length ?? 0, `edit ${index + 1} saved nothing: ${JSON.stringify(result)}`).toBeGreaterThan(0);
      expect(t.checked(id).warning_type).toEqual(["written"]);
      expect(t.values(id).form_date ?? "").toMatch(/2026-11-13|11\/13/);
      expect(t.values(id).observation ?? "").toContain("car broke down");
      expect(reviserCalls, "the third edit did not go through the form's reviser").toBeGreaterThan(0);

      // The turn finished with the model's reply, under the step limit.
      expect(trace?.stopped, `the turn did not end with a reply: ${summary}`).toBe("reply");
      expect(trace!.steps_used, `the turn used more steps than AGENT_LOOP_MAX_STEPS: ${summary}`).toBeLessThanOrEqual(trace!.step_limit);
      expect(reply.content).not.toBe(STEP_LIMIT_REPLY);
      expect(reply.content, "the step-limit reply").not.toMatch(/couldn't finish (?:that|everything)/i);

      // The reply names all three saved changes, and the turn's update carries all three fields.
      for (const field of ["warning_type", "form_date", "observation"]) expect(reply.content, `the reply leaves out ${field}:\n${reply.content}`).toContain(field);
      expect(reply.formUpdate?.updated ?? [], summary).toEqual(expect.arrayContaining(["warning_type", "form_date", "observation"]));
      // PR 6: the reviser's calls are counted against the limit.
      expect(trace!.steps_used, summary).toBe(7);
      } finally {
        vi.unstubAllEnvs();
      }
    },
  },
];
