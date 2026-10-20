import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * ============================================================================
 * FORMS ON FILE REACH THE MODEL — AND THE CALLER'S IDENTITY REACHES THE READ
 * ============================================================================
 *
 * `chat-form-records.test.ts` proves the gate, the visibility and the block.
 * This proves the orchestration: that `answerQuestion` loads the block on a
 * question about existing forms, passes the AUTHORIZED actor (not anything
 * from the request) to the read, and hands the block and its rules to Claude.
 */

const state = vi.hoisted(() => ({
  claudeInput: null as Record<string, unknown> | null,
  loadCalls: [] as Record<string, unknown>[],
  block: "FORMS ON FILE (FORM MONITORING)\n\n- 2026-09-12 — Coaching Form; employee: Ellie Sendgraff",
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
  listTemplateSummaries: async () => {
    throw new Error("no library in this test");
  },
}));

vi.mock("@/lib/knowledge/providers/supabase", () => ({
  SupabaseKnowledgeProvider: class {
    async match() {
      return [];
    }
    async fetchRoleGrounding() {
      return null;
    }
    async fetchOfficialPolicyManual() {
      return null;
    }
  },
}));

vi.mock("@/lib/reporting/read/report-briefing", () => ({
  loadReportBriefing: async () => null,
}));

vi.mock("@/lib/reporting/scope/server", () => ({
  resolveScopeFor: async () => null,
}));

vi.mock("@/lib/reporting/read/employee-facts", () => ({
  loadEmployeeFacts: async () => null,
  NO_EMPLOYEE_DATASET_REASON: "no dataset",
  EMPLOYEE_DATA_HEADING: "CURRENT EMPLOYEE PERFORMANCE DATA",
}));

vi.mock("@/lib/forms/chat-form-records", async () => {
  const actual = await vi.importActual<typeof import("@/lib/forms/chat-form-records")>(
    "@/lib/forms/chat-form-records",
  );
  return {
    ...actual,
    loadFormRecords: async (input: Record<string, unknown>) => {
      state.loadCalls.push(input);
      return { block: state.block };
    },
  };
});

vi.mock("./call-claude", () => ({
  callClaude: async (input: Record<string, unknown>) => {
    state.claudeInput = input;
    return "Ellie has one finalized coaching form on file.";
  },
}));

const ACTOR = {
  role: "salon_director" as const,
  scope: { level: "salon" as const, primaryAreaId: "loc-101", alsoCoversAreaIds: [] as string[] },
  subject: "user-1",
  verified: true,
};

async function ask(question: string, history: unknown[] = []) {
  const { answerQuestion } = await import("./server-ask");
  return answerQuestion(
    {
      question,
      mode: "standard" as const,
      history,
      scopeId: "stc-core",
      context: { userName: "Paulyne", locationName: "Salon 101", todayIso: "2026-10-20" },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
    ACTOR,
  );
}

beforeEach(() => {
  state.claudeInput = null;
  state.loadCalls = [];
});

describe("a question about forms already on file", () => {
  it("reads Form Monitoring as the authorized actor and sends the block with its rules", async () => {
    const answer = await ask("does employee ellie sendgraff have previous coachings", [
      { id: "m1", role: "user", content: "hi" },
      { id: "m2", role: "assistant", content: "Hello!" },
    ]);

    expect(state.loadCalls).toHaveLength(1);
    expect(state.loadCalls[0]).toMatchObject({
      actor: ACTOR,
      question: "does employee ellie sendgraff have previous coachings",
      previousQuestion: "hi",
      today: "2026-10-20",
    });

    expect(state.claudeInput?.formRecords).toBe(state.block);
    const system = state.claudeInput?.system as string;
    expect(system).toContain("FORMS ALREADY ON FILE");
    expect(system).toContain("You HAVE checked Form Monitoring");
    // Grounded in a record, so no "the knowledge base does not cover this" banner.
    expect(answer.coverage).toBe("grounded");
  });

  it("does not read Form Monitoring for an ordinary question", async () => {
    await ask("how do I coach someone on spa conversion?");

    expect(state.loadCalls).toHaveLength(0);
    expect(state.claudeInput?.formRecords).toBeNull();
    expect(state.claudeInput?.system as string).not.toContain("FORMS ALREADY ON FILE");
  });
});
