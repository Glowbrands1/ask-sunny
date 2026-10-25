import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * ============================================================================
 * "THE SOURCES YOU JUST SHARED" — the live answer path
 * ============================================================================
 *
 * Ported from Ask Bubbles (production, 25 Oct 2026). A coaching conversation:
 *
 *   T1 "I need to coach an employee"
 *   T2 "Her name is Test Employee"
 *   T3 "She works at Lawrence"
 *   T4 "It happened on 10-21"
 *
 * There, T3 was searched on its own words, found unrelated product pages, and
 * the reply told the manager "the sources you just shared are all …" — the
 * manager shared nothing. The excerpts are what the app retrieved, and they
 * sit in the same user message as the question, unlabelled as to who put them
 * there. T4 was searched on "It happened on 10-21" and found unrelated pages
 * too. Here, "It happened on 10-21" points back ("it") and was searched with
 * the previous turn — "She works at Lawrence" — which is no topic either.
 *
 * Three guards, all checked here through `answerQuestion`:
 *   1. a turn that only supplies a salon or a date is searched with the
 *      conversation's topic, not its own words;
 *   2. the prompt says retrieved sources are the app's own reference
 *      material, never something the manager shared, sent or provided;
 *   3. a reply that still says so is neutralised, and only when the
 *      manager's turns carry no paste.
 */

const state = vi.hoisted(() => ({
  queries: [] as string[],
  system: "",
  grounding: "",
  reply: "",
  rewrites: [] as string[],
}));

vi.mock("./query-rewrite-claude", () => ({
  rewriteToManualTerms: async (input: { question: string }) => {
    state.rewrites.push(input.question);
    return input.question;
  },
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
    async match(query: { query: string }) {
      state.queries.push(query.query);
      return [
        {
          chunk_id: "c1",
          document_id: "d1",
          document_title: "Product Guide: Naturally WOWW Face Lotion",
          category: "other",
          locator: "Page 1",
          page: 1,
          section: null,
          content: "Apply a thin layer after tanning.",
          similarity: 0.8,
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
  callClaude: async (input: { system: string; grounding: string }) => {
    state.system = input.system;
    state.grounding = input.grounding;
    return state.reply;
  },
}));

const ACTOR = { role: "salon_director" as never, scope: { level: "salon", primaryAreaId: "loc-0314", alsoCoversAreaIds: [] } };

const T1 = "I need to coach an employee";
const T2 = "Her name is Test Employee";
const T3 = "She works at Lawrence";
const T4 = "It happened on 10-21";

const turn = (id: string, role: "user" | "assistant", content: string) => ({
  id,
  role,
  content,
  createdAt: "2026-10-25T08:59:00Z",
});

const HISTORY_T3 = [
  turn("u1", "user", T1),
  turn("a1", "assistant", "Happy to help structure that. Who's the coaching for, and what's the behavior or topic?"),
  turn("u2", "user", T2),
  turn("a2", "assistant", "Got it, Test Employee it is. What's the behavior or topic, and what did you actually observe?"),
];

/** The Bubbles T3 reply, with the salon and the documents this corpus would return. */
const REPLY_T3 = `Noted — Lawrence. I don't have an employee record for "Test Employee," so I can't verify her title, status, or that she's actually assigned there — I'll just use what you've told me.

That said, the sources you just shared are all lotion product guides and bed troubleshooting (Naturally WOWW Face Lotion, UV Tanning Bed Troubleshooting, etc.) — none of them touch coaching, performance, or conduct topics, so I can't build a coaching plan from them.

To move forward I still need:

1. **What's the behavior or issue?**
2. **What did you actually observe** — specifics, not a general impression.`;

async function ask(question: string, history: ReturnType<typeof turn>[]) {
  const { answerQuestion } = await import("./server-ask");
  return answerQuestion(
    {
      question,
      mode: "standard",
      history,
      scopeId: "stc-core",
      context: { userName: "Dana Reyes", locationName: "All areas", todayIso: "2026-10-25" },
    } as never,
    ACTOR as never,
  );
}

// The first import of server-ask is the slow part.
beforeAll(async () => {
  await import("./server-ask");
}, 60_000);

beforeEach(() => {
  state.queries = [];
  state.system = "";
  state.grounding = "";
  state.reply = "An answer.";
  state.rewrites = [];
});

describe("a salon or a date is not a new topic to search", () => {
  it('T3 "She works at Lawrence" is not searched on its own words', async () => {
    await ask(T3, HISTORY_T3);
    expect(state.queries.some((query) => /lawrence/i.test(query))).toBe(false);
    expect(state.queries.length === 0 || state.queries.some((query) => /coach/i.test(query))).toBe(true);
  });

  it('T4 "It happened on 10-21" is not searched on its own words', async () => {
    await ask(T4, [...HISTORY_T3, turn("u3", "user", T3), turn("a3", "assistant", "Noted — Lawrence.")]);
    expect(state.queries.some((query) => /10-21|happened|lawrence/i.test(query))).toBe(false);
    expect(state.queries.length === 0 || state.queries.some((query) => /coach/i.test(query))).toBe(true);
  });

  it("with the manual-terms rewrite on, as in production, the slot turn is not rewritten from its own words", async () => {
    const saved = process.env.QUERY_REWRITE_ENABLED;
    process.env.QUERY_REWRITE_ENABLED = "1";
    try {
      await ask(T3, HISTORY_T3);
    } finally {
      if (saved === undefined) delete process.env.QUERY_REWRITE_ENABLED;
      else process.env.QUERY_REWRITE_ENABLED = saved;
    }
    expect(state.rewrites).not.toContain(T3);
    expect(state.queries.some((query) => /lawrence/i.test(query))).toBe(false);
    expect(state.queries.length === 0 || state.queries.some((query) => /coach/i.test(query))).toBe(true);
  });

  it("a turn that names the behaviour is still searched on its own words", async () => {
    const T5 = "She was on her cell phone for 30+ minutes at the front desk";
    await ask(T5, [
      ...HISTORY_T3,
      turn("u3", "user", T3),
      turn("a3", "assistant", "Noted."),
      turn("u4", "user", T4),
      turn("a4", "assistant", "Thanks for the date."),
    ]);
    expect(state.queries.some((query) => query.includes(T5))).toBe(true);
  });

  it("a first turn with no topic before it is searched as typed", async () => {
    await ask(T3, []);
    expect(state.queries.some((query) => /lawrence/i.test(query))).toBe(true);
  });
});

describe("retrieved sources are not something the manager shared", () => {
  it("the prompt says retrieved sources are the app's own, never shared, sent or provided by the manager", async () => {
    await ask(T3, HISTORY_T3);
    const prompt = `${state.system}\n\n${state.grounding}`;
    expect(prompt).toMatch(/never something the manager shared, sent, pasted or provided/i);
    expect(prompt).toMatch(/never call them "the sources you shared"/i);
    expect(state.grounding).toMatch(/retrieved by this app from the company knowledge base/i);
  });

  it("the T3 reply no longer says the manager shared the sources", async () => {
    state.reply = REPLY_T3;
    const response = await ask(T3, HISTORY_T3);
    expect(response.content).not.toMatch(/you just shared/i);
    expect(response.content).not.toMatch(/sources you (?:just )?(?:shared|sent|provided)/i);
    expect(response.content).toContain("the sources I found are all lotion product guides");
    expect(response.content).toContain("What did you actually observe");
  });

  it("a manager who pasted text keeps the reply as written", async () => {
    const pasted = `Here is what she wrote in the shift log:\n\nArrived 10 minutes late.\nSkipped the opening checklist.\nLeft the front desk unattended.\n\nWhat do I do with this?`;
    state.reply = "The notes you shared show three separate misses.";
    const response = await ask(pasted, HISTORY_T3);
    expect(response.content).toContain("The notes you shared show three separate misses.");
  });
});
