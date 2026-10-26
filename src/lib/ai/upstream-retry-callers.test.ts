import { execFileSync } from "node:child_process";

import { APIError } from "@anthropic-ai/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * CHAT_UPSTREAM_RETRY_ENABLED IS THE CHAT ANSWER'S, AND NO OTHER CALLER'S.
 *
 * `callClaude` has two more callers: the Sales Totals analysis and the forms
 * ingest refinement. Retrying them inside a 45 s per-attempt deadline and the
 * chat turn's 120 s budget would turn their slow successes into failures, so
 * they never ask for it. With the flag on, their successful calls are sent and
 * returned byte for byte as with it off, and a failure reaches them exactly as
 * before — never as the chat card, never retried by this loop.
 */

const state = vi.hoisted(() => ({
  script: [] as ("answer" | "502")[],
  calls: [] as { params: string; options: unknown }[],
  waits: [] as number[],
}));

const REPLY = "0: heading\n1: field";

vi.mock("@/lib/ai/anthropic", () => ({
  getAnthropicClient: () => ({
    messages: {
      create: async (params: unknown, options?: unknown) => {
        state.calls.push({ params: JSON.stringify(params), options });
        if (state.script.shift() === "502") {
          throw APIError.generate(502, { type: "error", error: { type: "api_error", message: "x" } }, undefined, new Headers());
        }
        return { stop_reason: "end_turn", content: [{ type: "text", text: REPLY }], usage: { input_tokens: 1, output_tokens: 1 } };
      },
    },
  }),
}));

vi.mock("@/lib/ai/retry-wait", () => ({
  waitBeforeRetry: async (ms: number) => {
    state.waits.push(ms);
  },
}));

vi.mock("@/lib/reporting/analysis/sales-totals-context", () => ({
  resolveSalesTotalsAnalysisContext: async () => ({
    ok: true,
    grounding: "SALES TOTALS\nEstate net sales 100",
    provenance: { reportDate: "2026-10-25" },
    fingerprint: "fp-1",
  }),
}));

const { analyzeSalesTotals } = await import("@/lib/reporting/analysis/analyze-sales-totals");
const { refineUnresolved } = await import("@/lib/forms/ingest/refine");

const FLAG = "CHAT_UPSTREAM_RETRY_ENABLED";
const SAVED = process.env[FLAG];
let warnings: string[] = [];

beforeEach(() => {
  state.script = [];
  state.calls = [];
  state.waits = [];
  warnings = [];
  vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
    warnings.push(args.map(String).join(" "));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  if (SAVED === undefined) delete process.env[FLAG];
  else process.env[FLAG] = SAVED;
});

const CALLERS = {
  "Sales Totals analysis": () =>
    analyzeSalesTotals({ question: "Why is net sales down?", reportDate: "2026-10-25", window: "daily", history: [] } as never),
  "forms ingest refinement": () => refineUnresolved([{ index: 0, text: "Employee signature", reason: "unplaced" }]),
} as const;

/** Runs `run` with the flag off and on; returns what it settled with and what it sent, each time. */
async function offAndOn(run: () => Promise<unknown>, script: ("answer" | "502")[]) {
  const outcomes: { settled: string; calls: typeof state.calls }[] = [];
  for (const value of [undefined, "on"]) {
    if (value === undefined) delete process.env[FLAG];
    else process.env[FLAG] = value;
    state.script = [...script];
    state.calls = [];
    let settled: string;
    try {
      settled = `ok ${JSON.stringify(await run())}`;
    } catch (error) {
      const { code, status, message, name } = error as { code?: string; status?: number; message?: string; name?: string };
      settled = `threw ${JSON.stringify({ name, code, status, message })}`;
    }
    outcomes.push({ settled, calls: state.calls });
  }
  return { off: outcomes[0]!, on: outcomes[1]! };
}

describe("the other callers of callClaude are not retried by CHAT_UPSTREAM_RETRY_ENABLED", () => {
  for (const [label, run] of Object.entries(CALLERS)) {
    it(`${label}: a successful call is byte-identical with the flag on and off`, async () => {
      const { off, on } = await offAndOn(run, ["answer"]);
      expect(off.settled).toMatch(/^ok /);
      expect(on.settled).toBe(off.settled);
      expect(on.calls).toEqual(off.calls);
      expect(on.calls).toHaveLength(1);
      // Main's request options: none, so the SDK's own retries and timeout apply.
      expect(on.calls[0]!.options).toBeUndefined();
    });

    it(`${label}: a 502 reaches it exactly as before, after one call`, async () => {
      const { off, on } = await offAndOn(run, ["502", "answer"]);
      expect(on.settled).toBe(off.settled);
      expect(on.calls).toHaveLength(1);
      expect(state.waits).toEqual([]);
      expect(warnings.join("\n")).not.toMatch(/model call/);
    });
  }

  it("a Sales Totals failure is still the AiError it was, not the chat card", async () => {
    process.env[FLAG] = "on";
    state.script = ["502"];
    await expect(CALLERS["Sales Totals analysis"]()).rejects.toMatchObject({
      name: "AiError",
      code: "model_failed",
      status: 502,
      message: "Sunny could not reach the language model. No answer was generated.",
    });
  });

  it("only the chat answer asks for the retry", () => {
    const hits = execFileSync("git", ["grep", "-l", "upstreamRetry: true", "--", "src", ":(exclude)**/*.test.ts"], {
      encoding: "utf8",
    })
      .trim()
      .split("\n");
    expect(hits).toEqual(["src/lib/ai/server-ask.ts"]);
  });
});
