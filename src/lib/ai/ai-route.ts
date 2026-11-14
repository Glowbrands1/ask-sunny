import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Which route an AI call is running for, so a time-limit log line can say
 * (`time-limit.ts`). Set by `withSpendMeter` around every metered route,
 * whatever SPEND_GUARD_ALL_CALLS_ENABLED says; it records a name only and
 * changes nothing else. Outside a route it is "unknown".
 */
const storage = new AsyncLocalStorage<string>();

export function runInAiRoute<T>(route: string, run: () => Promise<T>): Promise<T> {
  return storage.run(route, run);
}

export function currentAiRoute(): string {
  return storage.getStore() ?? "unknown";
}
