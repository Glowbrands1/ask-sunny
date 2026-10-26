import { APIError } from "@anthropic-ai/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fakeSupabase, type FakeStore } from "@/test/fake-supabase";

/**
 * ============================================================================
 * P1 — UPSTREAM MODEL ERRORS UNDER LOAD (TESTER, 26 OCT 2026)
 * ============================================================================
 *
 * Three parallel chats from one login: 11 of 142 chats got a 502/503 after
 * about 30 s, and 7 of 56 showed "No answer was produced" after about 34 s.
 * Both are the one failure path: the answer's model call throws, `callClaude`
 * turns every SDK error into `model_failed` 502, and the browser titles that
 * card "No answer was produced". Under load the SDK error is a 429, a 529 or
 * a mid-stream `overloaded_error`, or a 503.
 *
 * Behind CHAT_UPSTREAM_RETRY_ENABLED (default off) the answer's call is tried
 * again, up to two more times, about 1 s and then 3 s apart. A 400 is not
 * retried. A call that still fails returns the same 502, with the upstream
 * code in the log and in chat_traces.
 *
 * Every turn goes through POST /api/chat with the real `answerQuestion` and
 * `callClaude`. Faked: identity, the database (in memory), knowledge, the
 * Anthropic client (scripted per call), analytics and the retry wait.
 */

type Row = Record<string, unknown>;

/** The SDK's error-type parameter, for an error streamed after the 200. */
type StreamedType = ConstructorParameters<typeof APIError>[4];

const store = {
  form_instances: [],
  form_instance_values: [],
  form_instance_events: [],
  form_template_versions: [],
  form_templates: [],
  form_template_current: [],
  form_template_assets: [],
  chat_traces: [] as Row[],
} as FakeStore & { chat_traces: Row[] };

type Outcome =
  | { kind: "answer" }
  | { kind: "http"; status: number; type: string }
  | { kind: "midstream"; type: string };

const state = vi.hoisted(() => ({
  script: [] as unknown[],
  modelCalls: [] as { params: unknown; options: unknown }[],
  waits: [] as number[],
}));

vi.mock("@/lib/supabase/server", () => ({ getSupabaseAdmin: () => fakeSupabase(store) }));

vi.mock("@/lib/api/respond", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/respond")>();
  return {
    ...actual,
    assertLiveMode: () => {},
    assertNoConfigurationProblems: () => {},
    assertWithinRateLimit: () => {},
  };
});

vi.mock("@/lib/config/server-env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/config/server-env")>();
  return { ...actual, liveReadiness: () => ({ mode: "live", missing: [], problems: [], ready: true }) };
});

vi.mock("@/lib/auth/server", () => ({
  authorizeRequest: async (_request: Request, permission: string) => ({
    identity: {
      subject: "load-tester",
      email: "load-tester@example.test",
      displayName: "Load Tester",
      role: "district_manager",
      scope: { level: "global", primaryAreaId: null, alsoCoversAreaIds: [] },
      verified: true,
    },
    permission,
    provider: "supabase",
  }),
}));

vi.mock("@/lib/analytics/record", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/analytics/record")>()),
  openTurn: async () => "turn-load",
  closeTurn: async () => {},
  recordActivity: async () => {},
  recordActivityAsync: () => {},
}));

/** The wait between attempts, recorded instead of slept. */
vi.mock("@/lib/ai/retry-wait", () => ({
  waitBeforeRetry: async (ms: number) => {
    state.waits.push(ms);
  },
}));

const ANSWER = "Clock in at the start of your scheduled shift (Attendance, JBA Policy Manual p.14).";

function sdkError(outcome: Exclude<Outcome, { kind: "answer" }>): Error {
  const body = { type: "error", error: { type: outcome.type, message: "upstream" } };
  if (outcome.kind === "http") return APIError.generate(outcome.status, body, undefined, new Headers());
  // What the SDK's stream throws on an `event: error` after the 200 arrived.
  return new APIError(undefined, body, undefined, new Headers(), outcome.type as StreamedType);
}

vi.mock("@/lib/ai/anthropic", () => ({
  getAnthropicClient: () => ({
    messages: {
      create: async (params: { tool_choice?: unknown }, options?: unknown) => {
        if (params.tool_choice) return { stop_reason: "tool_use", content: [] };
        state.modelCalls.push({ params, options });
        const next = (state.script.shift() ?? { kind: "answer" }) as Outcome;
        if (next.kind === "http") throw sdkError(next);
        if (next.kind === "midstream") {
          const error = sdkError(next);
          return {
            async *[Symbol.asyncIterator]() {
              yield { type: "message_start", message: { usage: { input_tokens: 10 } } };
              throw error;
            },
          };
        }
        return {
          stop_reason: "end_turn",
          content: [{ type: "text", text: ANSWER }],
          usage: { input_tokens: 10, output_tokens: 20 },
        };
      },
    },
  }),
}));

vi.mock("@/lib/knowledge/providers/supabase", () => ({
  SupabaseKnowledgeProvider: class {
    async search() {
      return [];
    }
    async match() {
      return [];
    }
    async fetchRoleGrounding() {
      return { ok: false, reason: "no role grounding in this test" };
    }
    async fetchOfficialPolicyManual() {
      return { ok: false, reason: "no manual in this test" };
    }
  },
}));

vi.mock("@/lib/knowledge", () => ({
  getKnowledgeProvider: () => {
    throw new Error("getKnowledgeProvider() is the browser knowledge client and must not be used on the server");
  },
}));

vi.mock("@/lib/reporting/read/report-briefing", () => ({ loadReportBriefing: async () => null }));
vi.mock("@/lib/reporting/read/employee-facts", () => ({
  loadEmployeeFacts: async () => null,
  NO_EMPLOYEE_DATA_REASON: "no dataset",
  NO_EMPLOYEE_DATASET_REASON: "no dataset",
  EMPLOYEE_DATA_HEADING: "CURRENT EMPLOYEE PERFORMANCE DATA",
}));

vi.mock("@/lib/forms/employee-roster", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/forms/employee-roster")>();
  return { ...actual, readDirectoryFacts: async () => [], loadScopedRoster: async () => [] };
});

vi.mock("@/lib/forms/prior-forms", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/forms/prior-forms")>()),
  priorFormsReadingForChat: async () => ({ attach: [], possible: [], identity: "none" }),
}));

process.env.NEXT_PUBLIC_DEMO_MODE = "false";

vi.setConfig({ hookTimeout: 60_000, testTimeout: 60_000 });

const chatRoute = await import("./route");

const FLAG = "CHAT_UPSTREAM_RETRY_ENABLED";
const QUESTION = "what time do I clock in for an opening shift?";

/** What `callClaude` has always returned for any SDK failure. */
const OLD_ERROR = {
  error: "Sunny could not reach the language model. No answer was generated.",
  code: "model_failed",
  missing: [],
};

const SAVED = { ...process.env };
let warnings: string[] = [];

beforeEach(() => {
  state.script = [];
  state.modelCalls = [];
  state.waits = [];
  store.chat_traces.length = 0;
  warnings = [];
  vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
    warnings.push(args.map(String).join(" "));
  });
  delete process.env[FLAG];
  process.env.CHAT_TRACE_ENABLED = "on";
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const key of Object.keys(process.env)) {
    if (!(key in SAVED)) delete process.env[key];
  }
  for (const [key, value] of Object.entries(SAVED)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

async function ask(): Promise<{ status: number; text: string; body: Record<string, unknown> }> {
  const response = await chatRoute.POST(
    new Request("https://app.test/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        question: QUESTION,
        mode: "standard",
        history: [],
        questionMessageId: "m1",
        conversationId: "conv_loadtest00001",
      }),
    }),
  );
  const text = await response.text();
  // The trace is written after the turn without being awaited.
  await new Promise((resolve) => setTimeout(resolve, 0));
  return { status: response.status, text, body: JSON.parse(text) as Record<string, unknown> };
}

function flagOn() {
  process.env[FLAG] = "on";
}

const FAILURES: readonly [string, Exclude<Outcome, { kind: "answer" }>][] = [
  ["429 rate_limit_error", { kind: "http", status: 429, type: "rate_limit_error" }],
  ["529 overloaded_error", { kind: "http", status: 529, type: "overloaded_error" }],
  ["overloaded_error mid-stream", { kind: "midstream", type: "overloaded_error" }],
  ["503 api_error", { kind: "http", status: 503, type: "api_error" }],
];

describe("a retryable upstream error is tried again with CHAT_UPSTREAM_RETRY_ENABLED on", () => {
  for (const [label, failure] of FAILURES) {
    it(`answers after one ${label}`, async () => {
      flagOn();
      state.script = [failure, { kind: "answer" }];
      const result = await ask();
      expect(result.status, result.text).toBe(200);
      expect(result.body.content).toBe(ANSWER);
      expect(state.modelCalls).toHaveLength(2);
      expect(state.waits).toEqual([1_000]);
      // The SDK's own retries are off so the count above is the whole count.
      expect(state.modelCalls.every((call) => (call.options as { maxRetries?: number }).maxRetries === 0)).toBe(true);
      expect(store.chat_traces.at(-1)).toMatchObject({ succeeded: true, retried: true });
    });
  }

  it("answers after a 429 and then a 529, waiting about 1 s and then 3 s", async () => {
    flagOn();
    state.script = [FAILURES[0]![1], FAILURES[1]![1], { kind: "answer" }];
    const result = await ask();
    expect(result.status, result.text).toBe(200);
    expect(result.body.content).toBe(ANSWER);
    expect(state.modelCalls).toHaveLength(3);
    expect(state.waits).toEqual([1_000, 3_000]);
  });

  it("returns the old error after 429, 529 and 503, with the upstream code logged and traced", async () => {
    flagOn();
    state.script = [FAILURES[0]![1], FAILURES[1]![1], FAILURES[3]![1], { kind: "answer" }];
    const result = await ask();
    expect(result.status).toBe(502);
    expect(result.body).toEqual(OLD_ERROR);
    expect(state.modelCalls).toHaveLength(3);
    expect(state.waits).toEqual([1_000, 3_000]);
    expect(warnings.join("\n")).toMatch(/model call failed after 3 attempts: upstream 503/);
    expect(store.chat_traces.at(-1)).toMatchObject({
      succeeded: false,
      error_status: 503,
      error_subtype: "5xx",
      retryable: true,
      retried: true,
    });
  });

  it("records a mid-stream overloaded_error as overloaded, not model_failed", async () => {
    flagOn();
    const midstream = FAILURES[2]![1];
    state.script = [midstream, midstream, midstream];
    const result = await ask();
    expect(result.status).toBe(502);
    expect(result.body).toEqual(OLD_ERROR);
    expect(state.modelCalls).toHaveLength(3);
    expect(warnings.join("\n")).toMatch(/model call failed after 3 attempts: upstream overloaded_error/);
    expect(store.chat_traces.at(-1)).toMatchObject({ error_subtype: "overloaded", retryable: true, retried: true });
  });
});

describe("a non-retryable 400 is not retried", () => {
  it("calls the model once and returns the old error, with the upstream code logged", async () => {
    flagOn();
    state.script = [{ kind: "http", status: 400, type: "invalid_request_error" }, { kind: "answer" }];
    const result = await ask();
    expect(result.status).toBe(502);
    expect(result.body).toEqual(OLD_ERROR);
    expect(state.modelCalls).toHaveLength(1);
    expect(state.waits).toEqual([]);
    expect(warnings.join("\n")).toMatch(/model call failed after 1 attempt: upstream 400 \(not retryable\)/);
    expect(store.chat_traces.at(-1)).toMatchObject({ error_status: 400, error_subtype: "bad_request", retried: false });
  });
});

describe("CHAT_UPSTREAM_RETRY_ENABLED off is main", () => {
  for (const [label, failure] of FAILURES) {
    it(`returns the old error on the first ${label}, with no retry and no new log`, async () => {
      state.script = [failure, { kind: "answer" }];
      const result = await ask();
      expect(result.status).toBe(502);
      expect(result.body).toEqual(OLD_ERROR);
      expect(state.modelCalls).toHaveLength(1);
      // Off, the SDK's own request options are left as main sends them.
      expect(state.modelCalls[0]!.options).toBeUndefined();
      expect(state.waits).toEqual([]);
      expect(warnings.join("\n")).not.toMatch(/model call/);
      expect(store.chat_traces.at(-1)).toMatchObject({ succeeded: false, retried: false });
    });
  }
});

describe("NEVER BREAK: a normal turn is byte-identical with the flag on and off", () => {
  it("returns the same bytes, sends the model the same request and writes the same trace", async () => {
    const off = await ask();
    const offRequest = JSON.stringify(state.modelCalls[0]!.params);
    const offTrace = { ...store.chat_traces.at(-1) };

    state.modelCalls = [];
    flagOn();
    const on = await ask();
    const onRequest = JSON.stringify(state.modelCalls[0]!.params);
    const onTrace = { ...store.chat_traces.at(-1) };

    expect(off.status).toBe(200);
    expect(on.status).toBe(200);
    expect(on.text).toBe(off.text);
    expect(onRequest).toBe(offRequest);
    expect(state.waits).toEqual([]);
    expect(warnings.join("\n")).not.toMatch(/model call/);
    const timing = ["id", "created_at", "updated_at", "latency_ms", "e2e_latency_ms", "first_token_ms"];
    for (const key of timing) {
      delete offTrace[key];
      delete onTrace[key];
    }
    expect(onTrace).toEqual(offTrace);
    expect(onTrace).toMatchObject({ succeeded: true, retried: false, error_status: null });
  });
});
