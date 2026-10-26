import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

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

interface ScriptedReply {
  readonly text: string;
  readonly stop: "end_turn" | "max_tokens";
}

const state = vi.hoisted(() => ({
  answerRequests: [] as { max_tokens: number }[],
  script: [] as ScriptedReply[],
}));

vi.mock("./anthropic", () => ({
  getAnthropicClient: () => ({
    messages: {
      create: async (params: { max_tokens: number; thinking?: unknown }) => {
        // Only the answer call carries adaptive thinking; anything else gets a plain reply.
        if (params.thinking) state.answerRequests.push({ max_tokens: params.max_tokens });
        const next = params.thinking ? state.script.shift() : undefined;
        const reply = next ?? { text: "Here is the plan.", stop: "end_turn" as const };
        return {
          content: [{ type: "text", text: reply.text }],
          stop_reason: reply.stop,
          usage: { input_tokens: 1, output_tokens: 2048, output_tokens_details: { thinking_tokens: 768 } },
        };
      },
    },
  }),
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
}

beforeAll(async () => {
  await import("./server-ask");
}, 60_000);

beforeEach(() => {
  state.answerRequests = [];
  state.script = [];
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
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
