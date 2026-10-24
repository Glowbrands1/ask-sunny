import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * FORM_FULL_REMAP_ENABLED through `answerQuestion`, with Supabase and Claude
 * mocked.
 *
 * An earlier chat set payroll deduct $40 at KS Lawrence. The browser can
 * still send that turn in `history` when the manager starts a new chat. On
 * the scoped path `historyForRemap` drops it, because its id is stored on a
 * different conversation. The fallback (no signed-in subject, no
 * conversation id, or the store read fails) used the browser history as
 * sent, so the $40 and Lawrence filled the new card.
 * FORM_REMAP_STRICT_SCOPE_ENABLED makes that fallback read only the current
 * question.
 */

const state = vi.hoisted(() => ({
  toolCalls: [] as { system: string; messages: { role: string; content: string }[] }[],
  proposeCalls: 0,
  storeFails: false,
  reads: [] as { table: string; filters: Record<string, string> }[],
  conversations: [] as { id: string; user_id: string; client_conversation_id: string }[],
  messages: [] as {
    user_id: string;
    conversation_id: string;
    client_message_id: string;
    role: string;
    content: string;
    position: number;
  }[],
  traces: [] as { user_id: string; conversation_id: string; slots: unknown }[],
}));

vi.mock("@/lib/config/server-env", () => ({
  liveReadiness: () => ({ mode: "live", missing: [], problems: [], ready: true }),
  MissingConfigurationError: class MissingConfigurationError extends Error {
    missing: string[] = [];
  },
}));

function template(key: string, name: string, shortName: string, layoutFamily: string, requiredPermission: string, displayOrder: number) {
  return {
    id: `tpl-${key}-id`,
    key,
    name,
    shortName,
    description: name,
    layoutFamily,
    requiredPermission,
    active: true,
    displayOrder,
    currentVersion: { id: `v-${key}`, status: "published" },
    draftVersion: null,
    versionCount: 1,
    activeAsset: null,
    assetCount: 0,
  };
}

vi.mock("@/lib/forms/repository", () => ({
  listTemplateSummaries: async () => [
    template("coaching", "Coaching Form", "Coaching", "coaching", "create_coaching_form", 1),
    template("dpoa", "Corrective Action Form", "DPOA", "corrective", "create_corrective_action", 2),
  ],
}));

vi.mock("./form-proposal", () => ({
  proposeFormForTurn: async () => {
    state.proposeCalls += 1;
    return { content: "proposal path", citations: [], recommendedVideoIds: [] };
  },
  suggestFormsForTurn: () => null,
}));

vi.mock("@/lib/forms/employee-roster", () => ({
  loadScopedRoster: async () => [],
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
      return { ok: false };
    }
  },
}));

vi.mock("@/lib/reporting/read/report-briefing", () => ({ loadReportBriefing: async () => null }));
vi.mock("@/lib/reporting/scope/server", () => ({ resolveScopeFor: async () => null }));

vi.mock("@/lib/supabase/server", () => ({
  getSupabaseAdmin: () => ({
    from(table: string) {
      const filters: Record<string, string> = {};
      let ids: string[] = [];
      const rows = () => {
        if (table === "chat_conversations") {
          return state.conversations.filter(
            (row) => row.user_id === filters.user_id && row.client_conversation_id === filters.client_conversation_id,
          );
        }
        if (table === "chat_messages") {
          return state.messages.filter((row) => {
            if (filters.user_id && row.user_id !== filters.user_id) return false;
            if (filters.conversation_id && row.conversation_id !== filters.conversation_id) return false;
            if (ids.length > 0 && !ids.includes(row.client_message_id)) return false;
            return true;
          });
        }
        return state.traces.filter(
          (row) => row.user_id === filters.user_id && row.conversation_id === filters.conversation_id,
        );
      };
      const result = () => {
        state.reads.push({ table, filters: { ...filters } });
        return state.storeFails
          ? { data: null, error: { message: "store unavailable" } }
          : null;
      };
      const api = {
        select() {
          return api;
        },
        eq(column: string, value: string) {
          filters[column] = value;
          return api;
        },
        is() {
          return api;
        },
        in(_column: string, values: string[]) {
          ids = values;
          return api;
        },
        order() {
          return api;
        },
        limit() {
          return api;
        },
        maybeSingle: async () => result() ?? { data: rows().at(-1) ?? null, error: null },
        then(resolve: (value: unknown) => void) {
          resolve(result() ?? { data: rows(), error: null });
        },
      };
      return api;
    },
  }),
}));

vi.mock("./call-claude", () => ({
  callClaude: async () => {
    throw new Error("a remapped form turn does not reach the answer model");
  },
  callClaudeTool: async (input: { system: string; messages: { role: string; content: string }[] }) => {
    state.toolCalls.push({ system: input.system, messages: input.messages });
    // What a model reads when the foreign turn is in front of it.
    return {
      templateKey: "dpoa",
      employeeName: "Test Employee",
      observation: "cell phone use 30+ min",
      store: "KS Lawrence",
      payrollDeduct: "yes",
      payrollAmount: "$40",
    };
  },
}));

const USER = "user-1";
const TODAY = "2026-10-24";
const PAYROLL =
  "corrective action for Test Employee at Lawrence, payroll deduct $40. She left the register drawer open on October 1. Verbal warning.";
const CELL = "verbal CA for Test Employee, on cell phone 30+ min 10-20";
const CARRY = /\$40|Lawrence|loc-0468|2026-10-01|register drawer/;

const ACTOR = {
  role: "salon_director" as const,
  scope: { level: "salon" as const, primaryAreaId: "loc-0309", alsoCoversAreaIds: [] as string[] },
  subject: USER,
  verified: true,
};

const FOREIGN_HISTORY = [{ id: "msg-payroll", role: "user", content: PAYROLL, createdAt: "2026-10-24T14:00:00Z" }];

async function ask(options: {
  actor?: Record<string, unknown>;
  conversationId?: string | null;
  history?: unknown[];
  storeFail?: boolean;
}) {
  state.storeFails = options.storeFail === true;
  const { answerQuestion } = await import("./server-ask");
  const conversationId = options.conversationId === undefined ? "conv_mvmj8a26gtq901w" : options.conversationId;
  return answerQuestion(
    {
      question: CELL,
      mode: "standard" as const,
      history: options.history ?? FOREIGN_HISTORY,
      scopeId: "stc-core",
      questionMessageId: "msg-cell",
      ...(conversationId ? { conversationId } : {}),
      context: { userName: "Test Manager", locationName: "NE Kearney", todayIso: TODAY },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (options.actor ?? ACTOR) as any,
  );
}

function sentToModel(): string {
  return state.toolCalls.map((call) => call.messages.map((message) => message.content).join("\n")).join("\n");
}

function shown(answer: { content: string; formProposal?: unknown }): string {
  return `${answer.content}\n${JSON.stringify(answer.formProposal ?? null)}`;
}

// server-ask's first import is slow; keep it out of the first test's 5s limit.
beforeAll(async () => {
  await import("./server-ask");
}, 60_000);

beforeEach(() => {
  vi.stubEnv("FORM_FULL_REMAP_ENABLED", "1");
  vi.stubEnv("FORM_REMAP_STRICT_SCOPE_ENABLED", "");
  state.toolCalls = [];
  state.proposeCalls = 0;
  state.storeFails = false;
  state.reads = [];
  state.conversations = [{ id: "uuid-payroll", user_id: USER, client_conversation_id: "conv-payroll" }];
  state.messages = [
    {
      user_id: USER,
      conversation_id: "uuid-payroll",
      client_message_id: "msg-payroll",
      role: "user",
      content: PAYROLL,
      position: 0,
    },
  ];
  state.traces = [
    {
      user_id: USER,
      conversation_id: "conv-payroll",
      slots: { payrollDeduct: "yes", payrollAmount: "$40", store: "KS Lawrence", locationId: "loc-0468" },
    },
  ];
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("FORM_FULL_REMAP_ENABLED through answerQuestion", () => {
  it("scopes the history to this conversation id and fills the card from this chat only", async () => {
    const answer = await ask({});

    // historyForRemap ran for this user and this conversation id.
    expect(state.reads).toContainEqual({
      table: "chat_conversations",
      filters: { user_id: USER, client_conversation_id: "conv_mvmj8a26gtq901w" },
    });
    expect(state.reads).toContainEqual({
      table: "chat_traces",
      filters: { user_id: USER, conversation_id: "conv_mvmj8a26gtq901w" },
    });
    // remapFormTurn answered; the proposal path and the answer model were not used.
    expect(state.toolCalls).toHaveLength(1);
    expect(state.proposeCalls).toBe(0);
    expect(sentToModel()).toContain(CELL);
    expect(sentToModel()).not.toMatch(CARRY);

    expect(answer.formProposal?.templateKey).toBe("dpoa");
    expect(shown(answer)).not.toMatch(CARRY);
    expect(answer.content).toContain("Which salon?");
  });

  it("does not run the remap with the flag off", async () => {
    vi.stubEnv("FORM_FULL_REMAP_ENABLED", "");
    await ask({});
    expect(state.toolCalls).toHaveLength(0);
    expect(state.reads.filter((read) => read.table === "chat_conversations")).toHaveLength(0);
    expect(state.proposeCalls).toBe(1);
  });
});

const FALLBACKS = [
  ["no signed-in subject", { actor: { ...ACTOR, subject: undefined } }],
  ["no conversation id", { conversationId: null }],
  ["the database read fails", { storeFail: true }],
] as const;

describe("the fallback when this conversation cannot be read", () => {
  it.each(FALLBACKS)("%s: the browser history is used as sent with the strict-scope flag off", async (_label, setup) => {
    // This is the bug as it ships with FORM_REMAP_STRICT_SCOPE_ENABLED off:
    // the $40 payroll turn from the other chat reaches the extraction, and its
    // salon (KS Lawrence) and its date (October 1, not 10-20) fill the new card.
    const answer = await ask(setup);
    expect(state.toolCalls).toHaveLength(1);
    expect(sentToModel()).toContain(PAYROLL);
    expect(answer.formProposal?.locationId).toBe("loc-0468");
    expect(answer.formProposal?.formDate).toBe("2026-10-01");
    expect(shown(answer)).toMatch(CARRY);
  });

  it.each(FALLBACKS)("%s: a payroll chat from another conversation does not fill the new card", async (_label, setup) => {
    vi.stubEnv("FORM_REMAP_STRICT_SCOPE_ENABLED", "1");
    const answer = await ask(setup);

    expect(state.toolCalls).toHaveLength(1);
    expect(state.proposeCalls).toBe(0);
    expect(sentToModel()).toContain(CELL);
    expect(sentToModel()).not.toMatch(CARRY);

    expect(answer.formProposal?.templateKey).toBe("dpoa");
    expect(answer.formProposal?.locationId ?? null).toBeNull();
    expect(answer.formProposal?.formDate).toBe("2026-10-20");
    expect(shown(answer)).not.toMatch(CARRY);
    expect(answer.content).toContain("Which salon?");
  });
});
