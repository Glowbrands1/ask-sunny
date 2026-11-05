import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  block: "FORMS ON FILE (FORM MONITORING)\n\n- 2026-09-12 — Coaching Form; employee: Wren Halvorsen",
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
    return "Wren has one finalized coaching form on file.";
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
      context: { userName: "Rosalyn", locationName: "Salon 101", todayIso: "2026-10-20" },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
    ACTOR,
  );
}

beforeEach(() => {
  state.claudeInput = null;
  state.loadCalls = [];
});

/*
 * PAST_FORMS_BEFORE_LIBRARY_ENABLED (Pau, 5 Nov 2026; overnight scan sf-s29).
 * The library is unreadable in this file (`listTemplateSummaries` throws), so a
 * library answer surfaces as a rejection; the past-forms lookup is
 * `loadFormRecords` (counted in `state.loadCalls`) and its block goes to the
 * model. Invented names.
 */
const SF_S29 = "are there any coaching and ca's for Wren Halvorsen";
const NAMED_LIBRARY = "do we have a coaching form for Wren Halvorsen?";
const CONTROL = "do we have a coaching form?";

describe("the past-forms lookup before the forms-library check", { timeout: 30_000 }, () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("off (production today): sf-s29 goes to the forms library, and no forms on file are read", async () => {
    await expect(ask(SF_S29)).rejects.toThrow();
    expect(state.loadCalls).toHaveLength(0);
  });

  it("on: sf-s29 and a library question that names a person read the forms on file; the library steps aside", async () => {
    vi.stubEnv("PAST_FORMS_BEFORE_LIBRARY_ENABLED", "true");
    for (const question of [SF_S29, NAMED_LIBRARY]) {
      state.loadCalls = [];
      state.claudeInput = null;
      await ask(question);
      expect(state.loadCalls, question).toHaveLength(1);
      expect((state.claudeInput as Record<string, unknown> | null)?.formRecords, question).toBe(state.block);
    }
  });

  it("on, negative control: \"do we have a coaching form?\" still goes to the forms library", async () => {
    vi.stubEnv("PAST_FORMS_BEFORE_LIBRARY_ENABLED", "true");
    await expect(ask(CONTROL)).rejects.toThrow();
    expect(state.loadCalls).toHaveLength(0);
  });
});
