/**
 * A SMALL IN-MEMORY STAND-IN FOR THE SUPABASE CLIENT.
 *
 * It exists so the rules that decide whether a form may be DESTROYED can be
 * tested. Those rules — draft-only deletion, provenance-only bulk cleanup, a
 * count that must still match — live in `src/lib/forms/instances.ts`, and a
 * test that mocks the whole function away would only assert that mocks return
 * what they were told to.
 *
 * WHAT IT MODELS FAITHFULLY, because the tests depend on it:
 *
 *   `form_instance_overview` reads the SAME array as `form_instances`, so a
 *   deleted row disappears from the view exactly as it does in Postgres.
 *
 *   Deleting a `form_instances` row removes its values and events, mirroring
 *   the declared ON DELETE CASCADE. The declaration itself is asserted
 *   separately against the migration SQL — a fake cannot prove a foreign key,
 *   so it does not pretend to; it only makes the cascade's CONSEQUENCE
 *   observable here.
 *
 * WHAT IT DOES NOT MODEL: row level security, triggers, enum validity, and
 * every operator nobody calls. It is a test double, not a database.
 */

type Row = Record<string, unknown>;
type Predicate = (row: Row) => boolean;

export interface FakeStore {
  form_instances: Row[];
  form_instance_values: Row[];
  form_instance_events: Row[];
  form_template_versions: Row[];
  /*
   * The library tables. Optional because most tests here are about form
   * INSTANCES and would otherwise have to declare three empty arrays they never
   * touch; a table named in the known list below is created on first use, and
   * one that is not is still a loud failure.
   */
  form_templates?: Row[];
  form_template_current?: Row[];
  form_template_assets?: Row[];
}

/**
 * Tables the fake will create on demand.
 *
 * A closed list on purpose: a typo'd table name has to keep failing loudly, and
 * it would not if any name at all conjured an array.
 */
const KNOWN_TABLES: (keyof FakeStore)[] = [
  "form_instances",
  "form_instance_values",
  "form_instance_events",
  "form_template_versions",
  "form_templates",
  "form_template_current",
  "form_template_assets",
];

let fakeIds = 0;

/** The view is a read of the same array — see the note above. */
const VIEW_SOURCE: Record<string, keyof FakeStore> = {
  form_instance_overview: "form_instances",
};

/** The children that go when a form goes, as the foreign keys declare. */
const CASCADES: (keyof FakeStore)[] = ["form_instance_values", "form_instance_events"];

class FakeQuery implements PromiseLike<{ data: unknown; error: null }> {
  private op: "select" | "delete" | "update" | "insert" | "upsert" | null = null;
  private filters: Predicate[] = [];
  private payload: Row = {};
  private one = false;
  private selected = false;
  private conflictColumn: string | null = null;
  private orderKey: string | null = null;
  private ascending = true;
  private max: number | null = null;

  constructor(
    private store: FakeStore,
    private table: string,
  ) {}

  private rows(): Row[] {
    const key = VIEW_SOURCE[this.table] ?? (this.table as keyof FakeStore);
    if (!this.store[key] && KNOWN_TABLES.includes(key)) this.store[key] = [];
    const rows = this.store[key];
    if (!rows) throw new Error(`fake-supabase: no table "${this.table}"`);
    return rows;
  }

  /** The array behind `store[child]`, created on demand like `rows()` does. */
  private child(table: keyof FakeStore): Row[] {
    this.store[table] ??= [];
    return this.store[table];
  }

  private matched(): Row[] {
    return this.rows().filter((row) => this.filters.every((test) => test(row)));
  }

  /* `select` after `update` must not change the operation, so it only claims
   * the slot when nothing else has. */
  select() {
    this.op ??= "select";
    // Recorded separately from the operation: `insert(...).select().single()`
    // is how the real client asks for the row it just wrote back.
    this.selected = true;
    return this;
  }
  delete() {
    this.op = "delete";
    return this;
  }
  update(payload: Row) {
    this.op = "update";
    this.payload = payload;
    return this;
  }
  insert(payload: Row) {
    this.op = "insert";
    this.payload = payload;
    return this;
  }
  /**
   * Insert, or replace the row that collides on `onConflict`.
   *
   * Only the single-column form is modelled, because that is the only form the
   * app uses — `form_template_current` upserting on `template_id`, which is the
   * one-row-per-template rule the real schema enforces with a primary key.
   */
  upsert(payload: Row, options?: { onConflict?: string }) {
    this.op = "upsert";
    this.payload = payload;
    this.conflictColumn = options?.onConflict ?? null;
    return this;
  }

  eq(column: string, value: unknown) {
    this.filters.push((row) => row[column] === value);
    return this;
  }
  is(column: string, value: null) {
    this.filters.push((row) => (row[column] ?? null) === value);
    return this;
  }
  not(column: string, operator: "is", value: null) {
    if (operator !== "is") throw new Error(`fake-supabase: not(${operator}) unsupported`);
    this.filters.push((row) => (row[column] ?? null) !== value);
    return this;
  }
  like(column: string, pattern: string) {
    // Only the trailing-% form is used, and anything else should fail loudly
    // rather than match by accident — this operator bounds a delete.
    if (!pattern.endsWith("%") || pattern.slice(0, -1).includes("%")) {
      throw new Error(`fake-supabase: like(${pattern}) unsupported`);
    }
    const prefix = pattern.slice(0, -1);
    this.filters.push((row) => String(row[column] ?? "").startsWith(prefix));
    return this;
  }
  in(column: string, values: unknown[]) {
    this.filters.push((row) => values.includes(row[column]));
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
    this.one = true;
    return this;
  }
  single() {
    this.one = true;
    return this;
  }

  private run(): { data: unknown; error: null } {
    const rows = this.rows();

    if (this.op === "insert") {
      // `id` stands in for `default gen_random_uuid()`; the app reads it back
      // out of the insert and uses it as a foreign key straight afterwards.
      fakeIds += 1;
      const inserted = {
        id: `fake-${fakeIds}`,
        created_at: new Date().toISOString(),
        ...this.payload,
      };
      rows.push(inserted);
      if (!this.selected) return { data: null, error: null };
      return { data: this.one ? inserted : [inserted], error: null };
    }

    if (this.op === "upsert") {
      const column = this.conflictColumn;
      const existing = column
        ? rows.find((row) => row[column] === this.payload[column])
        : undefined;
      if (existing) {
        Object.assign(existing, this.payload);
        if (!this.selected) return { data: null, error: null };
        return { data: this.one ? existing : [existing], error: null };
      }
      fakeIds += 1;
      const inserted = { id: `fake-${fakeIds}`, ...this.payload };
      rows.push(inserted);
      if (!this.selected) return { data: null, error: null };
      return { data: this.one ? inserted : [inserted], error: null };
    }

    const hits = this.matched();

    if (this.op === "delete") {
      const cascades = (VIEW_SOURCE[this.table] ?? this.table) === "form_instances";
      for (const row of hits) {
        rows.splice(rows.indexOf(row), 1);
        if (!cascades) continue;
        for (const table of CASCADES) {
          this.store[table] = this.child(table).filter((entry) => entry.instance_id !== row.id);
        }
      }
      return { data: null, error: null };
    }

    if (this.op === "update") {
      for (const row of hits) Object.assign(row, this.payload);
    }

    let data = [...hits];
    if (this.orderKey) {
      const key = this.orderKey;
      data.sort((a, b) => String(a[key]).localeCompare(String(b[key])));
      if (!this.ascending) data.reverse();
    }
    if (this.max !== null) data = data.slice(0, this.max);

    return { data: this.one ? (data[0] ?? null) : data, error: null };
  }

  then<TResult1 = { data: unknown; error: null }, TResult2 = never>(
    onfulfilled?: ((value: { data: unknown; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.run()).then(onfulfilled, onrejected);
  }
}

export function fakeSupabase(store: FakeStore) {
  return { from: (table: string) => new FakeQuery(store, table) };
}
