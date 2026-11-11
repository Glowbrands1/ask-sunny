import "server-only";

import { spendGuardAllCallsEnabled } from "@/lib/config/chat-quality-flags";

import { persistSpendRow } from "./chat-trace";
import { activeSpendMeter, runSpendMeter, type SpendMeter, type SpendSource } from "./spend-meter";

/**
 * SPEND_GUARD_ALL_CALLS_ENABLED: a route's work, metered (`spend-meter.ts`).
 * The calls not already on a chat trace row are written as one spend row when
 * the work ends, without waiting for it. Inside another metered request (the
 * chat redraft calls the draft route in-process) the calls join that meter.
 * Off, `run` as it was.
 */
export async function withSpendMeter<T>(source: SpendSource, run: () => Promise<T>): Promise<T> {
  if (!spendGuardAllCallsEnabled() || activeSpendMeter()) return run();
  const meter: SpendMeter = { source, userId: null, calls: [], flushed: 0 };
  try {
    return await runSpendMeter(meter, run);
  } finally {
    const rest = meter.calls.slice(meter.flushed);
    meter.flushed = meter.calls.length;
    if (rest.length > 0) void persistSpendRow({ source, userId: meter.userId, calls: rest });
  }
}
