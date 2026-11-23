import { AsyncLocalStorage } from "node:async_hooks";

/**
 * STATED_PLAN_STEPS_ENABLED (Pau via QA, 20 Nov 2026, f062): the plan steps the regular chat's intent reader kept this turn
 * (its `planSteps` slot, checked against the manager's words), held for the turn so the card built later in the same turn
 * carries them. AsyncLocalStorage keeps concurrent turns apart. Only used with the flag on.
 */
const storage = new AsyncLocalStorage<{ steps: string[] }>();

/** Runs one chat turn with its own plan-steps record. */
export function withPlanStepsTurn<T>(run: () => Promise<T>): Promise<T> {
  return storage.run({ steps: [] }, run);
}

/** The intent reader's kept steps for this turn (outside a turn, nothing is kept). */
export function notePlanSteps(steps: readonly string[]): void {
  const turn = storage.getStore();
  if (turn) turn.steps = [...steps];
}

export function turnPlanSteps(): string[] {
  return [...(storage.getStore()?.steps ?? [])];
}
