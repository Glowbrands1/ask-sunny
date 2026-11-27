import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";
import { loopStandIn, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * A QUESTION SPOKEN INTO THE MIC IS ANSWERED EXACTLY AS THE SAME WORDS TYPED (VOICE_INPUT_ENABLED; the owner, 27 Nov 2026)
 * ============================================================================
 *
 * Voice only fills the text box: the person checks the transcript and presses Send, and the turn carries
 * `inputMode: "voice"`, the voice trace id and whether it was edited. Those three are reporting only. With
 * production's flags, a spoken-style message (lower case, no punctuation; every name invented) goes through the real
 * chat route the way the typed one does: the same answer, the model given the same words, never an
 * `agentLoopSkipReason`, and the trace row noting `slots.voice_input`.
 */
const REPORT = `The owner, 27 Nov 2026: a mic in every AI chat box; "Voice is only a way to fill a text box"`;
const SPOKEN = "can you tell me what the policy says about remy calder using her cell phone at the front desk";
const TRACE_ID = "6f1c2b3a-1111-4222-8333-444455556666";

function start(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-11-27T16:00:00Z"));
  t.directory(STAFF);
  t.as("salon_director", KEARNEY);
}

async function lastTrace(t: ReplayContext): Promise<Record<string, unknown> | undefined> {
  await vi.waitFor(() => expect((t.rows?.("chat_traces") ?? []).length).toBeGreaterThan(0));
  return (t.rows?.("chat_traces") ?? []).filter((row) => row.intent !== "spend").at(-1);
}

export const NOV27_VOICE_INPUT_CASES: ReplayCase[] = [
  {
    id: "nov27-voice-input-same-answer-as-typed",
    title: `"${SPOKEN}" sent from the mic: the same answer as typed, no loop skip, and the trace says voice`,
    report: REPORT,
    status: "fixed",
    async run(t) {
      start(t);
      const seen: string[] = [];
      if (t.loopOn?.()) {
        const model = loopStandIn((view: LoopView) => {
          seen.push(view.turns.at(-1)?.text ?? "");
          return { text: "Phones stay off the front desk while guests are there." };
        });
        t.loopModel!(model);
      } else {
        t.modelSays("Phones stay off the front desk while guests are there.");
      }
      const typed = await t.thread().say(SPOKEN);
      const tracesAfterTyped = (t.rows?.("chat_traces") ?? []).length;
      const voiced = await t.thread().say(SPOKEN, {}, { inputMode: "voice", voiceTraceId: TRACE_ID, voiceEdited: false });

      expect(voiced.content, "the spoken turn was answered differently from the typed one").toBe(typed.content);
      if (t.loopOn?.()) {
        expect(seen, "the loop was not given the same words").toHaveLength(2);
        expect(seen[1]).toBe(seen[0]);
      }

      // CHAT_TRACE_ENABLED is on in production: each turn writes its trace row.
      await vi.waitFor(() => expect((t.rows?.("chat_traces") ?? []).length).toBeGreaterThan(tracesAfterTyped));
      const typedTrace = (t.rows?.("chat_traces") ?? []).filter((row) => row.intent !== "spend")[0];
      expect((typedTrace?.slots as Record<string, unknown> | undefined)?.voice_input, "a typed turn was noted as voice").toBeUndefined();
      const trace = await lastTrace(t);
      const slots = (trace?.slots ?? {}) as Record<string, unknown>;
      expect(slots.agent_loop_skipped, "voice became a reason to skip the agent loop").toBeUndefined();
      expect(slots.voice_input).toEqual({ trace_id: TRACE_ID, edited: false });
    },
  },
  {
    id: "nov27-voice-input-edited-is-noted-only",
    title: "An edited transcript: noted as edited, the answer unchanged; a malformed voice field is dropped, never refused",
    report: REPORT,
    status: "fixed",
    async run(t) {
      start(t);
      if (t.loopOn?.()) t.loopModel!(loopStandIn(() => ({ text: "Phones stay off the front desk while guests are there." })));
      else t.modelSays("Phones stay off the front desk while guests are there.");
      const edited = await t.thread().say(SPOKEN, {}, { inputMode: "voice", voiceTraceId: TRACE_ID, voiceEdited: true });
      expect(edited.content).toBe("Phones stay off the front desk while guests are there.");
      const forged = await t.thread().say(SPOKEN, {}, { inputMode: "shout", voiceTraceId: "not-a-uuid", voiceEdited: "yes" });
      expect(forged.content).toBe("Phones stay off the front desk while guests are there.");
      await vi.waitFor(() => expect((t.rows?.("chat_traces") ?? []).filter((row) => row.intent !== "spend").length).toBeGreaterThanOrEqual(2));
      const traces = (t.rows?.("chat_traces") ?? []).filter((row) => row.intent !== "spend");
      expect((traces.at(-2)!.slots as Record<string, unknown>).voice_input).toEqual({ trace_id: TRACE_ID, edited: true });
      expect((traces.at(-1)!.slots as Record<string, unknown>).voice_input).toBeUndefined();
    },
  },
];
