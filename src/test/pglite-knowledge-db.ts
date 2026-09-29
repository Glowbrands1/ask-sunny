import { readFileSync } from "node:fs";

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { vector } from "@electric-sql/pglite-pgvector";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * ============================================================================
 * THE KNOWLEDGE SCHEMA ON A REAL POSTGRES, FOR INTEGRATION TESTS
 * ============================================================================
 *
 * PGlite (Postgres compiled to WASM, in process) with pgvector, running the
 * repository's OWN migrations for the knowledge tables, verbatim:
 *
 *   extensions → knowledge schema → match_knowledge_chunks → RLS → privilege
 *   hardening → 384-dimension embeddings (which redefines the RPC) → the Woven
 *   knowledge sync (the `retired` status, the replaced read policies and the
 *   sync's own tables) → the dry run's inventory.
 *
 * So `match_knowledge_chunks` — the WHERE clause that decides what chat and
 * the form policy search can see (`indexed`, `status = 'indexed'`, current
 * version, scope, category) — is the real SQL, not a reimplementation.
 *
 * WHAT IS STUBBED, and only because the Supabase platform provides it: the
 * `anon` / `authenticated` / `service_role` roles, an `auth.users` table for
 * one foreign key, and Storage (an in-memory bucket).
 *
 * THE CLIENT is the small subset of the supabase-js query builder the
 * ingestion pipeline, lifecycle and knowledge provider actually call, compiled
 * to parameterised SQL. It runs as the database owner, as the service-role
 * client does; `asAuthenticated` runs a query under the `authenticated` role
 * so the read policies can be exercised too.
 */

const MIGRATIONS = [
  "20260829000100_extensions",
  "20260829000200_knowledge_schema",
  "20260829000300_match_knowledge_chunks",
  "20260829000400_rls",
  "20260831000600_rls_privilege_hardening",
  "20260831000800_embedding_dimensions_384",
  "20260929001000_woven_knowledge_sync",
  "20260930001000_woven_knowledge_inventory",
] as const;

type Row = Record<string, unknown>;
type Result = { data: unknown; error: { message: string; code?: string } | null; count?: number | null };

export interface KnowledgeTestDatabase {
  db: PGlite;
  client: SupabaseClient;
  /** Objects written to the in-memory Storage bucket, by path. */
  storage: Map<string, Uint8Array>;
  /** Runs one query as the `authenticated` role, under the read policies. */
  asAuthenticated<T extends Row = Row>(sql: string, params?: unknown[]): Promise<T[]>;
  close(): Promise<void>;
}

export async function createKnowledgeTestDatabase(): Promise<KnowledgeTestDatabase> {
  const db = new PGlite({ extensions: { vector, pgcrypto } });
  await db.exec(`
    create schema extensions;
    create role anon; create role authenticated; create role service_role;
    create schema auth; create table auth.users (id uuid primary key);
  `);
  for (const name of MIGRATIONS) {
    const sql = readFileSync(new URL(`../../supabase/migrations/${name}.sql`, import.meta.url), "utf8");
    await db.exec(sql);
  }

  const columnTypes = new Map<string, Map<string, string>>();
  for (const row of (
    await db.query<{ table_name: string; column_name: string; udt_name: string }>(
      `select table_name, column_name, udt_name from information_schema.columns where table_schema = 'public'`,
    )
  ).rows) {
    if (!columnTypes.has(row.table_name)) columnTypes.set(row.table_name, new Map());
    columnTypes.get(row.table_name)!.set(row.column_name, row.udt_name);
  }

  const primaryKeys = new Map<string, string[]>();
  for (const row of (
    await db.query<{ table_name: string; column_name: string }>(
      `select tc.table_name, kcu.column_name from information_schema.table_constraints tc
         join information_schema.key_column_usage kcu on kcu.constraint_name = tc.constraint_name and kcu.table_schema = tc.table_schema
        where tc.table_schema = 'public' and tc.constraint_type = 'PRIMARY KEY' order by kcu.ordinal_position`,
    )
  ).rows) {
    primaryKeys.set(row.table_name, [...(primaryKeys.get(row.table_name) ?? []), row.column_name]);
  }

  const storage = new Map<string, Uint8Array>();
  const client = {
    from: (table: string) => new QueryBuilder(db, table, columnTypes.get(table) ?? new Map(), primaryKeys.get(table) ?? ["id"]),
    rpc: (fn: string, args: Record<string, unknown>) => rpc(db, fn, args),
    storage: { from: () => bucket(storage) },
  } as unknown as SupabaseClient;

  return {
    db,
    client,
    storage,
    async asAuthenticated<T extends Row = Row>(sql: string, params: unknown[] = []) {
      await db.exec("set role authenticated");
      try {
        return (await db.query<T>(sql, params)).rows;
      } finally {
        await db.exec("reset role");
      }
    },
    close: () => db.close(),
  };
}

/* ------------------------------------------------------------------ SQL -- */

const quote = (identifier: string) => {
  if (!/^[a-z_][a-z0-9_]*$/.test(identifier)) throw new Error(`unexpected identifier ${identifier}`);
  return `"${identifier}"`;
};

/** A value bound for one column: jsonb and vector need an explicit cast. */
function bind(params: unknown[], udt: string | undefined, value: unknown): string {
  if (udt === "jsonb") {
    params.push(value === null ? null : JSON.stringify(value));
    return `$${params.length}::jsonb`;
  }
  if (udt === "vector") {
    params.push(Array.isArray(value) ? `[${value.join(",")}]` : value);
    return `$${params.length}::extensions.vector`;
  }
  params.push(value);
  return `$${params.length}`;
}

type Filter = { column: string; op: "=" | "<>" | "<" | "in" | "ilike" | "is"; value: unknown };

class QueryBuilder implements PromiseLike<Result> {
  private verb: "select" | "insert" | "update" | "upsert" | "delete" = "select";
  private columns = "*";
  private returning: string | null = null;
  private countOnly = false;
  private payload: Row | Row[] | null = null;
  private readonly filters: Filter[] = [];
  private readonly orders: { column: string; ascending: boolean }[] = [];
  private limitTo: number | null = null;
  private offset = 0;
  private conflict: string[] | null = null;
  private mode: "many" | "single" | "maybeSingle" = "many";

  constructor(
    private readonly db: PGlite,
    private readonly table: string,
    private readonly types: Map<string, string>,
    private readonly primaryKey: string[],
  ) {}

  select(columns = "*", options: { count?: string; head?: boolean } = {}) {
    if (this.verb === "select") {
      this.columns = columns;
      this.countOnly = Boolean(options.head && options.count);
    } else this.returning = columns;
    return this;
  }
  insert(values: Row | Row[]) {
    this.verb = "insert";
    this.payload = values;
    return this;
  }
  upsert(values: Row | Row[], options: { onConflict?: string } = {}) {
    this.verb = "upsert";
    this.payload = values;
    this.conflict = options.onConflict ? options.onConflict.split(",").map((c) => c.trim()) : null;
    return this;
  }
  update(values: Row) {
    this.verb = "update";
    this.payload = values;
    return this;
  }
  delete() {
    this.verb = "delete";
    return this;
  }
  eq(column: string, value: unknown) {
    this.filters.push({ column, op: "=", value });
    return this;
  }
  neq(column: string, value: unknown) {
    this.filters.push({ column, op: "<>", value });
    return this;
  }
  lt(column: string, value: unknown) {
    this.filters.push({ column, op: "<", value });
    return this;
  }
  range(from: number, to: number) {
    this.offset = from;
    this.limitTo = to - from + 1;
    return this;
  }
  in(column: string, value: unknown[]) {
    this.filters.push({ column, op: "in", value });
    return this;
  }
  ilike(column: string, value: string) {
    this.filters.push({ column, op: "ilike", value });
    return this;
  }
  is(column: string, value: null) {
    this.filters.push({ column, op: "is", value });
    return this;
  }
  order(column: string, options: { ascending?: boolean } = {}) {
    this.orders.push({ column, ascending: options.ascending ?? true });
    return this;
  }
  limit(n: number) {
    this.limitTo = n;
    return this;
  }
  single() {
    this.mode = "single";
    return this;
  }
  maybeSingle() {
    this.mode = "maybeSingle";
    return this;
  }

  then<A = Result, B = never>(resolve?: ((value: Result) => A | PromiseLike<A>) | null, reject?: ((reason: unknown) => B | PromiseLike<B>) | null) {
    return this.execute().then(resolve, reject);
  }

  private where(params: unknown[]): string {
    if (this.filters.length === 0) return "";
    const clauses = this.filters.map((f) => {
      const column = quote(f.column);
      if (f.op === "is") return `${column} is null`;
      if (f.op === "in") {
        params.push(f.value);
        return `${column}::text = any($${params.length}::text[])`;
      }
      return `${column} ${f.op} ${bind(params, this.types.get(f.column), f.value)}`;
    });
    return ` where ${clauses.join(" and ")}`;
  }

  private selectList(columns: string): string {
    return columns.trim() === "*" ? "*" : columns.split(",").map((c) => quote(c.trim())).join(", ");
  }

  private async execute(): Promise<Result> {
    const params: unknown[] = [];
    const table = `public.${quote(this.table)}`;
    let sql: string;
    try {
      if (this.verb === "select") {
        sql = this.countOnly ? `select count(*)::int as n from ${table}` : `select ${this.selectList(this.columns)} from ${table}`;
        sql += this.where(params);
        if (!this.countOnly && this.orders.length) sql += ` order by ${this.orders.map((o) => `${quote(o.column)} ${o.ascending ? "asc" : "desc"}`).join(", ")}`;
        if (!this.countOnly && this.limitTo !== null) sql += ` limit ${Number(this.limitTo)}`;
        if (!this.countOnly && this.offset > 0) sql += ` offset ${Number(this.offset)}`;
      } else if (this.verb === "insert" || this.verb === "upsert") {
        const rows = Array.isArray(this.payload) ? this.payload : [this.payload ?? {}];
        const columns = [...new Set(rows.flatMap((r) => Object.keys(r)))];
        const values = rows.map((r) => `(${columns.map((c) => (c in r ? bind(params, this.types.get(c), r[c]) : "default")).join(", ")})`);
        sql = `insert into ${table} (${columns.map(quote).join(", ")}) values ${values.join(", ")}`;
        if (this.verb === "upsert") {
          const target = this.conflict ?? this.primaryKey;
          const updates = columns.filter((c) => !target.includes(c)).map((c) => `${quote(c)} = excluded.${quote(c)}`);
          sql += ` on conflict (${target.map(quote).join(", ")}) ${updates.length ? `do update set ${updates.join(", ")}` : "do nothing"}`;
        }
      } else if (this.verb === "update") {
        const sets = Object.entries(this.payload as Row).map(([c, v]) => `${quote(c)} = ${bind(params, this.types.get(c), v)}`);
        sql = `update ${table} set ${sets.join(", ")}${this.where(params)}`;
      } else {
        sql = `delete from ${table}${this.where(params)}`;
      }
      if (this.verb !== "select" && this.returning !== null) sql += ` returning ${this.selectList(this.returning)}`;

      const result = await this.db.query<Row>(sql, params);
      if (this.countOnly) return { data: null, error: null, count: Number(result.rows[0]?.n ?? 0) };
      const rows = result.rows.map(asPostgrest);
      if (this.verb !== "select" && this.returning === null) return { data: null, error: null };
      if (this.mode === "single") {
        return rows.length === 1 ? { data: rows[0], error: null } : { data: null, error: { message: `expected one row, got ${rows.length}` } };
      }
      if (this.mode === "maybeSingle") {
        return rows.length <= 1 ? { data: rows[0] ?? null, error: null } : { data: null, error: { message: `expected at most one row, got ${rows.length}` } };
      }
      return { data: rows, error: null };
    } catch (error) {
      return { data: null, error: { message: error instanceof Error ? error.message : String(error), code: (error as { code?: string }).code } };
    }
  }
}

/** Values as PostgREST's JSON returns them: timestamps as ISO strings, bigints as numbers. */
function asPostgrest(row: Row): Row {
  const out: Row = {};
  for (const [key, value] of Object.entries(row)) {
    out[key] = value instanceof Date ? value.toISOString() : typeof value === "bigint" ? Number(value) : value;
  }
  return out;
}

async function rpc(db: PGlite, fn: string, args: Record<string, unknown>): Promise<Result> {
  const params: unknown[] = [];
  const named = Object.entries(args).map(([name, value]) => {
    if (Array.isArray(value) && value.every((v) => typeof v === "number")) {
      params.push(`[${value.join(",")}]`);
      return `${quote(name)} => $${params.length}::extensions.vector`;
    }
    if (Array.isArray(value)) {
      params.push(value);
      return `${quote(name)} => $${params.length}::text[]`;
    }
    if (value === null) return `${quote(name)} => null`;
    params.push(value);
    return `${quote(name)} => $${params.length}`;
  });
  try {
    const result = await db.query<Row>(`select * from public.${quote(fn)}(${named.join(", ")})`, params);
    return { data: result.rows.map(asPostgrest), error: null };
  } catch (error) {
    return { data: null, error: { message: error instanceof Error ? error.message : String(error) } };
  }
}

/* -------------------------------------------------------------- Storage -- */

function bucket(objects: Map<string, Uint8Array>) {
  const bytesOf = async (body: unknown): Promise<Uint8Array> => {
    if (body instanceof Uint8Array) return body;
    if (body instanceof ArrayBuffer) return new Uint8Array(body);
    if (body instanceof Blob) return new Uint8Array(await body.arrayBuffer());
    return new TextEncoder().encode(String(body));
  };
  return {
    async upload(path: string, body: unknown) {
      objects.set(path, await bytesOf(body));
      return { data: { path }, error: null };
    },
    async download(path: string) {
      const bytes = objects.get(path);
      return bytes ? { data: new Blob([bytes as BlobPart]), error: null } : { data: null, error: { message: "Object not found" } };
    },
    async remove(paths: string[]) {
      for (const path of paths) objects.delete(path);
      return { data: paths.map((name) => ({ name })), error: null };
    },
    async list(prefix = "") {
      const names = [...objects.keys()].filter((key) => key.startsWith(prefix ? `${prefix}/` : "")).map((key) => key.slice(prefix ? prefix.length + 1 : 0).split("/")[0]!);
      return { data: [...new Set(names)].map((name) => ({ name })), error: null };
    },
  };
}

/* ------------------------------------------------------------ Embedding -- */

const STOPWORDS = new Set("the and for you are was will with this that from have has had not any all can our your their they them its into than then when what who how per may must should would could about".split(" "));

/**
 * A deterministic stand-in for the embedding model: a normalised bag of words
 * hashed into the column's width. Cosine similarity then tracks vocabulary
 * overlap, so a question in a document's own words matches it and an
 * unrelated one does not — enough to test WHICH rows retrieval may return,
 * which is the property under test, without a model.
 */
export function bagOfWordsEmbedding(text: string, dimensions: number): number[] {
  const out = new Array<number>(dimensions).fill(0);
  for (const raw of text.toLowerCase().match(/[a-z]{3,}/g) ?? []) {
    if (STOPWORDS.has(raw)) continue;
    const word = raw.replace(/(ies|es|s|ing|ed)$/, "");
    let hash = 2166136261;
    for (let i = 0; i < word.length; i += 1) hash = Math.imul(hash ^ word.charCodeAt(i), 16777619) >>> 0;
    out[hash % dimensions]! += 1;
  }
  const norm = Math.hypot(...out) || 1;
  return out.map((v) => v / norm);
}
