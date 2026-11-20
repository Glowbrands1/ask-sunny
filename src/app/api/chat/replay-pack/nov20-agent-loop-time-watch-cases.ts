import { expect, vi } from "vitest";

import { AI_TIMEOUT_MESSAGE } from "@/lib/ai/time-limit";
import { LOOP_FAILED_REPLY, STEP_LIMIT_REPLY } from "@/lib/ai/agent-loop/replies";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";
import { lastResult, loopStandIn, type LoopDecision, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * THE TIME WATCH COVERS EACH MODEL CALL; THE REVISER HAS ITS OWN BUDGET (QA's code audit on main d7960a5f, 20 Nov 2026)
 * ============================================================================
 *
 * 14a: the 45 s first-token watch started once, at the loop's last step; a hand-back (or the token-limit retry) only
 *      reported chunks, which reset nothing, so a slow hand-back ended as "I ran out of time" over a good card reply.
 * 14b: the tool call's chunk armed the 30 s gap timer, and the form's reviser (edit_form with no values) ran under it:
 *      a slow reviser ended the turn as a timeout ("nothing was sent") and then saved anyway, so a resend edited twice.
 * 15:  the turn was charged every model call the reviser made, though the pre-check reserves only reviserModelCalls():
 *      a reviser that made more ended the turn after a saved edit with "send the change again".
 *
 * Production traces show no timeouts (max turn 27 s): these cases prevent them. Limits are lowered for the case only
 * (AI_STREAM_GAP_MS 1 s, AI_MAIN_TIMEOUT_MS 5 s), never loosened. Remy Calder is STAFF's invented person.
 */
const REPORT = "QA's code audit on main d7960a5f (20 Nov 2026): items 14a, 14b and 15";
const FLAG = "AGENT_LOOP_ENABLED";

type Saved = { field: string; before: string; after: string };

const loopTraceOf = (t: ReplayContext) => {
  const row = [...(t.rows?.("chat_traces") ?? [])].reverse().find((entry) => (entry.slots as { agent_loop?: unknown } | undefined)?.agent_loop);
  return (row?.slots as { agent_loop: { stopped: string; steps_used: number; step_limit: number; tool_model_calls?: number } } | undefined)?.agent_loop;
};

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** A Corrective Action draft for Remy Calder, created and open on screen. */
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

function replyFromSaved(view: LoopView): string {
  const saved = view.results.filter((result) => result.tool === "edit_form").flatMap((result) => (result.output.saved ?? []) as Saved[]);
  return `I saved this on Remy Calder's Corrective Action:\n${saved.map((change) => `- ${change.field}: ${change.after}`).join("\n")}`;
}

export const NOV20_AGENT_LOOP_TIME_WATCH_CASES: ReplayCase[] = [
  {
    id: "nov20-audit-14b-slow-reviser-is-not-a-timeout",
    title: "14b: the form's reviser takes longer than the stream's gap limit: the turn waits for it and replies with what it saved, never \"nothing was sent\" over a save",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      const { thread, id } = await remyDraft(t);
      vi.stubEnv("AI_STREAM_GAP_MS", "1000");
      try {
        t.patchWrites([{ turn: "this_form", set: [{ field: "observation", value: "She said her car broke down.", how: "add", evidence: "she said her car broke down" }], clear: [] }]);
        // Each form-patch call takes 1.5 s: past the 1 s gap, as a slow reviser chain passes production's 30 s.
        t.patchTakes!(1_500);
        t.loopModel!(loopStandIn((view): LoopDecision => (lastResult(view, "edit_form") ? { text: replyFromSaved(view) } : { tool: "edit_form", input: { instance_id: id } })));
        const reply = await thread.say("add that she said her car broke down").catch((error: unknown) => ({ content: `THREW: ${(error as Error).message}`, formUpdate: undefined }));
        const trace = loopTraceOf(t);
        const summary = JSON.stringify({ trace, reply: reply.content });
        expect(t.values(id).observation ?? "", "the reviser did not save").toContain("car broke down");
        expect(reply.content, `the reply says nothing was sent over a save: ${summary}`).not.toContain(AI_TIMEOUT_MESSAGE);
        expect(reply.content, summary).not.toMatch(/ran out of time|Nothing was saved/i);
        expect(trace?.stopped, summary).toBe("reply");
        expect(reply.content).toContain("car broke down");
      } finally {
        vi.unstubAllEnvs();
      }
    },
  },
  {
    id: "nov20-audit-14a-slow-hand-back-keeps-its-own-time",
    title: "14a: a hand-back whose calls each start within the first-token limit, but together take longer, finishes with its reply, never \"I ran out of time\" over the card",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      vi.setSystemTime(new Date("2026-11-11T16:00:00Z"));
      t.directory(STAFF);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      vi.stubEnv("AI_MAIN_TIMEOUT_MS", "5000");
      try {
        let handBackCalls = 0;
        t.loopModel!(loopStandIn(async (view): Promise<LoopDecision> => {
          const said = view.turns.filter((turn) => turn.role === "user").at(-1)?.text ?? "";
          if (said.startsWith("[app check]")) {
            // The hand-back (the reply left out the Policy line): two calls of 3 s each, each inside its own 5 s.
            handBackCalls += 1;
            await wait(3_000);
            if (!lastResult(view, "find_staff")) return { tool: "find_staff", input: { name: "remy calder" } };
            const policy = /end with "(\*\*Policy:\*\* [^"]+)"/.exec(said)?.[1] ?? "**Policy:** Attendance";
            return { text: `Here is the Corrective Action Form for **Remy Calder**: she arrived 20 minutes late for her shift on 11/9/26.\n\n${policy}` };
          }
          if (!lastResult(view, "propose_form")) return { tool: "propose_form", input: { template_key: "dpoa", employee_id: "e-2", policy: "Attendance", what_happened: "Remy Calder arrived 20 minutes late for her shift on 11/9/26." } };
          // The first reply leaves out the card's Policy line, so the app hands the turn back once.
          return { text: "Here is the Corrective Action Form for **Remy Calder**." };
        }));
        const reply = await thread.say("verbal CA for remy calder, she was 20 minutes late on 11/9/26");
        const trace = loopTraceOf(t);
        const summary = JSON.stringify({ trace, handBackCalls, reply: reply.content });
        expect(handBackCalls, `the hand-back did not run: ${summary}`).toBe(2);
        expect(reply.content, `a slow hand-back timed out: ${summary}`).not.toMatch(/ran out of time/i);
        expect(trace?.stopped, summary).toBe("reply");
        expect(reply.content).toMatch(/\*\*Policy:\*\*/);
        expect(reply.formProposal?.employeeName).toBe("Remy Calder");
      } finally {
        vi.unstubAllEnvs();
      }
    },
  },
  {
    id: "nov20-audit-15-reviser-over-its-reservation-still-replies",
    title: "15: the form's reviser makes more model calls than the turn reserved for it: the edit is saved and the turn ends with the model's reply, never \"send the change again\"",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      const { thread, id } = await remyDraft(t);
      vi.stubEnv("AGENT_LOOP_MAX_STEPS", "6");
      try {
        const ask = "add that she said her car broke down and fix the wording";
        /*
         * The patch reading falls back (one call), the old path's revision saves (one call), and the saved-form check reads
         * it back with the patch model, as "fix the wording" is never settled by code (one call): 3 calls, one more than
         * the turn reserves (reviserModelCalls() is 2 with EDIT_SEES_SAVED_FORM).
         */
        t.patchWrites([null]);
        t.revisionWrites({ observation: "Observed:\nRemy was 20 minutes late on 11/12. She said her car broke down." });
        t.patchChecks!([{ turn: "this_form", set: [], clear: [] }]);
        t.loopModel!(loopStandIn((view): LoopDecision => {
          const reads = view.results.filter((result) => result.tool === "read_form").length;
          if (reads < 2) return { tool: "read_form", input: { instance_id: id } };
          return lastResult(view, "edit_form") ? { text: replyFromSaved(view) } : { tool: "edit_form", input: { instance_id: id } };
        }));
        const reply = await thread.say(ask);
        const trace = loopTraceOf(t);
        const summary = JSON.stringify({ patch: t.calls().patch, checks: t.patchCheckCalls?.(), obs: t.values(id).observation, reply: reply.content, trace });
        expect(trace?.tool_model_calls ?? 0, `the reviser made no more calls than reserved, so this case shows nothing: ${summary}`).toBeGreaterThan(2);
        expect(t.values(id).observation ?? "", `the reviser did not save: ${summary} ${t.values(id).observation}`).toContain("car broke down");
        expect(trace?.stopped, `a saved edit ended at the step limit: ${summary}`).toBe("reply");
        expect(reply.content, summary).not.toMatch(/send the change you still need again/i);
        expect(reply.content).not.toBe(STEP_LIMIT_REPLY);
        expect(reply.content).not.toBe(LOOP_FAILED_REPLY);
        expect(trace!.steps_used, summary).toBeLessThanOrEqual(trace!.step_limit);
      } finally {
        vi.unstubAllEnvs();
      }
    },
  },
];
