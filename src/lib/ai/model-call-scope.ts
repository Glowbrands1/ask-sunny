import { AsyncLocalStorage } from "node:async_hooks";

/**
 * ============================================================================
 * MODEL CALLS MADE INSIDE ONE AGENT-LOOP TOOL (rebuild plan PR 6, item 3)
 * ============================================================================
 *
 * The form's reviser (edit_form with no values) makes its own model calls (the form-patch call, its check rounds),
 * which the loop's step count never saw: a turn could make more model calls than AGENT_LOOP_MAX_STEPS. The loop runs
 * each tool inside `countModelCalls`, and every model call in this app notes itself (`noteModelCall`: the Anthropic
 * client, `getAnthropicClient`, and the form-patch call). Outside a loop tool there is no scope and nothing is counted:
 * every other path is unchanged.
 */

const storage = new AsyncLocalStorage<{ calls: number }>();

/** Runs `work` and counts the model calls made inside it. */
export async function countModelCalls<T>(work: () => Promise<T>): Promise<{ value: T; calls: number }> {
  const scope = { calls: 0 };
  const value = await storage.run(scope, work);
  return { value, calls: scope.calls };
}

/** True inside `countModelCalls` (a loop tool running). Outside, callers get exactly what they got before. */
export function inModelCallScope(): boolean {
  return storage.getStore() !== undefined;
}

/** One model call, counted when it runs inside `countModelCalls`; nothing otherwise. */
export function noteModelCall(): void {
  const scope = storage.getStore();
  if (scope) scope.calls += 1;
}

type CreatesMessages = { messages: { create: (...args: never[]) => unknown; stream?: (...args: never[]) => unknown } };

/** The Anthropic client with each messages.create / messages.stream noted (`noteModelCall`); the calls themselves are unchanged. */
export function countedClient<C extends CreatesMessages>(client: C): C {
  const messages = new Proxy(client.messages, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver) as unknown;
      if ((prop === "create" || prop === "stream") && typeof value === "function") {
        return (...args: unknown[]) => {
          noteModelCall();
          return (value as (...a: unknown[]) => unknown).apply(target, args);
        };
      }
      return value;
    },
  });
  return new Proxy(client, {
    get(target, prop, receiver) {
      return prop === "messages" ? messages : Reflect.get(target, prop, receiver);
    },
  });
}
