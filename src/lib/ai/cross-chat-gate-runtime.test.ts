import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * ============================================================================
 * THE GATE, NOT THE BACKSTOP: OTHER CHATS NEVER REACH THE PROMPT
 * ============================================================================
 *
 * QA follow-up, 25 Oct. the sibling app's live turns (conv_mvmznap42vcw0dl,
 * conv_mvmzl3vs2kxujv0, conv_mvmzlbhv2ww7y5v, conv_mvmzlvq124nmks8,
 * conv_mvmzl40e2dxpgej), in the manager's exact words. Its store names are swapped for invented salon labels. The real
 * `recallPeople` runs against a database double holding the same manager's
 * other chats about Test Employee; the FORMS ON FILE read is spied on.
 *
 * CROSS_CHAT_REPLY_GUARD_ENABLED on: neither the memory block nor the forms
 * block reaches the model unless the manager refers back or asks about
 * records. Off: the memory block reaches it, as in production today.
 */

const state = vi.hoisted(() => ({
  claudeInput: null as Record<string, unknown> | null,
  recallInput: null as Record<string, unknown> | null,
  memory: null as string | null,
  reply: "",
  formRecordsCalls: [] as Record<string, unknown>[],
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
    async fetchOfficialPolicyManual() {
      return { ok: false, reason: "none" };
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

vi.mock("./call-claude", () => ({
  callClaude: async (input: Record<string, unknown>) => {
    state.claudeInput = input;
    return state.reply;
  },
}));

vi.mock("@/lib/forms/chat-form-records", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/forms/chat-form-records")>()),
  loadFormRecords: async (input: Record<string, unknown>) => {
    state.formRecordsCalls.push(input);
    return { block: "FORMS ON FILE\n\n- 2026-10-24 — Corrective Action Form; employee: Test Employee; status: draft" };
  },
}));

type Row = Record<string, unknown>;

const db = vi.hoisted(() => ({
  tables: {} as Record<string, Row[]>,
  fail: false,
  queries: 0,
}));

class Query {
  private filters: ((row: Row) => boolean)[] = [];
  private orderBy: { column: string; ascending: boolean } | null = null;
  private max = Infinity;
  private single = false;

  constructor(private readonly table: string) {}

  select() {
    return this;
  }
  eq(column: string, value: unknown) {
    this.filters.push((row) => row[column] === value);
    return this;
  }
  neq(column: string, value: unknown) {
    this.filters.push((row) => row[column] !== value);
    return this;
  }
  is(column: string, value: null) {
    this.filters.push((row) => (row[column] ?? null) === value);
    return this;
  }
  in(column: string, values: unknown[]) {
    this.filters.push((row) => values.includes(row[column]));
    return this;
  }
  ilike(column: string, pattern: string) {
    const needle = pattern.replace(/%/g, "").toLowerCase();
    this.filters.push((row) => String(row[column] ?? "").toLowerCase().includes(needle));
    return this;
  }
  order(column: string, options?: { ascending?: boolean }) {
    this.orderBy = { column, ascending: options?.ascending ?? true };
    return this;
  }
  limit(count: number) {
    this.max = count;
    return this;
  }
  maybeSingle() {
    this.single = true;
    return this;
  }
  then<T>(resolve: (value: { data: unknown; error: { message: string } | null }) => T) {
    db.queries += 1;
    if (db.fail) return Promise.resolve(resolve({ data: null, error: { message: "unreachable" } }));
    let rows = (db.tables[this.table] ?? []).filter((row) => this.filters.every((keep) => keep(row)));
    if (this.orderBy) {
      const { column, ascending } = this.orderBy;
      rows = [...rows].sort((a, b) =>
        String(a[column]).localeCompare(String(b[column])) * (ascending ? 1 : -1),
      );
    }
    rows = rows.slice(0, this.max);
    return Promise.resolve(resolve({ data: this.single ? (rows[0] ?? null) : rows, error: null }));
  }
}

vi.mock("@/lib/supabase/server", () => ({
  getSupabaseAdmin: () => ({ from: (table: string) => new Query(table) }),
}));

const ACTOR = { role: "salon_director" as const, scope: { level: "salon" as const, salonIds: ["loc-0495"] } };

const ME = "user-1";

function seedOtherChats() {
  let seq = 0;
  const chat = (createdAt: string, content: string) => {
    seq += 1;
    const id = `row-${seq}`;
    db.tables.chat_conversations!.push({
      id,
      user_id: ME,
      client_conversation_id: `conv_other_${seq}`,
      title: content,
      created_at: createdAt,
      deleted_at: null,
      archived_at: null,
    });
    db.tables.chat_messages!.push({
      conversation_id: id,
      user_id: ME,
      client_message_id: `msg_other_${seq}`,
      role: "user",
      content,
      created_at: createdAt,
      position: 0,
    });
  };
  // The same manager's earlier chats about the same person (real wording).
  chat("2026-10-12T15:05:51Z", "CA for Test Employee at Salon 0101, out of dress code 10/11");
  chat("2026-10-13T13:24:02Z", "Verbal CA for Test Employee at Salon 0202, NE, register short $40, payroll applies");
  db.tables.form_instances!.push({
    employee_name: "Test Employee",
    status: "draft",
    form_date: "2026-10-13",
    created_by: ME,
    archived_at: null,
    created_at: "2026-10-13T13:25:00Z",
    form_templates: { name: "Corrective Action Form" },
  });
}

async function ask(question: string, history: { role: string; content: string }[] = []) {
  const { answerQuestion } = await import("./server-ask");
  return answerQuestion(
    {
      question,
      mode: "standard",
      history,
      scopeId: "stc-core",
      conversationId: "conv_current",
      context: { userName: "Rosalyn", locationName: "Salon 0495", todayIso: "2026-10-24" },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ACTOR as any,
    { memoryOwnerId: ME },
  );
}

const CASES: [string, string, { role: string; content: string }[]][] = [
  ["T1 conv_mvmznap42vcw0dl", "do verbal for team member Test Employee at salon 0303. payroll deduct does not apply. previous coaching jba manual 11-1-26. on 10-22-26 Test was not scheduled to work and came into the salon to show her team her new puppy. Test was in the store 45 min", []],
  ["A2 conv_mvmzl3vs2kxujv0", "Her name is Test Employee", [{"role": "user", "content": "I need to coach an employee"}, {"role": "assistant", "content": "Happy to help you build this out. What did you observe?"}]],
  ["A5 conv_mvmzlbhv2ww7y5v", "Test Employee at Salon 0495 used her cell phone on the sales floor on 10-17", []],
  ["LR conv_mvmzlvq124nmks8", "I have an employee Test Employee at our Salon 0495 salon who has been out of dress code three shifts. I verbally coached her on the second offense and she still is out of dress code", []],
  ["A1 conv_mvmzl40e2dxpgej", "Test Employee at Salon 0495 was out of dress code on 10-18, no name tag and wrong shirt for the whole shift", []],
];

const saved = process.env.CROSS_CHAT_REPLY_GUARD_ENABLED;

beforeAll(async () => {
  await import("./server-ask");
}, 60_000);

beforeEach(() => {
  state.claudeInput = null;
  state.reply = "Here is how I would approach it.";
  state.formRecordsCalls = [];
  db.tables = { chat_conversations: [], chat_messages: [], chat_history_boundaries: [], form_instances: [] };
  db.fail = false;
  db.queries = 0;
  seedOtherChats();
});

afterEach(() => {
  if (saved === undefined) delete process.env.CROSS_CHAT_REPLY_GUARD_ENABLED;
  else process.env.CROSS_CHAT_REPLY_GUARD_ENABLED = saved;
});

describe("CROSS_CHAT_REPLY_GUARD_ENABLED keeps other chats out of the prompt", () => {
  it.each(CASES)("%s: no memory block and no forms-on-file block reach the model", async (_case, question, history) => {
    process.env.CROSS_CHAT_REPLY_GUARD_ENABLED = "true";
    await ask(question, history);

    expect(state.claudeInput).not.toBeNull();
    expect(state.claudeInput?.personMemory ?? null).toBeNull();
    expect(state.claudeInput?.formRecords ?? null).toBeNull();
    expect(state.formRecordsCalls).toEqual([]);
    const system = String(state.claudeInput?.system);
    expect(system).not.toContain("WHAT THE MANAGER TOLD YOU BEFORE");
    expect(system).not.toContain("Test Employee");
  });

  it("off, the same turn carries the other chats, as in production today", async () => {
    delete process.env.CROSS_CHAT_REPLY_GUARD_ENABLED;
    await ask(CASES[1]![1], CASES[1]![2]);
    expect(String(state.claudeInput?.personMemory)).toContain("Salon 0101");
  });

  it("off, the T1 form request reads the Forms Register, as in production today", async () => {
    delete process.env.CROSS_CHAT_REPLY_GUARD_ENABLED;
    await ask(CASES[0]![1], CASES[0]![2]);
    expect(state.formRecordsCalls).toHaveLength(1);
  });

  it("recalls when the manager refers back: 'her earlier CA'", async () => {
    process.env.CROSS_CHAT_REPLY_GUARD_ENABLED = "true";
    await ask("what about Test Employee's earlier CA? same as last time", CASES[1]![2]);
    const memory = String(state.claudeInput?.personMemory);
    expect(memory).toContain("records from OTHER conversations");
    expect(memory).toContain("- Corrective Action Form for Test Employee — dated 2026-10-13, draft, not finalized");
  });

  it("reads the Forms Register for a question about records, marking who created each row", async () => {
    process.env.CROSS_CHAT_REPLY_GUARD_ENABLED = "true";
    await ask("does Test Employee have previous coachings?");
    expect(state.formRecordsCalls).toHaveLength(1);
    expect(state.formRecordsCalls[0]).toMatchObject({ markCreator: true });
  });
});
