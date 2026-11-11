import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { LONG_MESSAGE_LIMIT } from "@/lib/chat/message-limit";
import { CONTENT_MAX_LENGTH, parseConversation } from "@/lib/chat/payload";

import { redactTraceText } from "./chat-trace";

/**
 * ============================================================================
 * LONG CHAT MESSAGES REACH THE MODEL AND THE STORE WHOLE
 * ============================================================================
 *
 * Pau's decision (25 Oct 2026): longer chat messages, a warning before
 * sending, and no text ever cut silently. `long-message.test.ts` covers the
 * route. This file follows a 10,000-character message the rest of the way:
 * through `answerQuestion` and the real `callClaude` to the Anthropic request
 * (the client is the only double), into the conversation store's validator,
 * and into the chat trace.
 */

const state = vi.hoisted(() => ({
  requests: [] as { messages: { role: string; content: unknown }[] }[],
  rows: [] as unknown[],
}));

vi.mock("./anthropic", () => ({
  getAnthropicClient: () => ({
    messages: {
      create: async (params: { messages: { role: string; content: unknown }[] }) => {
        state.requests.push(params);
        return {
          content: [{ type: "text", text: "Here is what the manual says about late openings." }],
          stop_reason: "end_turn",
          usage: { input_tokens: 1, output_tokens: 1 },
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
      return state.rows;
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

/** A pasted statement with the question last, so any cut loses the question. */
function statement(length: number): string {
  const question = " What does the JBA Policy Manual say about a second late opening?";
  const body =
    "On Saturday Avery Holt arrived at 9:40 for a 9:00 opening, the second late opening this month. " +
    "Jordan Pike covered the front desk until Avery arrived and two walk-in clients left without being served. ";
  let text = "";
  while (text.length + body.length < length - question.length) text += body;
  text += "x".repeat(length - question.length - text.length);
  return `${text}${question}`;
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((block) => (block as { text?: string }).text ?? "").join("");
  }
  return "";
}

beforeAll(async () => {
  await import("./server-ask");
}, 60_000);

beforeEach(() => {
  state.requests = [];
  state.rows = [
    {
      chunk_id: "chunk-attendance",
      document_id: "doc-manual",
      document_title: "JBA Policy Manual",
      category: "policies_compliance",
      locator: "Page 12 — Attendance",
      page: 13,
      section: "Attendance",
      content: "Employees are expected to arrive on time for every scheduled shift.",
      similarity: 0.9,
    },
  ];
});

describe("the model call carries the whole message", () => {
  it("a 10,000-character question is the end of the user turn sent to Anthropic, uncut", async () => {
    const { answerQuestion } = await import("./server-ask");
    const question = statement(10_000);
    await answerQuestion(
      {
        question,
        mode: "standard",
        history: [],
        scopeId: "stc-core",
        context: { userName: "Dana Reyes", locationName: "All areas", todayIso: "2026-10-25" },
      } as never,
      ACTOR as never,
    );

    expect(state.requests.length).toBeGreaterThan(0);
    const answering = state.requests.at(-1)!;
    const last = textOf(answering.messages.at(-1)!.content);
    expect(last).toContain(`QUESTION\n\n${question}`);
    expect(last.endsWith(question)).toBe(true);
  });

  it("a 10,000-character earlier manager turn goes back to the model whole", async () => {
    const { answerQuestion } = await import("./server-ask");
    const earlier = statement(10_000);
    await answerQuestion(
      {
        question: "What does the manual say about that?",
        mode: "standard",
        history: [
          { id: "msg_a", role: "user", content: earlier, createdAt: "2026-10-25T10:00:00.000Z" },
          {
            id: "msg_b",
            role: "assistant",
            content: "That reads as a second late opening.",
            createdAt: "2026-10-25T10:00:05.000Z",
          },
        ],
        scopeId: "stc-core",
        context: { userName: "Dana Reyes", locationName: "All areas", todayIso: "2026-10-25" },
      } as never,
      ACTOR as never,
    );

    const answering = state.requests.at(-1)!;
    const sentTurns = answering.messages.map((message) => textOf(message.content));
    expect(sentTurns).toContain(earlier);
  });
});

describe("the store and the trace keep the whole message", () => {
  it("the conversation validator stores a 12,000-character manager turn as written", () => {
    const now = Date.UTC(2026, 9, 25, 12, 0, 0);
    const content = statement(LONG_MESSAGE_LIMIT);
    const parsed = parseConversation(
      {
        id: `conv_${now.toString(36)}1abc123`,
        title: "Late opening",
        createdAt: "2026-10-25T11:00:00.000Z",
        updatedAt: "2026-10-25T11:00:00.000Z",
        attachedDocumentIds: [],
        messages: [{ id: `msg_${now.toString(36)}2abc123`, role: "user", content, createdAt: "2026-10-25T11:00:00.000Z" }],
      },
      now,
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.payload.messages[0]!.content).toBe(content);
    // chat_messages.content is checked at 100,000 characters; the new limit is far inside it.
    expect(CONTENT_MAX_LENGTH).toBeGreaterThan(LONG_MESSAGE_LIMIT);
  });

  it("the chat trace keeps a message at the limit in full", () => {
    const content = statement(LONG_MESSAGE_LIMIT);
    expect(redactTraceText(content)).toBe(content);
  });
});
