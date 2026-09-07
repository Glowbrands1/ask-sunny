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

/** Stands in for the schema's `gen_random_uuid()` default. */
let insertCounter = 0;
type Predicate = (row: Row) => boolean;

export interface FakeStore {
  form_instances: Row[];
  form_instance_values: Row[];
  form_instance_events: Row[];
  form_template_versions: Row[];
  /**
   * Present so the VERSION-PINNING contract can be tested end to end.
   *
   * `createInstance` resolves the current published version through
   * `form_template_current`, and the whole point of that indirection is that
   * moving the pointer changes what a NEW form pins while leaving existing ones
   * alone. A fixture without these two tables can only test the halves.
   */
  form_templates?: Row[];
  form_template_current?: Row[];
  /**
   * Present so SEEDING and DOCUMENT INGESTION can be tested end to end.
   *
   * `ensureTemplateLibrary` records a bundled asset row per template it
   * installs, and an uploaded PDF or Word document becomes a row here before
   * anything is read out of it. Without the table the library cannot install at
   * all in a fixture, so the tests that check a re-issued form is published
   * once — and never twice — would have nothing to run against.
   */
  form_template_assets?: Row[];
}

/** The view is a read of the same array — see the note above. */
const VIEW_SOURCE: Record<string, keyof FakeStore> = {
  form_instance_overview: "form_instances",
};

/** The children that go when a form goes, as the foreign keys declare. */
const CASCADES = ["form_instance_values", "form_instance_events"] as const;

class FakeQuery implements PromiseLike<{ data: unknown; error: null }> {
  private op: "select" | "delete" | "update" | "insert" | "upsert" | null = null;
  private upsertRows: Row[] = [];
  private conflictKeys: string[] = [];
  private filters: Predicate[] = [];
  private payload: Row = {};
  private oneRow = false;
  private orderKey: string | null = null;
  private ascending = true;
  private max: number | null = null;

  constructor(
    private store: FakeStore,
    private table: string,
  ) {}

  private rows(): Row[] {
    const key = VIEW_SOURCE[this.table] ?? (this.table as keyof FakeStore);
    const rows = this.store[key];
    if (!rows) throw new Error(`fake-supabase: no table "${this.table}"`);
    return rows;
  }

  private matched(): Row[] {
    return this.rows().filter((row) => this.filters.every((test) => test(row)));
  }

  /* `select` after `update` must not change the operation, so it only claims
   * the slot when nothing else has. */
  select() {
    this.op ??= "select";
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
   * `upsert` with the array form, which is how `writeValues` stores field
   * values: one row per field, keyed on (instance_id, field_key).
   *
   * Modelled rather than aliased to `insert` because the conflict target is
   * what makes saving idempotent — a fake that appended duplicates would let a
   * double-save look fine here and corrupt a form in Postgres.
   */
  upsert(payload: Row | Row[], options?: { onConflict?: string }) {
    this.op = "upsert";
    this.upsertRows = Array.isArray(payload) ? payload : [payload];
    this.conflictKeys = (options?.onConflict ?? "id").split(",").map((key) => key.trim());
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
    this.oneRow = true;
    return this;
  }
  /**
   * Like `maybeSingle`, and used after an insert to read the row back.
   *
   * `createInstance` does `.insert(…).select("id").single()`, which is how it
   * learns the generated id — so an insert has to RETURN something for the
   * version-pinning tests to be able to load what they just created.
   */
  single() {
    this.oneRow = true;
    return this;
  }

  private run(): { data: unknown; error: null } {
    const rows = this.rows();

    if (this.op === "upsert") {
      for (const incoming of this.upsertRows) {
        const existing = rows.find((row) =>
          this.conflictKeys.every((key) => row[key] === incoming[key]),
        );
        if (existing) Object.assign(existing, incoming);
        else rows.push({ id: `fake-${(insertCounter += 1)}`, ...incoming });
      }
      return { data: null, error: null };
    }

    if (this.op === "insert") {
      /*
       * `id` is a database default in the real schema, so a payload without one
       * is normal and the fake has to supply it — otherwise the row it returns
       * cannot be loaded back by id.
       */
      const inserted: Row = {
        id: `fake-${(insertCounter += 1)}`,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        ...this.payload,
      };
      rows.push(inserted);
      return { data: this.oneRow ? inserted : null, error: null };
    }

    const hits = this.matched();

    if (this.op === "delete") {
      const cascades = (VIEW_SOURCE[this.table] ?? this.table) === "form_instances";
      for (const row of hits) {
        rows.splice(rows.indexOf(row), 1);
        if (!cascades) continue;
        for (const child of CASCADES) {
          this.store[child] = this.store[child].filter((entry) => entry.instance_id !== row.id);
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

    return { data: this.oneRow ? (data[0] ?? null) : data, error: null };
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
