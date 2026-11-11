import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { usageCostUsd } from "./model-prices";
import { DAILY_CAP_REPLY, MONTHLY_BUDGET_REPLY, modelSpendGuard, resetSpendGuardCache, type SpendGuardStore } from "./spend-guard";

const NAMES = ["MODEL_CALL_DAILY_CAP_ENABLED", "MODEL_CALL_DAILY_CAP", "MONTHLY_BUDGET_GUARD_ENABLED", "MONTHLY_BUDGET_USD", "BUDGET_COUNT_FROM"];
const saved = new Map<string, string | undefined>();
const NOW = new Date("2026-10-27T15:00:00Z");

function storeWith(calls: number, usd: number) {
  const reads = { calls: 0, usage: 0, since: [] as string[] };
  const store: SpendGuardStore = {
    async modelCallsSince(_userId, since) {
      reads.calls += 1;
      reads.since.push(since);
      return calls;
    },
    async modelUsageSince(since) {
      reads.usage += 1;
      reads.since.push(since);
      // $usd of Sonnet output: $10 per million output tokens.
      return [{ model: "claude-sonnet-5", inputTokens: 0, outputTokens: usd * 100_000, cacheReadTokens: 0, cacheWriteTokens: 0 }];
    },
  };
  return { store, reads };
}

beforeEach(() => {
  for (const name of NAMES) {
    saved.set(name, process.env[name]);
    delete process.env[name];
  }
  resetSpendGuardCache();
});
afterEach(() => {
  for (const [name, value] of saved) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  vi.restoreAllMocks();
});

describe("flags off", () => {
  it("lets every question through and reads nothing", async () => {
    const { store, reads } = storeWith(1000, 1000);
    expect(await modelSpendGuard({ userId: "u1", role: "salon_director", now: NOW }, store)).toBeNull();
    expect(reads.calls + reads.usage).toBe(0);
  });
});

describe("MODEL_CALL_DAILY_CAP_ENABLED", () => {
  beforeEach(() => {
    process.env.MODEL_CALL_DAILY_CAP_ENABLED = "true";
  });

  it("under the cap of 40: through", async () => {
    const { store, reads } = storeWith(39, 0);
    expect(await modelSpendGuard({ userId: "u1", role: "salon_director", now: NOW }, store)).toBeNull();
    expect(reads.since).toEqual(["2026-10-27T00:00:00.000Z"]);
  });

  it("at the cap: the plain limit sentence", async () => {
    const { store } = storeWith(40, 0);
    const reply = await modelSpendGuard({ userId: "u1", role: "salon_director", now: NOW }, store);
    expect(reply?.content).toBe(DAILY_CAP_REPLY);
  });

  it("MODEL_CALL_DAILY_CAP sets the cap", async () => {
    process.env.MODEL_CALL_DAILY_CAP = "5";
    const { store } = storeWith(5, 0);
    expect((await modelSpendGuard({ userId: "u1", role: "district_manager", now: NOW }, store))?.content).toBe(DAILY_CAP_REPLY);
  });

  it("admins and owners are not counted", async () => {
    for (const role of ["admin", "owner"]) {
      const { store, reads } = storeWith(1000, 0);
      expect(await modelSpendGuard({ userId: "u1", role, now: NOW }, store)).toBeNull();
      expect(reads.calls).toBe(0);
    }
  });

  it("a failed read lets the question through", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const store: SpendGuardStore = {
      modelCallsSince: async () => {
        throw new Error("down");
      },
      modelUsageSince: async () => [],
    };
    expect(await modelSpendGuard({ userId: "u1", role: "salon_director", now: NOW }, store)).toBeNull();
  });
});

describe("MONTHLY_BUDGET_GUARD_ENABLED", () => {
  beforeEach(() => {
    process.env.MONTHLY_BUDGET_GUARD_ENABLED = "true";
  });

  it("under 80% of $10: through, no warning", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { store, reads } = storeWith(0, 7);
    expect(await modelSpendGuard({ userId: "u1", role: "salon_director", now: NOW }, store)).toBeNull();
    expect(warn).not.toHaveBeenCalled();
    expect(reads.since).toEqual(["2026-10-01T00:00:00.000Z"]);
  });

  it("at 80%: through, with a logged warning", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { store } = storeWith(0, 8);
    expect(await modelSpendGuard({ userId: "u1", role: "salon_director", now: NOW }, store)).toBeNull();
    expect(warn).toHaveBeenCalledOnce();
  });

  it("at the budget: paused for everyone, admins too", async () => {
    for (const role of ["salon_director", "admin"]) {
      resetSpendGuardCache();
      const { store } = storeWith(0, 10);
      expect((await modelSpendGuard({ userId: "u1", role, now: NOW }, store))?.content).toBe(MONTHLY_BUDGET_REPLY);
    }
  });

  it("MONTHLY_BUDGET_USD sets the budget", async () => {
    process.env.MONTHLY_BUDGET_USD = "50";
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { store } = storeWith(0, 30);
    expect(await modelSpendGuard({ userId: "u1", role: "salon_director", now: NOW }, store)).toBeNull();
  });

  it("the month's total is read at most once a minute", async () => {
    const { store, reads } = storeWith(0, 1);
    await modelSpendGuard({ userId: "u1", role: "salon_director", now: NOW }, store);
    await modelSpendGuard({ userId: "u2", role: "salon_director", now: new Date(NOW.getTime() + 59_000) }, store);
    expect(reads.usage).toBe(1);
    await modelSpendGuard({ userId: "u3", role: "salon_director", now: new Date(NOW.getTime() + 61_000) }, store);
    expect(reads.usage).toBe(2);
  });
});

describe("BUDGET_COUNT_FROM", () => {
  beforeEach(() => {
    process.env.MONTHLY_BUDGET_GUARD_ENABLED = "true";
  });

  /** $12 before 14:00, $3 after: a store that answers by where the count starts. */
  function storeAround() {
    const asked: string[] = [];
    const store: SpendGuardStore = {
      modelCallsSince: async () => 0,
      async modelUsageSince(since) {
        asked.push(since);
        const rows = [
          { at: "2026-10-27T09:00:00.000Z", usd: 12 },
          { at: "2026-10-27T15:00:00.000Z", usd: 3 },
        ].filter((row) => row.at >= since);
        return rows.map((row) => ({ model: "claude-sonnet-5", inputTokens: 0, outputTokens: row.usd * 100_000, cacheReadTokens: 0, cacheWriteTokens: 0 }));
      },
    };
    return { store, asked };
  }

  it("unset: counted from the start of the month, as before", async () => {
    const { store, asked } = storeAround();
    expect((await modelSpendGuard({ userId: "u1", role: "salon_director", now: NOW }, store))?.content).toBe(MONTHLY_BUDGET_REPLY);
    expect(asked).toEqual(["2026-10-01T00:00:00.000Z"]);
  });

  it("set: rows before it are ignored, rows after it count", async () => {
    process.env.BUDGET_COUNT_FROM = "2026-10-27T14:00:00Z";
    const { store, asked } = storeAround();
    expect(await modelSpendGuard({ userId: "u1", role: "salon_director", now: NOW }, store)).toBeNull();
    expect(asked).toEqual(["2026-10-27T14:00:00.000Z"]);
  });

  it("never earlier than the start of the month", async () => {
    process.env.BUDGET_COUNT_FROM = "2026-09-15T00:00:00Z";
    const { store, asked } = storeAround();
    await modelSpendGuard({ userId: "u1", role: "salon_director", now: NOW }, store);
    expect(asked).toEqual(["2026-10-01T00:00:00.000Z"]);
  });

  it("not a time: as unset", async () => {
    process.env.BUDGET_COUNT_FROM = "when I turn it on";
    const { store, asked } = storeAround();
    await modelSpendGuard({ userId: "u1", role: "salon_director", now: NOW }, store);
    expect(asked).toEqual(["2026-10-01T00:00:00.000Z"]);
  });
});

describe("the pause sentences", () => {
  it("say nothing about cost", () => {
    for (const sentence of [DAILY_CAP_REPLY, MONTHLY_BUDGET_REPLY]) expect(sentence).not.toMatch(/\$|cost|spend|budget|money|dollar/i);
  });
});

describe("list prices", () => {
  it("prices each part of a call", () => {
    expect(usageCostUsd({ model: "claude-opus-5", inputTokens: 1_000_000, outputTokens: 1_000_000, cacheReadTokens: 1_000_000, cacheWriteTokens: 1_000_000 })).toBeCloseTo(36.75);
    expect(usageCostUsd({ model: "claude-sonnet-5", inputTokens: 1_000_000, outputTokens: 1_000_000, cacheReadTokens: 1_000_000, cacheWriteTokens: 1_000_000 })).toBeCloseTo(14.7);
    expect(usageCostUsd({ model: "claude-haiku-4-5", inputTokens: 1_000_000, outputTokens: 1_000_000, cacheReadTokens: 0, cacheWriteTokens: 0 })).toBeCloseTo(6);
  });

  it("an unknown model is priced as the dearest", () => {
    expect(usageCostUsd({ model: "something-new", inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 })).toBeCloseTo(5);
  });
});
