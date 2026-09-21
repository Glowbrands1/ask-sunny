/**
 * AN IN-MEMORY STAND-IN FOR THE CHAT HISTORY TABLES.
 *
 * It exists so the rules that decide WHOSE conversation a caller gets can be
 * tested against the real store code. Those rules live in `lib/chat/store.ts`
 * — every statement scoped by `user_id`, a refusal that reads the same for a
 * missing row and somebody else's — and a test that mocked the store away would
 * assert only that a mock returns what it was told to.
 *
 * WHAT IT MODELS FAITHFULLY, because the tests depend on it:
 *
 *   THE TWO UNIQUE CONSTRAINTS. `(user_id, client_conversation_id)` and
 *   `(conversation_id, client_message_id)` are what make a re-sent thread
 *   converge instead of accumulating, so a fake that let duplicates through
 *   would make an idempotency test vacuous. An insert that violates the first
 *   returns an error the way supabase-js does, which is the race path the store
 *   recovers from.
 *
 *   THE CASCADE. Deleting a conversation removes its messages, mirroring the
 *   declared `on delete cascade`. A fake cannot prove a foreign key — that is
 *   asserted separately against the migration SQL — but it makes the
 *   consequence observable.
 *
 *   FAILURE. `failOn` makes a table's next operation return an error, which is
 *   the only way to test that a database outage produces "could not save" and
 *   never "not yours".
 *
 * WHAT IT DOES NOT MODEL: row level security, triggers, enum validity, column
 * bounds, and every operator nobody calls. It is a test double, not a database.
 */

type Row = Record<string, unknown>;
type Predicate = (row: Row) => boolean;

export interface ChatStoreTables {
  chat_conversations: Row[];
  chat_messages: Row[];
  chat_history_boundaries: Row[];
  /**
   * Read-only here, and only for one question: was a turn recorded at or
   * before a Clear History boundary. `occurred_at` is server-set in the real
   * schema, which is what makes it the half of the clear check a wrong browser
   * clock cannot argue with.
   */
  activity_events: Row[];
}

export interface FakeChatSupabase {
  tables: ChatStoreTables;
  /** Make every operation on this table fail until cleared. */
  failOn(table: keyof ChatStoreTables | null): void;
  /** Every statement the store issued, for asserting what was scoped by whom. */
  statements: { table: string; op: string; filters: Row }[];
  client: { from(table: string): FakeChatQuery };
}

let idCounter = 0;

/** The unique constraints the migration declares, by table. */
const UNIQUE: Record<string, string[]> = {
  chat_conversations: ["user_id", "client_conversation_id"],
  chat_messages: ["conversation_id", "client_message_id"],
  chat_history_boundaries: ["user_id"],
};

/**
 * THE COMPOSITE FOREIGN KEY, MODELLED.
 *
 * `chat_messages (conversation_id, user_id)` references
 * `chat_conversations (id, user_id)`, so a message claiming a different owner
 * from its conversation is rejected by the database rather than merely by the
 * code. A fake cannot prove a foreign key — that is asserted separately against
 * the migration SQL — but without modelling it here the test that a cross-user
 * pairing is impossible would pass against a double that allows it.
 */
const COMPOSITE_FK: Record<string, { columns: string[]; table: string; target: string[] }> = {
  chat_messages: {
    columns: ["conversation_id", "user_id"],
    table: "chat_conversations",
    target: ["id", "user_id"],
  },
};

class FakeChatQuery implements PromiseLike<{ data: unknown; error: unknown }> {
  private op: "select" | "insert" | "update" | "delete" | "upsert" | null = null;
  private payload: Row = {};
  private upsertRows: Row[] = [];
  private conflictKeys: string[] = [];
  private filters: Predicate[] = [];
  private recorded: Row = {};
  private oneRow = false;
  private orderKey: string | null = null;
  private ascending = true;
  private max: number | null = null;

  constructor(
    private readonly parent: FakeChatSupabaseImpl,
    private readonly table: string,
  ) {}

  private rows(): Row[] {
    const rows = this.parent.tables[this.table as keyof ChatStoreTables];
    if (!rows) throw new Error(`fake-chat-supabase: no table "${this.table}"`);
    return rows;
  }

  select() {
    this.op ??= "select";
    return this;
  }
  insert(payload: Row) {
    this.op = "insert";
    this.payload = payload;
    return this;
  }
  update(payload: Row) {
    this.op = "update";
    this.payload = payload;
    return this;
  }
  delete() {
    this.op = "delete";
    return this;
  }
  upsert(payload: Row | Row[], options?: { onConflict?: string }) {
    this.op = "upsert";
    this.upsertRows = Array.isArray(payload) ? payload : [payload];
    this.conflictKeys = (options?.onConflict ?? "id").split(",").map((key) => key.trim());
    return this;
  }

  eq(column: string, value: unknown) {
    this.recorded[column] = value;
    this.filters.push((row) => row[column] === value);
    return this;
  }
  is(column: string, value: null) {
    this.recorded[column] = value;
    this.filters.push((row) => (row[column] ?? null) === value);
    return this;
  }
  in(column: string, values: unknown[]) {
    this.recorded[column] = values;
    this.filters.push((row) => values.includes(row[column]));
    return this;
  }
  lte(column: string, value: string) {
    this.recorded[column] = value;
    this.filters.push((row) => {
      const at = Date.parse(String(row[column] ?? ""));
      const bound = Date.parse(value);
      return Number.isFinite(at) && Number.isFinite(bound) && at <= bound;
    });
    return this;
  }
  order(column: string, options?: { ascending?: boolean }) {
    this.orderKey = column;
    this.ascending = options?.ascending !== false;
    return this;
  }
  limit(count: number) {
    this.max = count;
    return this;
  }
  maybeSingle() {
    this.oneRow = true;
    return this;
  }
  single() {
    this.oneRow = true;
    return this;
  }

  private violatesUnique(candidate: Row): boolean {
    const keys = UNIQUE[this.table];
    if (!keys) return false;
    return this.rows().some((row) => keys.every((key) => row[key] === candidate[key]));
  }

  /** True when no parent row matches every referenced column. */
  private violatesCompositeForeignKey(candidate: Row): boolean {
    const fk = COMPOSITE_FK[this.table];
    if (!fk) return false;
    const parents = this.parent.tables[fk.table as keyof ChatStoreTables];
    return !parents.some((row) =>
      fk.target.every((column, index) => row[column] === candidate[fk.columns[index]!]),
    );
  }

  private run(): { data: unknown; error: unknown } {
    this.parent.statements.push({
      table: this.table,
      op: this.op ?? "select",
      filters: { ...this.recorded },
    });

    if (this.parent.failing === this.table) {
      return { data: null, error: { message: "fake failure", code: "XX000" } };
    }

    const rows = this.rows();

    if (this.op === "insert") {
      if (this.violatesCompositeForeignKey(this.payload)) {
        return {
          data: null,
          error: {
            message:
              'insert or update violates foreign key constraint "chat_messages_owner_matches_conversation"',
            code: "23503",
          },
        };
      }
      if (this.violatesUnique(this.payload)) {
        return {
          data: null,
          error: { message: "duplicate key value", code: "23505" },
        };
      }
      const inserted: Row = { id: `row-${(idCounter += 1)}`, ...this.payload };
      rows.push(inserted);
      return { data: this.oneRow ? inserted : null, error: null };
    }

    if (this.op === "upsert") {
      for (const incoming of this.upsertRows) {
        if (this.violatesCompositeForeignKey(incoming)) {
          return {
            data: null,
            error: {
              message:
                'insert or update violates foreign key constraint "chat_messages_owner_matches_conversation"',
              code: "23503",
            },
          };
        }
        const existing = rows.find((row) =>
          this.conflictKeys.every((key) => row[key] === incoming[key]),
        );
        if (existing) Object.assign(existing, incoming);
        else rows.push({ id: `row-${(idCounter += 1)}`, ...incoming });
      }
      return { data: null, error: null };
    }

    const hits = rows.filter((row) => this.filters.every((test) => test(row)));

    if (this.op === "delete") {
      for (const row of hits) {
        rows.splice(rows.indexOf(row), 1);
        if (this.table === "chat_conversations") {
          this.parent.tables.chat_messages = this.parent.tables.chat_messages.filter(
            (message) => message.conversation_id !== row.id,
          );
        }
      }
      return { data: null, error: null };
    }

    if (this.op === "update") {
      for (const row of hits) {
        const wasLive = (row.deleted_at ?? null) === null;
        Object.assign(row, this.payload);
        /*
         * THE PURGE TRIGGER. Soft-deleting a conversation destroys its turns in
         * the database, so a tombstone is a tombstone rather than a filing
         * cabinet. Modelled here for the same reason as the composite key: a
         * double that kept the messages would let a test claiming the content
         * is gone pass while it was not.
         */
        if (
          this.table === "chat_conversations" &&
          wasLive &&
          (row.deleted_at ?? null) !== null
        ) {
          this.parent.tables.chat_messages = this.parent.tables.chat_messages.filter(
            (message) => message.conversation_id !== row.id,
          );
        }
      }
      return { data: null, error: null };
    }

    let data = [...hits];
    if (this.orderKey) {
      const key = this.orderKey;
      data.sort((a, b) => String(a[key] ?? "").localeCompare(String(b[key] ?? "")));
      if (!this.ascending) data.reverse();
    }
    if (this.max !== null) data = data.slice(0, this.max);

    return { data: this.oneRow ? (data[0] ?? null) : data, error: null };
  }

  then<TResult1 = { data: unknown; error: unknown }, TResult2 = never>(
    onfulfilled?:
      | ((value: { data: unknown; error: unknown }) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.run()).then(onfulfilled, onrejected);
  }
}

class FakeChatSupabaseImpl implements FakeChatSupabase {
  readonly tables: ChatStoreTables;
  readonly statements: { table: string; op: string; filters: Row }[] = [];
  failing: string | null = null;

  constructor(tables?: Partial<ChatStoreTables>) {
    this.tables = {
      chat_conversations: tables?.chat_conversations ?? [],
      chat_messages: tables?.chat_messages ?? [],
      chat_history_boundaries: tables?.chat_history_boundaries ?? [],
      activity_events: tables?.activity_events ?? [],
    };
  }

  failOn(table: keyof ChatStoreTables | null) {
    this.failing = table;
  }

  get client() {
    return { from: (table: string) => new FakeChatQuery(this, table) };
  }
}

export type { FakeChatQuery };

export function fakeChatSupabase(
  tables?: Partial<ChatStoreTables>,
): FakeChatSupabase {
  return new FakeChatSupabaseImpl(tables);
}
