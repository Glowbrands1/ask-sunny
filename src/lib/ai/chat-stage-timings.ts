import { chatStageTimingsEnabled } from "@/lib/config/chat-quality-flags";

import { chatRequestReceivedAt, chatTraceDraft, pendingRouteStages, type ChatStageTiming } from "./chat-trace-store";

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
    if (!chatStageTimingsEnabled()) return;
    const draft = chatTraceDraft();
    /*
     * QA (10 Nov 2026): the route's steps before the trace opens (auth, the body, the turn's row, the form routing) are
     * held for the request, and the trace takes them over at its first mark, so its stages start at the request's
     * receipt. With no request (a test, a background job) and no trace, a mark does nothing.
     */
    const pending = pendingRouteStages();
    let stages: ChatStageTiming[];
    let from: number;
    if (draft) {
      from = draft.stagesFrom ??= chatRequestReceivedAt();
      stages = draft.stages ??= pending ? pending.splice(0) : [];
    } else if (pending) {
      from = chatRequestReceivedAt();
      stages = pending;
    } else {
      return;
    }
    const at = Date.now() - from;
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
