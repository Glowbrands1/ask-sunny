import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Which route an AI call is running for, so a time-limit log line can say
 * (`time-limit.ts`), and when its request began, so a call's total limit
 * ends before the route's maxDuration does. Set by `withSpendMeter` around every metered route,
 * whatever SPEND_GUARD_ALL_CALLS_ENABLED says; it records a name only and
 * changes nothing else. Outside a route it is "unknown".
 */
const storage = new AsyncLocalStorage<{ readonly route: string; readonly startedAt: number }>();

export function runInAiRoute<T>(route: string, run: () => Promise<T>): Promise<T> {
  return storage.run({ route, startedAt: Date.now() }, run);
}

export function currentAiRoute(): string {
  return storage.getStore()?.route ?? "unknown";
}

/** When the route's request began (ms, Date.now), or null outside a route. */
export function aiRequestStartedAt(): number | null {
  return storage.getStore()?.startedAt ?? null;
}
