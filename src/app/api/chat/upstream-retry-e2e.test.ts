import { APIConnectionTimeoutError, APIError, APIUserAbortError } from "@anthropic-ai/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { toChatTurnError, chatErrorTitle } from "@/features/chat/chat-error";
import { ClaudeProvider } from "@/lib/ai/claude-provider";
import { fakeSupabase, type FakeStore } from "@/test/fake-supabase";
import { JBA_MANUAL_CA_CHUNKS } from "@/test/fixtures/jba-manual-ca-sections";

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
  | { kind: "midstream"; type: string }
  | { kind: "timeout" }
  /** Never answers until the attempt is aborted, before or after the headers. */
  | { kind: "hang" }
  | { kind: "hang-midstream" };

const state = vi.hoisted(() => ({
  script: [] as unknown[],
  modelCalls: [] as { params: unknown; options: unknown }[],
  /** Every forced tool call the turn made, by tool name, in order. */
  toolCalls: [] as string[],
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

function sdkError(outcome: Extract<Outcome, { kind: "http" | "midstream" }>): Error {
  const body = { type: "error", error: { type: outcome.type, message: "upstream" } };
  if (outcome.kind === "http") return APIError.generate(outcome.status, body, undefined, new Headers());
  // What the SDK's stream throws on an `event: error` after the 200 arrived.
  return new APIError(undefined, body, undefined, new Headers(), outcome.type as StreamedType);
}

vi.mock("@/lib/ai/anthropic", () => ({
  getAnthropicClient: () => ({
    messages: {
      create: async (params: { tool_choice?: unknown }, options?: unknown) => {
        if (params.tool_choice) {
          // No tool_use block: each tool caller sees a failed call, and must fall back.
          state.toolCalls.push(String((params.tool_choice as { name?: unknown }).name));
          return { stop_reason: "tool_use", content: [] };
        }
        state.modelCalls.push({ params, options });
        const next = (state.script.shift() ?? { kind: "answer" }) as Outcome;
        if (next.kind === "http") throw sdkError(next);
        if (next.kind === "timeout") throw new APIConnectionTimeoutError();
        const signal = (options as { signal?: AbortSignal } | undefined)?.signal;
        if (next.kind === "hang") {
          return new Promise((_, reject) => signal?.addEventListener("abort", () => reject(new APIUserAbortError())));
        }
        if (next.kind === "hang-midstream") {
          return {
            async *[Symbol.asyncIterator]() {
              yield { type: "message_start", message: { usage: { input_tokens: 10 } } };
              // The SDK's stream ends quietly when its request is aborted.
              await new Promise((resolve) => signal?.addEventListener("abort", resolve));
            },
          };
        }
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
    async fetchRoleGrounding(role: { id: string }) {
      return {
        ok: true,
        grounding: {
          role: { id: role.id },
          documentId: "doc-progression",
          documentTitle: "PERFORMANCE MANAGEMENT FRAMEWORK KB TEXT",
          matchedBy: "tag",
          rows: [
            {
              chunk_id: "pmf-0",
              document_id: "doc-progression",
              document_title: "PERFORMANCE MANAGEMENT FRAMEWORK KB TEXT",
              category: "leadership_coaching",
              locator: "SECTION 2",
              page: null,
              section: null,
              content: "Solve the issue at the lowest appropriate level.",
              similarity: 0,
            },
          ],
          presentGroups: ["escalation_ladder"],
        },
      };
    }
    async fetchOfficialPolicyManual() {
      return {
        ok: true,
        documentId: "doc-manual",
        documentTitle: "2025 JBA Policy Manual - Edited 5-2025",
        documentCategory: "policies_compliance",
        matchedBy: "tag",
        chunks: JBA_MANUAL_CA_CHUNKS,
      };
    }
  },
}));

// Hybrid and recall retrieval embed the question against the live database.
vi.mock("@/lib/knowledge/hybrid-match", () => ({ matchHybridKnowledge: async () => [] }));
vi.mock("@/lib/knowledge/recall-match", () => ({ matchRecallKnowledge: async () => [] }));

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
  state.toolCalls = [];
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
  vi.useRealTimers();
  vi.restoreAllMocks();
  for (const key of Object.keys(process.env)) {
    if (!(key in SAVED)) delete process.env[key];
  }
  for (const [key, value] of Object.entries(SAVED)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

async function ask(question = QUESTION): Promise<{ status: number; text: string; body: Record<string, unknown> }> {
  const response = await post(question);
  const text = await response.text();
  // The trace is written after the turn without being awaited.
  await new Promise((resolve) => setTimeout(resolve, 0));
  return { status: response.status, text, body: JSON.parse(text) as Record<string, unknown> };
}

function post(question: string): Promise<Response> {
  return chatRoute.POST(
    new Request("https://app.test/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        question,
        mode: "standard",
        history: [],
        questionMessageId: "m1",
        conversationId: "conv_loadtest00001",
      }),
    }),
  );
}

/**
 * What the manager reads: the browser's provider posts the turn, and the chat
 * screen turns whatever it throws into the error card (title and body).
 */
async function managerSees(respond: () => Promise<Response>): Promise<{ title: string; message: string; retryable: boolean }> {
  vi.spyOn(globalThis, "fetch").mockImplementation(async () => respond());
  try {
    await new ClaudeProvider().ask({ question: QUESTION } as never);
  } catch (caught) {
    const error = toChatTurnError(caught, QUESTION);
    return { title: chatErrorTitle(error.kind), message: error.message, retryable: error.retryable };
  }
  throw new Error("the turn answered");
}

/** The error card for model_failed, as main already shows it. */
const PLAIN_CARD = {
  title: "No answer was produced",
  message: "Sunny could not produce an answer. Nothing was answered from memory — try again in a moment.",
  retryable: true,
};

function flagOn() {
  process.env[FLAG] = "on";
}

const FAILURES: readonly [string, Extract<Outcome, { kind: "http" | "midstream" }>][] = [
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

describe("a 502 or a timeout from the model, then an answer (QA follow-up, 26 Oct 2026)", () => {
  const BAD_GATEWAY: Outcome = { kind: "http", status: 502, type: "api_error" };

  it("answers after one 502", async () => {
    flagOn();
    state.script = [BAD_GATEWAY, { kind: "answer" }];
    const result = await ask();
    expect(result.status, result.text).toBe(200);
    expect(result.body.content).toBe(ANSWER);
    expect(state.modelCalls).toHaveLength(2);
    expect(state.waits).toEqual([1_000]);
  });

  it("answers after two 502s (two retries)", async () => {
    flagOn();
    state.script = [BAD_GATEWAY, BAD_GATEWAY, { kind: "answer" }];
    const result = await ask();
    expect(result.status, result.text).toBe(200);
    expect(result.body.content).toBe(ANSWER);
    expect(state.modelCalls).toHaveLength(3);
    expect(state.waits).toEqual([1_000, 3_000]);
  });

  it("after three 502s the manager reads a plain try-again card, never the raw error", async () => {
    flagOn();
    state.script = [BAD_GATEWAY, BAD_GATEWAY, BAD_GATEWAY, { kind: "answer" }];
    const seen = await managerSees(() => post(QUESTION));
    expect(state.modelCalls).toHaveLength(3);
    expect(seen).toEqual(PLAIN_CARD);
    expect(`${seen.title} ${seen.message}`).not.toMatch(/502|upstream|language model|api_error|status/i);
    expect(warnings.join("\n")).toMatch(/model call failed after 3 attempts: upstream 502/);
  });

  it("the same card with the flag off (main), after one 502", async () => {
    state.script = [BAD_GATEWAY, { kind: "answer" }];
    expect(await managerSees(() => post(QUESTION))).toEqual(PLAIN_CARD);
    expect(state.modelCalls).toHaveLength(1);
  });

  it("the same card when something in front of the app answers 502 \"upstream request failed\"", async () => {
    // QA's harness saw this text, not the app's JSON body (see the live case below).
    const seen = await managerSees(async () => new Response("upstream request failed", { status: 502 }));
    expect(seen).toEqual(PLAIN_CARD);
  });

  it("answers after a connection timeout", async () => {
    flagOn();
    state.script = [{ kind: "timeout" }, { kind: "answer" }];
    const result = await ask();
    expect(result.status, result.text).toBe(200);
    expect(result.body.content).toBe(ANSWER);
    expect(state.modelCalls).toHaveLength(2);
    expect(warnings.join("\n")).toMatch(/attempt 1 failed: upstream connection/);
  });
});

/*
 * QA, live (production, one standalone chat, not parallel), twice:
 * "can you make a weekly coaching for how to get efts" came back to QA's
 * client as 502 "upstream request failed" after about 30 s. In production
 * both turns answered: chat_traces stop_reason end_turn, succeeded, 30-34 s
 * from request to answer, and activity_events closed succeeded. No model call
 * failed; the 502 came from in front of the app at about 30 s.
 *
 * The turn makes five model calls with the production flags: the slot reader
 * (record_intent_slots), the message normaliser (normalize_message), the
 * manual heading chooser (choose_manual_heading), the answer, and the self
 * check (repair_reply). Here every tool call fails and the turn still
 * answers, so the answer is the one call whose failure fails the turn — and
 * it is the one the retry covers.
 */
describe("QA's turn, exact wording, with the production flags", () => {
  const PRODUCTION = [
    "ACTION_PLAN_MANAGER_ONLY", "ACTION_PLAN_SENTENCES", "ATTENDANCE_POLICY_CITATION", "CA_TEMPLATE_MAP",
    "CHAT_STYLE_RULES", "CHAT_TRACE", "CROSS_CHAT_REPLY_GUARD", "CURRENT_MANUAL_SCOPE", "DRAFT_DEDUPE",
    "DRAFT_MERGE", "DRAFT_REUSE_SAME_CHAT_ONLY", "FEWSHOT_EXAMPLES", "FIELD_ACCURACY", "FORM_CHOICE_STATED",
    "FULL_MANUAL_CONTEXT", "GLOBAL_SALON_ASK", "GROUNDED_ENTITIES", "HYBRID_SEARCH", "INTENT_EXTRACTION",
    "KEEP_FORM_EMPLOYEE", "LATE_OPEN_DATE", "LONG_CONTEXT", "MANAGER_PAYROLL_AMOUNT_ONLY", "MANAGER_WORDS_ONLY",
    "MANUAL_NEGATED_LIST_NOTE", "MANUAL_SECTION_DEDUPE", "NOT_A_NAME_GUARD", "PAYROLL_AMOUNT_FIELD",
    "PLACE_SPAN_GUARD", "POLICY_CITATION", "POLICY_PAGE_REQUIRED", "PRINTED_PAGE_CITATION", "PRIOR_ACTIONS_PARSE",
    "PRIOR_COACHING_OPTIONAL", "QUERY_REWRITE", "REOPEN_VERB_GUARD", "RETRIEVAL_RECALL", "SECOND_FORM",
    "SELF_CHECK", "SLOT_RETENTION", "TITLE_WHOLE_WORD", "TYPED_NAME_PROCEEDS", "WARNING_LEVEL_MANAGER_ONLY",
  ].map((name) => `${name}_ENABLED`);

  for (const wording of [
    "can you make a weekly coaching for how to get efts",
    "Can you make a weekly coaching for how to get efts",
  ]) {
    it(`"${wording}": every tool call failing still answers, and a 502 on the answer is retried`, async () => {
      for (const name of PRODUCTION) process.env[name] = "1";
      flagOn();
      state.script = [{ kind: "http", status: 502, type: "api_error" }, { kind: "answer" }];
      const result = await ask(wording);
      expect(result.status, result.text).toBe(200);
      expect(result.body.content).toBe(ANSWER);
      expect(state.toolCalls).toEqual(["record_intent_slots", "normalize_message", "choose_manual_heading", "repair_reply"]);
      expect(state.modelCalls).toHaveLength(2);
    });

    it(`"${wording}": flag off, the 502 on the answer is main's error and card`, async () => {
      for (const name of PRODUCTION) process.env[name] = "1";
      state.script = [{ kind: "http", status: 502, type: "api_error" }, { kind: "answer" }];
      const result = await ask(wording);
      expect(result.status).toBe(502);
      expect(result.body).toEqual(OLD_ERROR);
      expect(state.modelCalls).toHaveLength(1);
    });
  }
});

/** Lets real work (module loading, I/O) run while the clock is fake. */
async function until(condition: () => boolean): Promise<void> {
  for (let i = 0; i < 5_000 && !condition(); i += 1) await new Promise((resolve) => setImmediate(resolve));
  expect(condition()).toBe(true);
}

describe("each attempt has its own deadline: min(45 s, what is left of the 120 s budget)", () => {
  for (const kind of ["hang", "hang-midstream"] as const) {
    it(`three attempts that ${kind === "hang" ? "hang before the headers" : "stall after the headers"} end inside the budget with the plain card, not a 504`, async () => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
      flagOn();
      state.script = [{ kind }, { kind }, { kind }];
      const started = Date.now();
      let endedAt: number | null = null;
      const seen = managerSees(() => post(QUESTION)).finally(() => {
        endedAt = Date.now();
      });

      await until(() => state.modelCalls.length === 1);
      await vi.advanceTimersByTimeAsync(45_000);
      await until(() => state.modelCalls.length === 2);
      await vi.advanceTimersByTimeAsync(45_000);
      await until(() => state.modelCalls.length === 3);
      expect(endedAt).toBeNull();
      await vi.advanceTimersByTimeAsync(30_000);
      await until(() => endedAt !== null);

      expect(await seen).toEqual(PLAIN_CARD);
      expect(endedAt! - started).toBeLessThanOrEqual(120_000);
      // The SDK is given the same deadline, next to maxRetries: 0.
      expect(state.modelCalls.map((call) => (call.options as { timeout?: number }).timeout)).toEqual([45_000, 45_000, 30_000]);
      expect(state.modelCalls.every((call) => (call.options as { maxRetries?: number }).maxRetries === 0)).toBe(true);
      expect(warnings.join("\n")).toMatch(/model call failed after 3 attempts: upstream timeout/);
      expect(store.chat_traces.at(-1)).toMatchObject({ succeeded: false, error_subtype: "timeout", retried: true });
    });
  }

  it("an attempt that hangs once, then an answer", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    flagOn();
    state.script = [{ kind: "hang" }, { kind: "answer" }];
    const pending = post(QUESTION);
    await until(() => state.modelCalls.length === 1);
    await vi.advanceTimersByTimeAsync(45_000);
    const response = await pending;
    expect(response.status).toBe(200);
    expect(((await response.json()) as { content?: string }).content).toBe(ANSWER);
    expect(state.modelCalls).toHaveLength(2);
  });
});
