import { AsyncLocalStorage } from "node:async_hooks";

import { spendGuardAllCallsEnabled } from "@/lib/config/chat-quality-flags";

import type { TokenUsage } from "./model-prices";

/**
 * ============================================================================
 * EVERY CLAUDE CALL A REQUEST MAKES, COUNTED (SPEND_GUARD_ALL_CALLS_ENABLED)
 * ============================================================================
 *
 * Pau and QA, 28 Oct 2026. The spend guard read only the chat answer and the
 * AI reader from chat_traces. The helpers (slot extraction, query rewrite,
 * recall, …), retries, form revision, the Create card's draft, Sales Totals
 * and template ingest were never counted. With the flag on, the Anthropic
 * client (`anthropic.ts`) records the usage of every `messages.create` into
 * the request's meter, retries included:
 *
 *   a chat turn with a trace   the calls so far go on the trace row,
 *                              `slots.spend`, and the row is marked
 *                              `slots.metered` (`chat-trace.ts`)
 *   anything left over, and    one more chat_traces row, `intent` "spend",
 *   every other route          no conversation and no model, the calls in
 *                              `slots.spend`, the route in `slots.spend_source`
 *                              (`spend-meter-run.ts`)
 *
 * The monthly budget then sums `slots.spend` for those rows instead of their
 * model columns (`spend-guard-store.ts`). The daily cap still counts answer
 * rows only: a spend row has no model. Counting only — nothing is blocked
 * that was not before. Off, no meter, no wrapping, no extra row.
 */

export type SpendSource = "chat" | "forms_draft" | "sales_totals" | "form_ingest";

export interface SpendMeter {
  readonly source: SpendSource;
  userId: string | null;
  readonly calls: TokenUsage[];
  /** Calls already written onto the turn's trace row. */
  flushed: number;
}

const storage = new AsyncLocalStorage<SpendMeter>();

export function activeSpendMeter(): SpendMeter | undefined {
  return spendGuardAllCallsEnabled() ? storage.getStore() : undefined;
}

export function runSpendMeter<T>(meter: SpendMeter, run: () => Promise<T>): Promise<T> {
  return storage.run(meter, run);
}

/** Who the request is for, once the route has authorized it. */
export function noteSpendUser(userId: string): void {
  const meter = activeSpendMeter();
  if (meter) meter.userId = userId;
}

/** The calls not yet written anywhere; they are written by the caller. */
export function takeSpend(): TokenUsage[] {
  const meter = activeSpendMeter();
  if (!meter) return [];
  const taken = meter.calls.slice(meter.flushed);
  meter.flushed = meter.calls.length;
  return taken;
}

interface SdkUsage {
  readonly input_tokens?: number | null;
  readonly output_tokens?: number | null;
  readonly cache_read_input_tokens?: number | null;
  readonly cache_creation_input_tokens?: number | null;
}

const tokens = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0);

function record(model: unknown, usage: SdkUsage | null | undefined): void {
  const meter = storage.getStore();
  if (!meter || !usage) return;
  meter.calls.push({
    model: typeof model === "string" && model !== "" ? model : null,
    inputTokens: tokens(usage.input_tokens),
    outputTokens: tokens(usage.output_tokens),
    cacheReadTokens: tokens(usage.cache_read_input_tokens),
    cacheWriteTokens: tokens(usage.cache_creation_input_tokens),
  });
}

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return typeof value === "object" && value !== null && Symbol.asyncIterator in value;
}

/** A streamed reply: its usage arrives in message_start and message_delta, and is recorded when the stream ends. */
async function* observedStream(stream: AsyncIterable<unknown>, model: unknown): AsyncGenerator<unknown> {
  let usage: Record<string, number> | null = null;
  let named = model;
  try {
    for await (const event of stream) {
      const typed = event as { type?: string; message?: { model?: string; usage?: SdkUsage }; usage?: SdkUsage };
      if (typed?.type === "message_start" && typed.message) {
        named = typed.message.model ?? named;
        usage = { ...(usage ?? {}), ...(typed.message.usage as Record<string, number>) };
      } else if (typed?.type === "message_delta" && typed.usage) {
        for (const [key, value] of Object.entries(typed.usage)) if (typeof value === "number") (usage ??= {})[key] = value;
      }
      yield event;
    }
  } finally {
    record(named, usage);
  }
}

function observed(result: unknown, model: unknown): unknown {
  if (isAsyncIterable(result) && !(typeof result === "object" && result !== null && "content" in result)) {
    return observedStream(result, model);
  }
  const message = result as { model?: string; usage?: SdkUsage } | null;
  record(message?.model ?? model, message?.usage);
  return result;
}

type CreatesMessages = { messages: { create: (...args: never[]) => unknown } };

/**
 * The client, with `messages.create` recording its usage into the request's
 * meter. Off, the client itself.
 */
export function meteredClient<C extends CreatesMessages>(client: C): C {
  if (!spendGuardAllCallsEnabled()) return client;
  const messages = new Proxy(client.messages, {
    get(target, prop, receiver) {
      if (prop !== "create") return Reflect.get(target, prop, receiver);
      return async (...args: unknown[]) => {
        const params = args[0] as { model?: unknown } | undefined;
        const result = await (target.create as (...a: unknown[]) => unknown).apply(target, args);
        return observed(result, params?.model);
      };
    },
  });
  return new Proxy(client, {
    get(target, prop, receiver) {
      return prop === "messages" ? messages : Reflect.get(target, prop, receiver);
    },
  });
}
