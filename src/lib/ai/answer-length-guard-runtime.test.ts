import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { chatErrorTitle, toChatTurnError } from "@/features/chat/chat-error";

import { runChatTrace, runWithRequestClock, type ChatTraceDraft } from "./chat-trace-store";

/**
 * ============================================================================
 * "can you make a weekly coaching for how to get efts" — CUT AT max_tokens
 * ============================================================================
 *
 * conv_mvonyx9pzg7948 (26 Oct 2026). chat_traces: stop_reason=max_tokens,
 * max_tokens 2048, output_tokens 2048 of which thinking 768. The reply was
 * 3,485 characters and ended mid-sentence on "…so the rest of the team can copy
 * it [S5". The sentence-case run of the same message ended with end_turn.
 *
 * The turn goes through `answerQuestion` and the real `callClaude`; the
 * Anthropic client is the only double, and it answers from a script.
 */

type ScriptedReply =
  | { readonly text: string; readonly stop: "end_turn" | "max_tokens" }
  /** An HTTP error from the upstream, e.g. a 529 overloaded_error. */
  | { readonly fail: number; readonly type: string }
  /** No headers until the request is aborted. */
  | { readonly hang: true }
  /** Streams this text, then stalls until the request is aborted. */
  | { readonly hangAfter: string };

const state = vi.hoisted(() => ({
  answerRequests: [] as { max_tokens: number; options: unknown }[],
  script: [] as ScriptedReply[],
  waits: [] as number[],
}));

vi.mock("./anthropic", () => ({
  getAnthropicClient: () => ({
    messages: {
      create: async (params: { max_tokens: number; thinking?: unknown }, options?: unknown) => {
        // Only the answer call carries adaptive thinking; anything else gets a plain reply.
        if (params.thinking) state.answerRequests.push({ max_tokens: params.max_tokens, options });
        const next = params.thinking ? state.script.shift() : undefined;
        const reply = next ?? { text: "Here is the plan.", stop: "end_turn" as const };
        const signal = (options as { signal?: AbortSignal } | undefined)?.signal;
        const aborted = () =>
          new Promise<void>((resolve) => {
            if (signal?.aborted) resolve();
            signal?.addEventListener("abort", () => resolve());
          });
        const sdk = await import("@anthropic-ai/sdk");
        if ("fail" in reply) {
          const body = { type: "error", error: { type: reply.type, message: "upstream" } };
          throw sdk.APIError.generate(reply.fail, body, undefined, new Headers());
        }
        if ("hang" in reply) {
          await aborted();
          throw new sdk.APIUserAbortError();
        }
        if ("hangAfter" in reply) {
          return {
            async *[Symbol.asyncIterator]() {
              yield { type: "message_start", message: { usage: { input_tokens: 1 } } };
              yield { type: "content_block_delta", delta: { type: "text_delta", text: reply.hangAfter } };
              // The SDK's stream ends quietly when its request is aborted.
              await aborted();
            },
          };
        }
        return {
          content: [{ type: "text", text: reply.text }],
          stop_reason: reply.stop,
          usage: { input_tokens: 1, output_tokens: 2048, output_tokens_details: { thinking_tokens: 768 } },
        };
      },
    },
  }),
}));

/** CHAT_UPSTREAM_RETRY_ENABLED's wait between attempts, recorded instead of slept. */
vi.mock("./retry-wait", () => ({
  waitBeforeRetry: async (ms: number) => {
    state.waits.push(ms);
  },
}));

vi.mock("./query-rewrite-claude", () => ({
  rewriteToManualTerms: async (input: { question: string }) => input.question,
}));
vi.mock("@/lib/config/server-env", () => ({
  liveReadiness: () => ({ mode: "live", missing: [], problems: [], ready: true }),
  requireEnv: () => "test",
  MissingConfigurationError: class MissingConfigurationError extends Error {
    missing: string[] = [];
  },
}));
vi.mock("./form-proposal", () => ({ proposeFormForTurn: async () => null, suggestFormsForTurn: () => null }));
vi.mock("@/lib/forms/repository", () => ({ listTemplateSummaries: async () => [] }));
vi.mock("@/lib/knowledge/providers/supabase", () => ({
  SupabaseKnowledgeProvider: class {
    readonly name = "test double";
    async match() {
      return [1, 2, 3, 4, 5].map((n) => ({
        chunk_id: `chunk-eft-${n}`,
        document_id: "doc-sales",
        document_title: "EFT Sales Playbook",
        category: "sales",
        locator: `Page ${n}`,
        page: n,
        section: "EFT memberships",
        content: `EFT membership coaching point ${n}: ask every guest, explain the benefit, and track sign-ups.`,
        similarity: 0.9 - n / 100,
      }));
    }
    async fetchRoleGrounding() {
      return null;
    }
    async fetchOfficialPolicyManual() {
      return { ok: false, reason: "not needed" };
    }
  },
}));
vi.mock("@/lib/reporting/read/report-briefing", () => ({ loadReportBriefing: async () => null }));
vi.mock("@/lib/reporting/read/employee-facts", () => ({
  loadEmployeeFacts: async () => ({ available: false, block: null, reason: "no dataset" }),
  NO_EMPLOYEE_DATASET_REASON: "no dataset",
  EMPLOYEE_DATA_HEADING: "CURRENT EMPLOYEE PERFORMANCE DATA",
}));

const ACTOR = { role: "salon_director" as never, scope: { level: "salon", primaryAreaId: "loc-0314", alsoCoversAreaIds: [] } };

const QA_LOWER = "can you make a weekly coaching for how to get efts";
const QA_SENTENCE = "Can you make a weekly coaching for how to get efts";

/** The reply as production cut it: a heading, bullets, then a paragraph stopped on "[S5". */
const CUT_REPLY = [
  "Here's a weekly coaching plan to grow EFT sign-ups [S1].",
  "",
  "## Week 1: Know the offer",
  "- Walk each team member through the EFT membership benefits [S2].",
  "- Role-play the greeting and the first ask until it sounds natural.",
  "",
  "## Week 2: Ask every guest",
  "Make the EFT offer part of every check-in [S3]. Track who asked and who signed up [S4]. At the Friday huddle, share the wording that worked best so the rest of the team can copy it [S5",
].join("\n");

/**
 * What the manager sees after a clean cut: everything up to the paragraph's
 * last whole sentence. The [S#] markers become source cards, as on main.
 */
const CLEAN_CUT_SHOWN = [
  "Here's a weekly coaching plan to grow EFT sign-ups.",
  "",
  "## Week 1: Know the offer",
  "- Walk each team member through the EFT membership benefits.",
  "- Role-play the greeting and the first ask until it sounds natural.",
  "",
  "## Week 2: Ask every guest",
  "Make the EFT offer part of every check-in. Track who asked and who signed up.",
].join("\n");

const FULL_REPLY = [
  CUT_REPLY.replace(/\[S5$/, "[S5]."),
  "",
  "## Week 3: Coach in the moment",
  "- Listen to one check-in per shift and give one piece of feedback.",
  "",
  "Keep the plan short and repeat it every week.",
].join("\n");

const END_TURN_REPLY =
  "Here's a weekly coaching plan for EFTs [S1].\n\n- Monday: review the offer [S2].\n- Friday: share what worked.";

async function ask(question: string): Promise<string> {
  const { answerQuestion } = await import("./server-ask");
  const response = await answerQuestion(
    {
      question,
      mode: "standard",
      history: [],
      scopeId: "stc-core",
      context: { userName: "Dana Reyes", locationName: "All areas", todayIso: "2026-10-26" },
    } as never,
    ACTOR as never,
  );
  return response.content;
}

function guardOn(on: boolean): void {
  if (on) vi.stubEnv("ANSWER_LENGTH_GUARD_ENABLED", "true");
  else vi.stubEnv("ANSWER_LENGTH_GUARD_ENABLED", "");
  // Pinned off here, so these runs stay the validated guard alone even when
  // the suite runs with CHAT_UPSTREAM_RETRY_ENABLED set; `retryOn` turns it on.
  vi.stubEnv("CHAT_UPSTREAM_RETRY_ENABLED", "");
}

function retryOn(): void {
  vi.stubEnv("CHAT_UPSTREAM_RETRY_ENABLED", "true");
}

beforeAll(async () => {
  await import("./server-ask");
}, 60_000);

beforeEach(() => {
  state.answerRequests = [];
  state.script = [];
  state.waits = [];
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe.each([QA_LOWER, QA_SENTENCE])("QA's turn %j with ANSWER_LENGTH_GUARD_ENABLED on", (question) => {
  it("asks for 3584 tokens, and a cut reply followed by an end_turn retry shows the whole retry", async () => {
    guardOn(true);
    state.script = [
      { text: CUT_REPLY, stop: "max_tokens" },
      { text: FULL_REPLY, stop: "end_turn" },
    ];
    const content = await ask(question);

    expect(state.answerRequests.map((request) => request.max_tokens)).toEqual([3584, 3584]);
    expect(content).toContain("so the rest of the team can copy it");
    expect(content).toContain("Keep the plan short and repeat it every week.");
    expect(content).not.toMatch(/\[S\d*$/);
    const logged = vi.mocked(console.warn).mock.calls.map((call) => String(call[0]));
    expect(logged.some((line) => /stop_reason=max_tokens .*elapsed_ms=\d+ retried=true outcome=complete/.test(line))).toBe(
      true,
    );
  });

  it("both attempts cut: the reply ends at its last whole sentence, with no [S token", async () => {
    guardOn(true);
    state.script = [
      { text: CUT_REPLY, stop: "max_tokens" },
      { text: CUT_REPLY, stop: "max_tokens" },
    ];
    const content = await ask(question);

    expect(state.answerRequests.map((request) => request.max_tokens)).toEqual([3584, 3584]);
    expect(content).toBe(CLEAN_CUT_SHOWN);
    expect(content).not.toContain("[S");
  });

  it("a turn already 40 s old is not retried; the reply is cut clean", async () => {
    guardOn(true);
    state.script = [
      { text: CUT_REPLY, stop: "max_tokens" },
      { text: FULL_REPLY, stop: "end_turn" },
    ];
    const content = await runWithRequestClock(() => ask(question), Date.now() - 40_000);

    expect(state.answerRequests.map((request) => request.max_tokens)).toEqual([3584]);
    expect(content).toBe(CLEAN_CUT_SHOWN);
    const logged = vi.mocked(console.warn).mock.calls.map((call) => String(call[0]));
    expect(logged.some((line) => /stop_reason=max_tokens .*retried=false outcome=cut/.test(line))).toBe(true);
  });
});

describe("chat_traces records the turn as it already does", () => {
  it("a cut reply records max_tokens 3584 and stop_reason max_tokens", async () => {
    guardOn(true);
    state.script = [
      { text: CUT_REPLY, stop: "max_tokens" },
      { text: CUT_REPLY, stop: "max_tokens" },
    ];
    const trace: ChatTraceDraft = {
      startedAt: Date.now(),
      conversationId: null,
      messageId: null,
      userId: null,
      originalQuery: QA_LOWER,
      rewrittenQuery: null,
      intent: null,
      retrievalCount: null,
      retrieved: [],
      prompt: null,
      formInProgress: false,
      modelCall: null,
      errorSubtype: null,
      errorClass: null,
      errorStatus: null,
      succeeded: null,
    };
    await runChatTrace(trace, () => ask(QA_LOWER));
    expect(trace.modelCall?.maxTokens).toBe(3584);
    expect(trace.modelCall?.stopReason).toBe("max_tokens");
    expect(trace.modelCall?.thinkingTokens).toBe(768);
  });
});

describe("ANSWER_LENGTH_GUARD_ENABLED off is main", () => {
  it.each([QA_LOWER, QA_SENTENCE])("%j sends max_tokens 2048 and shows main's cut text", async (question) => {
    guardOn(false);
    state.script = [{ text: CUT_REPLY, stop: "max_tokens" }];
    const content = await ask(question);

    expect(state.answerRequests.map((request) => request.max_tokens)).toEqual([2048]);
    // Main's defect, kept on purpose with the flag off: the reply ends where the model stopped.
    expect(content.endsWith("so the rest of the team can copy it [S5")).toBe(true);
  });
});

describe("NEVER-BREAK: an end_turn reply is byte-identical with the flag on and off", () => {
  it.each([QA_LOWER, QA_SENTENCE])("%j", async (question) => {
    guardOn(false);
    state.script = [{ text: END_TURN_REPLY, stop: "end_turn" }];
    const off = await ask(question);

    guardOn(true);
    state.script = [{ text: END_TURN_REPLY, stop: "end_turn" }];
    const on = await ask(question);

    expect(on).toBe(off);
    // One call each way: an end_turn reply is never asked for again.
    expect(state.answerRequests.map((request) => request.max_tokens)).toEqual([2048, 3584]);
  });
});

/* ============================================================================
 * COMPOSED WITH CHAT_UPSTREAM_RETRY_ENABLED (QA coordinator's ruling, 26 Oct)
 * ============================================================================
 *
 * The guard sits outside and the retry inside each call: the first call and
 * the length retry each go through `withUpstreamRetry`, on one 120 s turn
 * budget, each attempt capped at 60 s (45 s with the guard off). The length
 * retry starts only before 35 s and is abandoned at 60 s.
 */

type Options = { maxRetries?: number; timeout?: number; signal?: AbortSignal } | undefined;

function sent(): Options[] {
  return state.answerRequests.map((request) => request.options as Options);
}

function logged(): string[] {
  return vi.mocked(console.warn).mock.calls.map((call) => String(call[0]));
}

/** Lets real work (module loading, I/O) run while the clock is fake. */
async function until(condition: () => boolean): Promise<void> {
  for (let i = 0; i < 5_000 && !condition(); i += 1) await new Promise((resolve) => setImmediate(resolve));
  expect(condition()).toBe(true);
}

/** What the manager reads when the turn throws: the chat screen's error card. */
async function cardOrContent(question: string): Promise<{ content?: string; card?: Record<string, unknown> }> {
  try {
    return { content: await ask(question) };
  } catch (caught) {
    const error = toChatTurnError(caught, question);
    return { card: { title: chatErrorTitle(error.kind), message: error.message, retryable: error.retryable } };
  }
}

/** The error card for model_failed, as main and the retry PR already show it. */
const PLAIN_CARD = {
  title: "No answer was produced",
  message: "Sunny could not produce an answer. Nothing was answered from memory — try again in a moment.",
  retryable: true,
};

describe.each([QA_LOWER, QA_SENTENCE])("QA's turn %j with the guard and CHAT_UPSTREAM_RETRY_ENABLED on", (question) => {
  it("the first reply stops at max_tokens, the length retry gets a 529 then a 200: the whole reply", async () => {
    guardOn(true);
    retryOn();
    state.script = [
      { text: CUT_REPLY, stop: "max_tokens" },
      { fail: 529, type: "overloaded_error" },
      { text: FULL_REPLY, stop: "end_turn" },
    ];
    const content = await ask(question);

    expect(content).toContain("so the rest of the team can copy it");
    expect(content).toContain("Keep the plan short and repeat it every week.");
    // Every call, the length retry's included, went through the retry wrapper.
    expect(state.answerRequests.map((request) => request.max_tokens)).toEqual([3584, 3584, 3584]);
    expect(state.waits).toEqual([1_000]);
    expect(sent().every((options) => options?.maxRetries === 0 && options.signal instanceof AbortSignal)).toBe(true);
    expect(sent().map((options) => options?.timeout)).toEqual([60_000, 60_000, 60_000]);
    expect(logged().some((line) => /attempt 1 failed: upstream 529; retrying in 1000 ms/.test(line))).toBe(true);
    expect(logged().some((line) => /stop_reason=max_tokens .*retried=true outcome=complete/.test(line))).toBe(true);
  });

  it("a hanging first attempt: 60 s caps, no length retry after 35 s, a clean cut; never a 504", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    guardOn(true);
    retryOn();
    state.script = [{ hang: true }, { text: CUT_REPLY, stop: "max_tokens" }, { text: FULL_REPLY, stop: "end_turn" }];
    const started = Date.now();
    let endedAt: number | null = null;
    const pending = ask(question).finally(() => {
      endedAt = Date.now();
    });

    await until(() => state.answerRequests.length === 1);
    await vi.advanceTimersByTimeAsync(59_999);
    expect(state.answerRequests).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    await until(() => endedAt !== null);

    expect(await pending).toBe(CLEAN_CUT_SHOWN);
    expect(endedAt! - started).toBe(60_000);
    // 60 s each, not 45 s; the cut reply came at 60 s, past the 35 s gate, so it was not asked again.
    expect(sent().map((options) => options?.timeout)).toEqual([60_000, 60_000]);
    expect(logged().some((line) => /attempt 1 failed: upstream timeout/.test(line))).toBe(true);
    expect(logged().some((line) => /elapsed_ms=60000 retried=false outcome=cut/.test(line))).toBe(true);
  });

  it("every attempt hangs: the plain card inside the 120 s budget, never a 504", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    guardOn(true);
    retryOn();
    state.script = [{ hang: true }, { hang: true }, { hang: true }];
    const started = Date.now();
    let endedAt: number | null = null;
    const seen = cardOrContent(question).finally(() => {
      endedAt = Date.now();
    });

    await until(() => state.answerRequests.length === 1);
    await vi.advanceTimersByTimeAsync(60_000);
    await until(() => state.answerRequests.length === 2);
    await vi.advanceTimersByTimeAsync(60_000);
    await until(() => endedAt !== null);

    expect(await seen).toEqual({ card: PLAIN_CARD });
    expect(endedAt! - started).toBe(120_000);
    // Two 60 s attempts fill the budget, so no third starts (45 s caps made three).
    expect(sent().map((options) => options?.timeout)).toEqual([60_000, 60_000]);
    expect(logged().some((line) => /model call failed after 2 attempts: upstream timeout/.test(line))).toBe(true);
  });

  it("a cut reply at 30 s is asked again; that retry is abandoned at 60 s and starts no further attempt", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    guardOn(true);
    retryOn();
    state.script = [{ text: CUT_REPLY, stop: "max_tokens" }, { hang: true }, { text: FULL_REPLY, stop: "end_turn" }];
    let content: string | null = null;
    const pending = runWithRequestClock(() => ask(question), Date.now() - 30_000).then((text) => {
      content = text;
    });

    await until(() => state.answerRequests.length === 2);
    // The length retry's attempt is capped at 60 s, and the guard abandons it at the turn's 60 s.
    expect(sent()[1]?.timeout).toBe(60_000);
    await vi.advanceTimersByTimeAsync(30_000);
    await pending;
    expect(content).toBe(CLEAN_CUT_SHOWN);
    expect(sent()[1]?.signal?.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(state.answerRequests).toHaveLength(2);
    expect(state.waits).toEqual([]);
  });

  it("the 35 s gate: a cut reply in a turn already 36 s old is not asked again", async () => {
    guardOn(true);
    retryOn();
    state.script = [
      { text: CUT_REPLY, stop: "max_tokens" },
      { text: FULL_REPLY, stop: "end_turn" },
    ];
    const content = await runWithRequestClock(() => ask(question), Date.now() - 36_000);

    expect(state.answerRequests).toHaveLength(1);
    expect(content).toBe(CLEAN_CUT_SHOWN);
    expect(logged().some((line) => /retried=false outcome=cut/.test(line))).toBe(true);
  });
});

describe.each([QA_LOWER, QA_SENTENCE])("QA's turn %j with the guard on and CHAT_UPSTREAM_RETRY_ENABLED off is #290", (question) => {
  it("the first call is main's, the length retry sends maxRetries 0 and the guard's signal, and a 529 there shows the clean cut", async () => {
    guardOn(true);
    state.script = [
      { text: CUT_REPLY, stop: "max_tokens" },
      { fail: 529, type: "overloaded_error" },
    ];
    const content = await ask(question);

    expect(content).toBe(CLEAN_CUT_SHOWN);
    expect(state.answerRequests).toHaveLength(2);
    expect(sent()[0]).toBeUndefined();
    expect(Object.keys(sent()[1] ?? {}).sort()).toEqual(["maxRetries", "signal"]);
    expect(sent()[1]?.maxRetries).toBe(0);
    expect(state.waits).toEqual([]);
    expect(logged().some((line) => /model call/.test(line))).toBe(false);
  });
});

describe.each([QA_LOWER, QA_SENTENCE])("QA's turn %j with the guard off and CHAT_UPSTREAM_RETRY_ENABLED on is #281", (question) => {
  it("45 s caps, 2048 tokens, three attempts that hang end with the plain card", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    guardOn(false);
    retryOn();
    state.script = [{ hang: true }, { hang: true }, { hang: true }];
    let endedAt: number | null = null;
    const seen = cardOrContent(question).finally(() => {
      endedAt = Date.now();
    });

    await until(() => state.answerRequests.length === 1);
    await vi.advanceTimersByTimeAsync(45_000);
    await until(() => state.answerRequests.length === 2);
    await vi.advanceTimersByTimeAsync(45_000);
    await until(() => state.answerRequests.length === 3);
    await vi.advanceTimersByTimeAsync(30_000);
    await until(() => endedAt !== null);

    expect(await seen).toEqual({ card: PLAIN_CARD });
    expect(state.answerRequests.map((request) => request.max_tokens)).toEqual([2048, 2048, 2048]);
    expect(sent().map((options) => options?.timeout)).toEqual([45_000, 45_000, 30_000]);
    expect(sent().every((options) => Object.keys(options ?? {}).sort().join() === "maxRetries,signal,timeout")).toBe(true);
  });

  it("a 529 then main's cut reply: main's cut text, never asked again", async () => {
    guardOn(false);
    retryOn();
    state.script = [
      { fail: 529, type: "overloaded_error" },
      { text: CUT_REPLY, stop: "max_tokens" },
    ];
    const content = await ask(question);

    expect(state.answerRequests.map((request) => request.max_tokens)).toEqual([2048, 2048]);
    expect(state.waits).toEqual([1_000]);
    expect(sent().map((options) => options?.timeout)).toEqual([45_000, 45_000]);
    // Main's defect, kept on purpose with the guard off.
    expect(content.endsWith("so the rest of the team can copy it [S5")).toBe(true);
    expect(logged().some((line) => /answer-length-guard/.test(line))).toBe(false);
  });
});

/*
 * MODEL_RETRY_ENABLED: requests carry { timeout: 45 s, maxRetries: 2 }. The
 * SDK's timeout bounds the wait for the response headers only, so it never
 * cuts a long streamed answer; with CHAT_UPSTREAM_RETRY_ENABLED on, the 60 s
 * attempt deadline does. When the longer answer runs out of time the manager
 * sees the clean cut, never less than the old cut answer and never the busy 503.
 */
describe.each([QA_LOWER, QA_SENTENCE])("QA's turn %j with MODEL_RETRY_ENABLED on: a timed-out longer answer", (question) => {
  beforeEach(() => {
    vi.stubEnv("MODEL_RETRY_ENABLED", "true");
  });

  it("retry off: the length retry times out and the first reply is shown cut clean", async () => {
    guardOn(true);
    state.script = [{ text: CUT_REPLY, stop: "max_tokens" }];
    state.script.push({ fail: 504, type: "api_error" });
    const content = await ask(question);

    expect(content).toBe(CLEAN_CUT_SHOWN);
    expect(sent()[0]).toEqual({ timeout: 45_000, maxRetries: 2 });
    expect(sent()[1]).toMatchObject({ timeout: 45_000, maxRetries: 0 });
  });

  it("retry on: a 529 on every attempt of the length retry shows the clean cut, not the busy 503", async () => {
    guardOn(true);
    retryOn();
    state.script = [
      { text: CUT_REPLY, stop: "max_tokens" },
      { fail: 529, type: "overloaded_error" },
      { fail: 529, type: "overloaded_error" },
      { fail: 529, type: "overloaded_error" },
    ];
    const content = await ask(question);

    expect(content).toBe(CLEAN_CUT_SHOWN);
    expect(state.answerRequests).toHaveLength(4);
    // MODEL_RETRY's 45 s is the lesser, and it bounds only the headers; the attempt's 60 s bounds the stream.
    expect(sent().map((options) => options?.timeout)).toEqual([45_000, 45_000, 45_000, 45_000]);
  });

  it("retry on: every attempt at the first call stalls after streaming; the streamed text is shown cut clean, not the card", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    guardOn(true);
    retryOn();
    state.script = [{ hangAfter: CUT_REPLY }, { hangAfter: CUT_REPLY }];
    let endedAt: number | null = null;
    const seen = cardOrContent(question).finally(() => {
      endedAt = Date.now();
    });

    await until(() => state.answerRequests.length === 1);
    await vi.advanceTimersByTimeAsync(60_000);
    await until(() => state.answerRequests.length === 2);
    await vi.advanceTimersByTimeAsync(60_000);
    await until(() => endedAt !== null);

    expect(await seen).toEqual({ content: CLEAN_CUT_SHOWN });
    expect(logged().some((line) => /every attempt timed out; showing the streamed text cut clean/.test(line))).toBe(true);
  });

  it("retry on, the guard off: the same stall is the retry PR's plain card", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    guardOn(false);
    retryOn();
    state.script = [{ hangAfter: CUT_REPLY }, { hangAfter: CUT_REPLY }, { hangAfter: CUT_REPLY }];
    let endedAt: number | null = null;
    const seen = cardOrContent(question).finally(() => {
      endedAt = Date.now();
    });

    await until(() => state.answerRequests.length === 1);
    await vi.advanceTimersByTimeAsync(45_000);
    await until(() => state.answerRequests.length === 2);
    await vi.advanceTimersByTimeAsync(45_000);
    await until(() => state.answerRequests.length === 3);
    await vi.advanceTimersByTimeAsync(30_000);
    await until(() => endedAt !== null);

    expect(await seen).toEqual({ card: PLAIN_CARD });
  });

  it("retry on: a stall before any whole sentence is still the plain card, never half a sentence", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    guardOn(true);
    retryOn();
    state.script = [{ hangAfter: "Here's a weekly coaching plan to grow EFT" }, { hangAfter: "Here's a weekly" }];
    let endedAt: number | null = null;
    const seen = cardOrContent(question).finally(() => {
      endedAt = Date.now();
    });

    await until(() => state.answerRequests.length === 1);
    await vi.advanceTimersByTimeAsync(60_000);
    await until(() => state.answerRequests.length === 2);
    await vi.advanceTimersByTimeAsync(60_000);
    await until(() => endedAt !== null);

    expect(await seen).toEqual({ card: PLAIN_CARD });
  });
});
