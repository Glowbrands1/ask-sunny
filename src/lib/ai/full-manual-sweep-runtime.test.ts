import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import rows from "@/test/fixtures/jba-manual-production-151.json";

/**
 * ============================================================================
 * QA POLICY SWEEP, 25 OCT 2026 — through `answerQuestion`
 * ============================================================================
 *
 * A question the policy gate does not take (here "Where should employees
 * park?" with intent extraction off) is answered from retrieved excerpts,
 * cited [S#], and every [S#] is taken out before the reply is shown: the
 * manager saw a "Page 18" source and no [p.N] beside the sentence. Sunny's
 * sweep turn E1 ("Who is eligible for PTO and when does it start?") was such
 * a turn, kept out of the manual by the gate.
 *
 * The manual is the 151 production rows, read through the real loader; the
 * retrieved row is the stored chunk.
 */

const state = vi.hoisted(() => ({
  rows: [] as Record<string, unknown>[],
  reply: "",
  fullManualBlocks: [] as (string | null)[],
}));

vi.mock("./query-rewrite-claude", () => ({
  rewriteToManualTerms: async (input: { question: string }) => input.question,
}));
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

/* The manual tables, as the full-manual loader reads them. */
vi.mock("@/lib/supabase/server", async () => {
  const fixture = (await import("@/test/fixtures/jba-manual-production-151.json")).default;
  const tables: Record<string, unknown[]> = {
    knowledge_documents: [
      { id: fixture.document_ids["ask-sunny"], title: fixture.title, category: "policies_compliance", version: 1 },
    ],
    knowledge_chunks: fixture.chunks,
  };
  const query = (rowsFor: unknown[]) => {
    const result = { data: rowsFor, error: null };
    const builder: Record<string, unknown> = {};
    for (const name of ["select", "eq", "is", "in", "order", "range", "limit", "neq", "gte", "lte", "match"]) {
      builder[name] = () => builder;
    }
    builder.then = (resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve);
    return builder;
  };
  return { getSupabaseAdmin: () => ({ from: (table: string) => query(tables[table] ?? []) }) };
});

vi.mock("./call-claude", () => ({
  callClaude: async (input: { fullManualBlock?: string | null }) => {
    state.fullManualBlocks.push(input.fullManualBlock ?? null);
    return state.reply;
  },
}));

const ACTOR = { role: "salon_director" as never, scope: { level: "salon", primaryAreaId: "loc-0314", alsoCoversAreaIds: [] } };

function manualRow(chunkIndex: number, similarity: number) {
  const chunk = rows.chunks.find((row) => row.chunk_index === chunkIndex)!;
  return {
    chunk_id: `chunk-${chunkIndex}`,
    document_id: rows.document_ids["ask-sunny"],
    document_title: rows.title,
    category: "policies_compliance",
    locator: chunk.locator,
    page: chunk.page,
    section: chunk.section,
    content: chunk.content,
    similarity,
  };
}

async function ask(question: string) {
  const { answerQuestion } = await import("./server-ask");
  return answerQuestion(
    {
      question,
      mode: "standard",
      history: [],
      scopeId: "stc-core",
      context: { userName: "Test Manager", locationName: "All areas", todayIso: "2026-10-25" },
    } as never,
    ACTOR as never,
  );
}

beforeAll(async () => {
  await import("./server-ask");
}, 60_000);

beforeEach(() => {
  state.rows = [];
  state.reply = "An answer.";
  state.fullManualBlocks = [];
  process.env.FULL_MANUAL_CONTEXT_ENABLED = "1";
});

afterEach(() => {
  delete process.env.FULL_MANUAL_CONTEXT_ENABLED;
});

describe("a reply answered from retrieval shows its [p.N] beside its source", () => {
  it('"Where should employees park?" → [p.18], Employee Parking', async () => {
    state.rows = [manualRow(55, 0.925)];
    state.reply =
      "Employees shouldn't park in the spots closest to the front of the location — those are reserved for customers [S1].";
    const response = await ask("Where should employees park?");
    expect(state.fullManualBlocks[0]).toBeNull();
    expect(response.content).toBe(
      "Employees shouldn't park in the spots closest to the front of the location — those are reserved for customers [p.18].",
    );
    expect(response.citations.map((citation) => `${citation.locator} ${citation.excerpt}`)).toEqual([
      "Page 18 Employee Parking",
    ]);
  }, 30_000);

  it("with the full manual off, the reply is as before", async () => {
    delete process.env.FULL_MANUAL_CONTEXT_ENABLED;
    state.rows = [manualRow(55, 0.925)];
    state.reply =
      "Employees shouldn't park in the spots closest to the front of the location — those are reserved for customers [S1].";
    const response = await ask("Where should employees park?");
    expect(response.content).toBe(
      "Employees shouldn't park in the spots closest to the front of the location — those are reserved for customers.",
    );
    expect(response.citations.map((citation) => citation.locator)).toEqual(["Page 18 — Employee Parking"]);
  }, 30_000);
});

describe("E1: Who is eligible for PTO and when does it start?", () => {
  it("is asked with the whole manual, and its reply is cited on printed pages", async () => {
    state.rows = [manualRow(137, 0.889)];
    state.reply =
      "All salaried managers, full-time corporate office personnel, and full-time Assistant Salon Directors/Assistant Makery Managers begin accruing PTO after 90 days of employment in that position [p.41].";
    const response = await ask("Who is eligible for PTO and when does it start?");
    expect(state.fullManualBlocks[0]).toMatch(/\[p\.41\]/);
    expect(response.content).toContain("[p.41]");
    expect(response.citations.map((citation) => `${citation.locator} ${citation.excerpt}`)).toEqual(["Page 41 Eligibility"]);
  }, 30_000);
});
