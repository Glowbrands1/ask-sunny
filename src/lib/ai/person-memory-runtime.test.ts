import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * ============================================================================
 * THE MEMORY BLOCK REACHES THE MODEL — WITH ITS RULES, AND ONLY FOR ITS OWNER
 * ============================================================================
 *
 * `answerQuestion` run with the providers mocked, asserting on what Claude was
 * sent. The recall itself is covered in `chat/person-memory-store.test.ts`;
 * this is the wiring: whose memory is asked for, that the block is passed
 * rather than counted, and that the prompt rules travel with it and only
 * with it.
 */

const state = vi.hoisted(() => ({
  claudeInput: null as Record<string, unknown> | null,
  recallInput: null as Record<string, unknown> | null,
  memory: null as string | null,
}));

vi.mock("@/lib/config/server-env", () => ({
  liveReadiness: () => ({ mode: "live", missing: [], problems: [], ready: true }),
  MissingConfigurationError: class MissingConfigurationError extends Error {
    missing: string[] = [];
  },
}));

vi.mock("./form-proposal", () => ({
  proposeFormForTurn: async () => null,
  suggestFormsForTurn: () => null,
}));

vi.mock("@/lib/forms/repository", () => ({
  listTemplateSummaries: async () => [],
}));

vi.mock("@/lib/knowledge/providers/supabase", () => ({
  SupabaseKnowledgeProvider: class {
    readonly name = "test double";
    async match() {
      return [
        {
          chunk_id: "c1",
          document_id: "d1",
          document_title: "Salon Coaching Guide",
          category: "leadership_coaching",
          locator: "Page 2",
          page: 2,
          section: null,
          content: "Coach in private, soon after the behaviour.",
          similarity: 0.9,
        },
      ];
    }
    async fetchRoleGrounding() {
      return null;
    }
  },
}));

vi.mock("@/lib/reporting/read/report-briefing", () => ({
  loadReportBriefing: async () => null,
}));

vi.mock("@/lib/reporting/read/employee-facts", () => ({
  loadEmployeeFacts: async () => null,
  NO_EMPLOYEE_DATASET_REASON: "no dataset",
  EMPLOYEE_DATA_HEADING: "CURRENT EMPLOYEE PERFORMANCE DATA",
}));

vi.mock("@/lib/chat/person-memory-store", () => ({
  recallPeople: async (input: Record<string, unknown>) => {
    state.recallInput = input;
    return state.memory;
  },
}));

vi.mock("./call-claude", () => ({
  callClaude: async (input: Record<string, unknown>) => {
    state.claudeInput = input;
    return "Last time you mentioned she was late three times.";
  },
}));

const ACTOR = { role: "salon_director" as const, scope: { level: "salon" as const, salonIds: ["loc-0495"] } };

const MEMORY = `WHAT THIS MANAGER TOLD YOU BEFORE

ABOUT SARAH TEST

Earlier conversation, 2026-10-03 — "Coaching form for Sarah Test". The manager wrote:
> She was late three times this week`;

async function ask(memory: { memoryOwnerId?: string } = { memoryOwnerId: "user-1" }) {
  const { answerQuestion } = await import("./server-ask");
  return answerQuestion(
    {
      question: "What should I do about Sarah Test now?",
      mode: "standard",
      history: [],
      scopeId: "stc-core",
      conversationId: "conv_current",
      context: { userName: "Paulyne", locationName: "Salon 0495", todayIso: "2026-10-20" },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ACTOR as any,
    memory,
  );
}

beforeEach(() => {
  state.claudeInput = null;
  state.recallInput = null;
  state.memory = null;
});

describe("what the manager told Sunny before", () => {
  it("is recalled for the session's own user, leaving this conversation out", async () => {
    await ask();
    expect(state.recallInput).toMatchObject({
      userId: "user-1",
      question: "What should I do about Sarah Test now?",
      conversationId: "conv_current",
      userName: "Paulyne",
    });
  });

  it("is never recalled without an owner", async () => {
    await ask({});
    expect(state.recallInput).toBeNull();
    expect(state.claudeInput?.personMemory).toBeNull();
  });

  it("reaches the model as its own block, with the rules for using it", async () => {
    state.memory = MEMORY;
    await ask();

    expect(state.claudeInput?.personMemory).toBe(MEMORY);
    const system = String(state.claudeInput?.system);
    expect(system).toContain("WHAT THE MANAGER TOLD YOU BEFORE");
    expect(system).toContain("not a verified record");
    expect(system).toContain("What the manager says now wins");
    expect(system).toContain("A first name can belong to more than one person");
  });

  it("adds no rules when there is nothing to recall", async () => {
    await ask();
    expect(String(state.claudeInput?.system)).not.toContain("WHAT THE MANAGER TOLD YOU BEFORE");
  });
});
