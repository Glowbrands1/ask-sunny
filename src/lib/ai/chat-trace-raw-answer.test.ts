import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * chat_traces.raw_answer is the answer call's text before any citation check
 * or marker stripping. chat_messages only keeps the processed text, so a
 * citation bug could not be replayed from what the model wrote.
 *
 * CHAT_TRACE_RAW_ANSWER_ENABLED defaults off. Off, the insert does not name
 * raw_answer, so a database without the column still takes the row.
 */

const state = vi.hoisted(() => ({
  answer: "",
  inserts: [] as Record<string, unknown>[],
}));

vi.mock("@/lib/supabase/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase/server")>();
  return {
    ...actual,
    getSupabaseAdmin: () => ({
      from(table: string) {
        if (table !== "chat_traces") return actual.getSupabaseAdmin().from(table);
        return {
          insert: async (row: Record<string, unknown>) => {
            state.inserts.push(row);
            return { error: null };
          },
        };
      },
    }),
  };
});
vi.mock("@/lib/config/server-env", () => ({
  liveReadiness: () => ({ mode: "live", missing: [], problems: [], ready: true }),
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
      return [
        {
          chunk_id: "guide-3",
          document_id: "guide",
          document_title: "Salon Opening Guide",
          category: "operations",
          locator: "Page 3",
          page: 3,
          section: "Opening",
          content: "Unlock the front door at 9 and turn on the beds.",
          similarity: 0.91,
        },
      ];
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
vi.mock("./call-claude", () => ({
  callClaude: async () => state.answer,
}));

// Imported once up front: a cold import of server-ask takes longer than one test's timeout.
const { answerQuestion } = await import("./server-ask");

const RAW = "Unlock the front door at 9 [S1] and turn on the beds [S7].";

afterEach(() => {
  delete process.env.CHAT_TRACE_ENABLED;
  delete process.env.CHAT_TRACE_RAW_ANSWER_ENABLED;
  state.inserts.length = 0;
  state.answer = "";
});

async function ask(): Promise<string> {
  const response = await answerQuestion(
    {
      question: "How do I open the salon in the morning?",
      mode: "standard",
      history: [],
      scopeId: "stc-core",
      context: { userName: "Dana Reyes", locationName: "NE Omaha 144th and Center", todayIso: "2026-10-24" },
    } as never,
    { role: "salon_director" as never, scope: { level: "salon", primaryAreaId: "loc-0314", alsoCoversAreaIds: [] } },
  );
  await vi.waitFor(() => {
    if (process.env.CHAT_TRACE_ENABLED) expect(state.inserts).toHaveLength(1);
  });
  return response.content;
}

describe("chat_traces.raw_answer", () => {
  it("is not in the insert when CHAT_TRACE_RAW_ANSWER_ENABLED is off", async () => {
    process.env.CHAT_TRACE_ENABLED = "1";
    state.answer = RAW;
    await ask();
    expect(state.inserts).toHaveLength(1);
    expect(state.inserts[0]).not.toHaveProperty("raw_answer");
  });

  it("holds the model's text before markers are stripped from the displayed answer", async () => {
    process.env.CHAT_TRACE_ENABLED = "1";
    process.env.CHAT_TRACE_RAW_ANSWER_ENABLED = "1";
    state.answer = RAW;
    const shown = await ask();
    expect(shown).not.toContain("[S1]");
    expect(shown).not.toBe(RAW);
    expect(state.inserts[0]?.raw_answer).toBe(RAW);
  });

  it("keeps the first 20,000 characters", async () => {
    process.env.CHAT_TRACE_ENABLED = "1";
    process.env.CHAT_TRACE_RAW_ANSWER_ENABLED = "1";
    state.answer = `${"a".repeat(19_990)} [S1] ${"b".repeat(100)}`;
    await ask();
    expect(state.inserts[0]?.raw_answer).toBe(state.answer.slice(0, 20_000));
  });

  it("writes nothing when CHAT_TRACE_ENABLED is off", async () => {
    process.env.CHAT_TRACE_RAW_ANSWER_ENABLED = "1";
    state.answer = RAW;
    await ask();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(state.inserts).toHaveLength(0);
  });
});
