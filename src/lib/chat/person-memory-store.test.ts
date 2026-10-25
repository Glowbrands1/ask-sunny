import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * ============================================================================
 * WHAT IS RECALLED, AND WHAT NEVER IS
 * ============================================================================
 *
 * `recallPeople` against an in-memory double of the four tables it reads. The
 * double applies every filter the module asks for, so a missing `user_id`
 * predicate shows up as another person's words in the block.
 */

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

const ME = "11111111-1111-4111-8111-111111111111";
const SOMEONE_ELSE = "22222222-2222-4222-8222-222222222222";

let conversationSeq = 0;

/** One stored conversation, with the manager's turns and one reply each. */
function conversation(input: {
  userId?: string;
  clientId?: string;
  title?: string;
  createdAt?: string;
  deletedAt?: string | null;
  turns: string[];
}) {
  conversationSeq += 1;
  const id = `row-${conversationSeq}`;
  const createdAt = input.createdAt ?? "2026-10-03T15:00:00Z";
  db.tables.chat_conversations!.push({
    id,
    user_id: input.userId ?? ME,
    client_conversation_id: input.clientId ?? `conv_${conversationSeq}`,
    title: input.title ?? input.turns[0],
    created_at: createdAt,
    deleted_at: input.deletedAt ?? null,
    archived_at: null,
  });
  input.turns.forEach((content, index) => {
    const at = new Date(Date.parse(createdAt) + index * 60_000).toISOString();
    db.tables.chat_messages!.push(
      {
        conversation_id: id,
        user_id: input.userId ?? ME,
        client_message_id: `msg_${conversationSeq}_${index}_u`,
        role: "user",
        content,
        created_at: at,
        position: index * 2,
      },
      {
        conversation_id: id,
        user_id: input.userId ?? ME,
        client_message_id: `msg_${conversationSeq}_${index}_a`,
        role: "assistant",
        content: `Sunny's reply about ${content}`,
        created_at: at,
        position: index * 2 + 1,
      },
    );
  });
  return { id, clientId: input.clientId ?? `conv_${conversationSeq}` };
}

async function recall(question: string, extra: Record<string, unknown> = {}) {
  const { recallPeople } = await import("./person-memory-store");
  return recallPeople({ userId: ME, question, history: [], userName: "Rosalyn", ...extra });
}

beforeEach(() => {
  db.tables = {
    chat_conversations: [],
    chat_messages: [],
    chat_history_boundaries: [],
    form_instances: [],
  };
  db.fail = false;
  db.queries = 0;
});

describe("recallPeople", () => {
  it("recalls what this manager said about the person in an earlier conversation", async () => {
    conversation({ turns: ["Coaching form for Sarah Test", "She was late three times this week"] });

    const block = await recall("What should I do about Sarah Test now?");

    expect(block).toContain("ABOUT SARAH TEST");
    expect(block).toContain("> Coaching form for Sarah Test");
    expect(block).toContain("> She was late three times this week");
  });

  it("quotes the manager, never Sunny's earlier answers", async () => {
    conversation({ turns: ["Coaching form for Sarah Test"] });
    const block = await recall("How is Sarah Test doing?");
    expect(block).not.toContain("Sunny's reply");
  });

  it("never reads another person's history", async () => {
    conversation({ userId: SOMEONE_ELSE, turns: ["Coaching form for Sarah Test, she stole"] });
    expect(await recall("What about Sarah Test?")).toBeNull();
  });

  it("forgets a deleted conversation", async () => {
    conversation({ deletedAt: "2026-10-05T00:00:00Z", turns: ["Coaching form for Sarah Test"] });
    expect(await recall("What about Sarah Test?")).toBeNull();
  });

  it("forgets everything created at or before the account's clear", async () => {
    conversation({ createdAt: "2026-10-01T15:00:00Z", turns: ["Coaching form for Sarah Test"] });
    db.tables.chat_history_boundaries!.push({ user_id: ME, history_cleared_at: "2026-10-02T00:00:00Z" });
    expect(await recall("What about Sarah Test?")).toBeNull();
  });

  it("does not quote a different chat from today", async () => {
    const today = "2026-10-23";
    conversation({
      createdAt: `${today}T15:00:00Z`,
      turns: ["coaching for Lisa Smith at Lawrence"],
    });
    conversation({
      createdAt: "2026-10-03T15:00:00Z",
      turns: ["Lisa Smith was late last month"],
    });
    const block = await recall("What about Lisa Smith?", { todayIso: today });
    expect(block).toContain("Lisa Smith was late last month");
    expect(block).not.toContain("coaching for Lisa Smith at Lawrence");
    expect(block).not.toContain(today);
  });

  it("leaves the current conversation out, by its id", async () => {
    const current = conversation({ turns: ["Coaching form for Sarah Test"] });
    expect(await recall("What about Sarah Test?", { conversationId: current.clientId })).toBeNull();
  });

  it("leaves the current conversation out, by its turns, when no id was sent", async () => {
    conversation({ turns: ["Coaching form for Sarah Test"] });
    const history = [{ id: `msg_${conversationSeq}_0_u`, role: "user", content: "Coaching form for Sarah Test" }];
    expect(await recall("What now?", { history })).toBeNull();
  });

  it("does not put one Sarah's history on another", async () => {
    conversation({ turns: ["Coaching form for Sarah Miller", "She was rude to a guest"] });
    expect(await recall("What about Sarah Test?")).toBeNull();
  });

  it("lists the forms this manager filed about the person, and nobody else's", async () => {
    db.tables.form_instances!.push(
      {
        employee_name: "Sarah Test",
        status: "finalized",
        form_date: "2026-10-03",
        created_by: ME,
        archived_at: null,
        created_at: "2026-10-03T15:00:00Z",
        form_templates: { name: "Coaching Form" },
      },
      {
        employee_name: "Sarah Test",
        status: "finalized",
        form_date: "2026-10-04",
        created_by: SOMEONE_ELSE,
        archived_at: null,
        created_at: "2026-10-04T15:00:00Z",
        form_templates: { name: "Corrective Action" },
      },
    );

    const block = await recall("What about Sarah Test?");

    expect(block).toContain("- Coaching Form for Sarah Test — dated 2026-10-03, finalized");
    expect(block).not.toContain("Corrective Action");
  });

  it("recalls a lone first name only where the earlier conversation named that person", async () => {
    conversation({ turns: ["Coaching form for Sarah", "She was late again"] });
    conversation({ turns: ["Sarah brand bronzer is selling out"] });

    const block = await recall("Sarah was late again today, what now?");

    expect(block).toContain("> Coaching form for Sarah");
    expect(block).not.toContain("bronzer");
  });

  it("asks nothing of the database when the question names nobody", async () => {
    expect(await recall("What is the refund policy?")).toBeNull();
    expect(db.queries).toBe(0);
  });

  it("degrades to no memory when the database fails, rather than failing the answer", async () => {
    conversation({ turns: ["Coaching form for Sarah Test"] });
    db.fail = true;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(recall("What about Sarah Test?")).resolves.toBeNull();

    // The reason is logged; the manager's words never are.
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).not.toContain("Sarah");
    warn.mockRestore();
  });
});

/*
 * ============================================================================
 * CROSS_CHAT_REPLY_GUARD_ENABLED — QA: OTHER CHATS IN THE REPLY TEXT
 * ============================================================================
 *
 * The manager's turns are production's (conv_mvmtj8ia2qwr8pu,
 * conv_mvmw29wp27tkony, conv_mvmvugx525mtd2v and the October 23 / August 26
 * chats they recalled), with the people's names swapped for invented ones.
 * The flag is read by `server-ask.ts`; here it arrives as `crossChatGuard`.
 */
describe("recallPeople with the cross-chat guard", () => {
  const SITUATION =
    "an employee (Wren)  is talking negatively about co workers and customers. another employee, marlo, complained to salon director about Wren";
  const OCT_23_TURNS = [
    SITUATION,
    "an employee (wren)  is talking negatively about co workers and customers. another employee, marlo, complained to salon director about wren",
    "create coaching form for wren, works at lawrence as a tanning consultant. use todays date",
    "wren calder, tanning consultant at lawrence. use todays date",
  ];
  const ROSTER = [{ id: "e1", firstName: "Wren", lastName: "Calder", salonIds: ["loc-0495"] }];
  const guarded = { crossChatGuard: true, todayIso: "2026-10-24", roster: async () => ROSTER };

  it('"asdasd" recalls nothing: a lone keystroke is not a person (flag off, it recalled the August 26 chat)', async () => {
    conversation({ createdAt: "2026-08-26T09:09:12Z", turns: ["asdasd"] });

    // Production today: the August 26 "asdasd" is quoted back as memory.
    expect(await recall("asdasd", { todayIso: "2026-10-24" })).toContain("2026-08-26");

    expect(await recall("asdasd", guarded)).toBeNull();
    expect(await recall("asdasd", { ...guarded, roster: async () => [] })).toBeNull();
    expect(await recall("asdasd", { crossChatGuard: true, todayIso: "2026-10-24" })).toBeNull();
  });

  it("a name typed as a whole turn is still recalled when the roster has that person", async () => {
    conversation({ createdAt: "2026-10-03T15:00:00Z", turns: ["Wren Calder was late again last week"] });
    const history = [
      { role: "user", content: "she was late again" },
      { role: "assistant", content: "Who is this about?" },
    ];
    const block = await recall("Wren Calder", { ...guarded, history });
    expect(block).toContain("> Wren Calder was late again last week");
  });

  it("does not quote the October 23 chat when the manager does not refer back to it", async () => {
    conversation({ createdAt: "2026-10-23T20:46:08Z", turns: OCT_23_TURNS });

    // Production today: the October 23 chat is quoted, and the reply said "You raised this same situation with me on October 23".
    expect(await recall(SITUATION, { todayIso: "2026-10-24" })).toContain("2026-10-23");

    expect(await recall(SITUATION, guarded)).toBeNull();
  });

  it("still lists a form on file, as a record, and labels the block", async () => {
    conversation({ createdAt: "2026-10-23T20:46:08Z", turns: OCT_23_TURNS });
    db.tables.form_instances!.push({
      employee_name: "Wren Calder",
      status: "draft",
      form_date: "2026-10-23",
      created_by: ME,
      archived_at: null,
      created_at: "2026-10-23T20:50:00Z",
      form_templates: { name: "Coaching Form" },
    });

    const block = await recall(SITUATION, guarded);

    expect(block).toContain("- Coaching Form for Wren Calder — dated 2026-10-23, draft, not finalized");
    expect(block).toContain("records from OTHER conversations");
    expect(block).toContain("Never say the manager raised, said, sent or asked any of it before");
    expect(block).not.toContain("Earlier conversation,");
    expect(block).not.toContain("> an employee");
  });

  it("quotes the earlier chat when the manager refers back to it", async () => {
    conversation({ createdAt: "2026-10-23T20:46:08Z", turns: OCT_23_TURNS });
    const block = await recall("Wren is talking negatively about co workers again, same as last time", guarded);
    expect(block).toContain("Earlier conversation, 2026-10-23");
    expect(block).toContain("records from OTHER conversations");
  });
});
