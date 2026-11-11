import { chatStageTimingsEnabled } from "@/lib/config/chat-quality-flags";

import { chatRequestReceivedAt, chatTraceDraft } from "./chat-trace-store";

/**
 * CHAT_STAGE_TIMINGS_ENABLED (QA, 9 Nov 2026; default off): the slow first reply to a pasted termination letter (18–23 s
 * on Sunny) spends 9–11 s before the answering model starts, and the trace recorded only the whole turn and the model
 * call. With the flag on, the turn marks where each awaited step starts (`markStage`); a step lasts until the next
 * mark, so the stages add up to the turn's serial time. Written to `chat_traces.slots.stages`: each step's name, when it
 * started and how long it took, in ms from the request's receipt. Names and numbers only, never content.
 *
 * One line before each await, nothing else: `markStage` returns nothing and never throws. Off, or with no trace open,
 * it does nothing. The trace is the request's own (`chatTraceDraft`, AsyncLocalStorage), so two turns on one instance
 * never stamp each other's.
 *
 * Reading the stages: the last one runs until the trace is written. On a turn that returns early (a form proposal, a
 * card turn), that is the step that returned, so a long "form_proposal" or "form_understand" is that path's whole
 * remaining time, not the answering model's.
 */
export function markStage(name: string): void {
  try {
    const draft = chatStageTimingsEnabled() ? chatTraceDraft() : undefined;
    if (!draft) return;
    draft.stagesFrom ??= chatRequestReceivedAt();
    const at = Date.now() - draft.stagesFrom;
    const stages = (draft.stages ??= []);
    const open = stages[stages.length - 1];
    if (open && open.ms < 0) stages[stages.length - 1] = { ...open, ms: at - open.startMs };
    stages.push({ name, startMs: at, ms: -1 });
  } catch {
    // Timing never changes the turn.
  }
}

/** The last step, ended where the trace is written (`chat-trace.ts`): no stage is left without its length. */
export function closeStages(stages: readonly { readonly name: string; readonly startMs: number; readonly ms: number }[] | undefined, receivedAt: number) {
  if (!stages || stages.length === 0) return stages;
  const now = Date.now() - receivedAt;
  return stages.map((stage) => (stage.ms < 0 ? { ...stage, ms: now - stage.startMs } : stage));
}
