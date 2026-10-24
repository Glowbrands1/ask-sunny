import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { createMigratedTestDatabase } from "@/test/pglite-knowledge-db";

import { redactTraceText, traceInsertWarning } from "./chat-trace";

const SQL = readFileSync("supabase/migrations/20261023001100_chat_traces.sql", "utf8");
const SLOTS_SQL = readFileSync("supabase/migrations/20261024012000_chat_traces_slots.sql", "utf8");
const CACHE_SQL = readFileSync("supabase/migrations/20261024020000_chat_traces_cache.sql", "utf8");
const E2E_SQL = readFileSync("supabase/migrations/20261024160000_chat_traces_e2e_latency.sql", "utf8");
const RAW_SQL = readFileSync("supabase/migrations/20261024200000_chat_traces_raw_answer.sql", "utf8");

describe("chat trace insert", () => {
  it("warns when the raw answer column is missing", () => {
    const warning = traceInsertWarning({
      message: 'column "raw_answer" of relation "chat_traces" does not exist',
      code: "42703",
    });
    expect(warning).toContain("raw answer column is missing");
    expect(warning).toContain("20261024200000_chat_traces_raw_answer.sql");
  });

  it("warns when the end-to-end latency column is missing", () => {
    const warning = traceInsertWarning({
      message: 'column "e2e_latency_ms" of relation "chat_traces" does not exist',
      code: "42703",
    });
    expect(warning).toContain("end-to-end latency column is missing");
    expect(warning).toContain("20261024160000_chat_traces_e2e_latency.sql");
  });

  it("warns when the cache columns are missing", () => {
    const warning = traceInsertWarning({
      message: 'column "cache_creation_input_tokens" of relation "chat_traces" does not exist',
      code: "42703",
    });
    expect(warning).toContain("cache columns are missing");
    expect(warning).toContain("20261024020000_chat_traces_cache.sql");
    expect(warning).not.toContain("sk-ant-");
  });
});

describe("chat_traces migration", () => {
  it("only adds a table and a view", () => {
    const statements = SQL.split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n");
    expect(statements).toMatch(/create table public\.chat_traces/i);
    expect(statements).toMatch(/create view public\.chat_traces_live/i);
    expect(statements).toContain("error_subtype");
    expect(statements).toContain("stop_reason");
    expect(statements).toContain("thinking_tokens");
    expect(statements).toContain("form_in_progress");
    expect(statements).toContain("retried");
    expect(statements).toContain("retrieval_count");
    expect(statements).not.toMatch(/drop (table|column|function|index)/i);
    expect(statements).not.toMatch(/alter column/i);
    expect(statements).not.toMatch(/vector\s*\(\s*\d+\s*\)/i);
    expect(statements).toMatch(/revoke all on public\.chat_traces from public, anon, authenticated/i);
    expect(statements).toMatch(/grant select, insert on public\.chat_traces to service_role/i);
  });

  it("adds nullable cache columns and no destructive change", () => {
    const statements = CACHE_SQL.split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n");
    expect(statements).toMatch(/add column if not exists cache_creation_input_tokens integer/i);
    expect(statements).toMatch(/add column if not exists cache_read_input_tokens integer/i);
    expect(statements).toMatch(/add column if not exists first_token_ms integer/i);
    expect(statements).toMatch(/cache_read_input_tokens/);
    expect(statements).toMatch(/first_token_ms/);
    expect(statements).not.toMatch(/not null/i);
    expect(statements).not.toMatch(/drop (table|column|function|index)/i);
    expect(statements).toMatch(/create or replace view public\.chat_traces_live/i);
    expect(statements).toMatch(/with \(security_invoker = true\)/i);
    expect(SLOTS_SQL).toMatch(/create or replace view public\.chat_traces_live\s+with \(security_invoker = true\)/i);
    expect(statements).toMatch(
      /revoke all on public\.chat_traces_live from service_role;\s*grant select on public\.chat_traces_live to service_role/i,
    );
    expect(SLOTS_SQL).toMatch(
      /revoke all on public\.chat_traces_live from service_role;\s*grant select on public\.chat_traces_live to service_role/i,
    );
    const view = statements.slice(statements.toLowerCase().indexOf("create or replace view"));
    const latency = view.indexOf("latency_ms");
    const errorSubtype = view.indexOf("error_subtype");
    const slots = view.indexOf("slots");
    const created = view.indexOf("cache_creation_input_tokens");
    const read = view.indexOf("cache_read_input_tokens");
    const firstToken = view.indexOf("first_token_ms");
    expect(latency).toBeGreaterThan(-1);
    expect(errorSubtype).toBeGreaterThan(latency);
    expect(slots).toBeGreaterThan(errorSubtype);
    expect(created).toBeGreaterThan(slots);
    expect(read).toBeGreaterThan(created);
    expect(firstToken).toBeGreaterThan(read);
  });

  it("appends e2e_latency_ms after the cache columns", () => {
    const statements = E2E_SQL.split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n");
    expect(statements).toMatch(/add column if not exists e2e_latency_ms integer/i);
    expect(statements).not.toMatch(/not null/i);
    expect(statements).not.toMatch(/drop (table|column|function|index)/i);
    expect(statements).toMatch(/with \(security_invoker = true\)/i);
    const view = statements.slice(statements.toLowerCase().indexOf("create or replace view"));
    const firstToken = view.indexOf("first_token_ms");
    const e2e = view.indexOf("e2e_latency_ms");
    const errorSubtype = view.indexOf("error_subtype");
    expect(e2e).toBeGreaterThan(firstToken);
    expect(firstToken).toBeGreaterThan(errorSubtype);
  });

  it("rejects a view that inserts the cache columns before error_subtype", async () => {
    const harness = await createMigratedTestDatabase(
      ["20261023001100_chat_traces", "20261024012000_chat_traces_slots"],
      { platform: "create extension if not exists pgcrypto with schema extensions;" },
    );
    try {
      await harness.db.exec(`
        alter table public.chat_traces add column cache_creation_input_tokens integer;
        alter table public.chat_traces add column cache_read_input_tokens integer;
        alter table public.chat_traces add column first_token_ms integer;
      `);
      const insertedInTheMiddle = `
        create or replace view public.chat_traces_live as
        select
          created_at, conversation_id, user_id, original_query, rewritten_query,
          intent, retrieval_count, model, max_tokens, stop_reason, thinking_tokens,
          latency_ms, cache_creation_input_tokens, cache_read_input_tokens, first_token_ms,
          error_subtype, error_class, error_status, form_in_progress,
          retryable, retried, succeeded, slots
        from public.chat_traces
      `;
      await expect(harness.db.exec(insertedInTheMiddle)).rejects.toThrow(/cannot change name of view column/);
    } finally {
      await harness.close();
    }
  });

  it("applies the three chat_traces migrations on Postgres and can run the cache one again", async () => {
    const harness = await createMigratedTestDatabase(
      [
        "20261023001100_chat_traces",
        "20261024012000_chat_traces_slots",
        "20261024020000_chat_traces_cache",
      ],
      { platform: "create extension if not exists pgcrypto with schema extensions;" },
    );
    try {
      const columns = await harness.db.query<{ column_name: string; ordinal_position: number }>(
        `select column_name, ordinal_position
           from information_schema.columns
          where table_schema = 'public' and table_name = 'chat_traces_live'
          order by ordinal_position`,
      );
      const names = columns.rows.map((row) => row.column_name);
      console.log(`chat_traces_live columns: ${names.join(", ")}`);
      expect(names.indexOf("slots")).toBeGreaterThan(names.indexOf("latency_ms"));
      expect(names.indexOf("cache_creation_input_tokens")).toBe(names.indexOf("slots") + 1);
      expect(names.indexOf("cache_read_input_tokens")).toBe(names.indexOf("slots") + 2);
      expect(names.indexOf("first_token_ms")).toBe(names.indexOf("slots") + 3);
      expect(names.indexOf("error_subtype")).toBe(names.indexOf("latency_ms") + 1);

      const describeView = async (label: string) => {
        const grants = await harness.db.query<{ grantee: string; privilege_type: string }>(
          `select grantee, privilege_type
             from information_schema.role_table_grants
            where table_schema = 'public' and table_name = 'chat_traces_live'
            order by grantee, privilege_type`,
        );
        const options = await harness.db.query<{ reloptions: string[] | null }>(
          `select c.reloptions
             from pg_class c
             join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relname = 'chat_traces_live'`,
        );
        const reloptions = options.rows[0]?.reloptions ?? null;
        const grantText = grants.rows.map((row) => `${row.grantee}=${row.privilege_type}`).join(", ") || "(none)";
        console.log(`${label} reloptions: ${reloptions ? reloptions.join(", ") : "(none)"}`);
        console.log(`${label} grants: ${grantText}`);
        expect(reloptions?.some((option) => option === "security_invoker=true")).toBe(true);
        const servicePrivileges = grants.rows
          .filter((row) => row.grantee === "service_role")
          .map((row) => row.privilege_type);
        expect(servicePrivileges).toEqual(["SELECT"]);
        expect(grants.rows.some((row) => row.grantee === "anon" || row.grantee === "authenticated")).toBe(false);
      };

      await describeView("after 001100 -> slots -> cache");

      await harness.db.exec("grant all on public.chat_traces_live to service_role");
      const again = readFileSync("supabase/migrations/20261024020000_chat_traces_cache.sql", "utf8");
      await harness.db.exec(again);
      const repeated = await harness.db.query<{ column_name: string }>(
        `select column_name
           from information_schema.columns
          where table_schema = 'public' and table_name = 'chat_traces_live'
          order by ordinal_position`,
      );
      expect(repeated.rows.map((row) => row.column_name)).toEqual(names);
      await describeView("after cache again");
    } finally {
      await harness.close();
    }
  });

  it("appplies e2e_latency_ms after the cache columns on Postgres", async () => {
    const harness = await createMigratedTestDatabase(
      [
        "20261023001100_chat_traces",
        "20261024012000_chat_traces_slots",
        "20261024020000_chat_traces_cache",
        "20261024160000_chat_traces_e2e_latency",
      ],
      { platform: "create extension if not exists pgcrypto with schema extensions;" },
    );
    try {
      const columns = await harness.db.query<{ column_name: string }>(
        `select column_name
           from information_schema.columns
          where table_schema = 'public' and table_name = 'chat_traces_live'
          order by ordinal_position`,
      );
      const names = columns.rows.map((row) => row.column_name);
      expect(names.at(-1)).toBe("e2e_latency_ms");
      expect(names.at(-2)).toBe("first_token_ms");
      expect(names.indexOf("error_subtype")).toBe(names.indexOf("latency_ms") + 1);
    } finally {
      await harness.close();
    }
  });

  it("appends a nullable raw_answer and leaves chat_traces_live as it was", async () => {
    const statements = RAW_SQL.split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n");
    expect(statements).toMatch(/add column if not exists raw_answer text/i);
    expect(statements).not.toMatch(/not null/i);
    expect(statements).not.toMatch(/drop (table|column|function|index|view)/i);
    expect(statements).not.toMatch(/create (or replace )?view/i);

    const harness = await createMigratedTestDatabase(
      [
        "20261023001100_chat_traces",
        "20261024012000_chat_traces_slots",
        "20261024020000_chat_traces_cache",
        "20261024160000_chat_traces_e2e_latency",
      ],
      { platform: "create extension if not exists pgcrypto with schema extensions;" },
    );
    try {
      const viewColumns = async () =>
        (
          await harness.db.query<{ column_name: string }>(
            `select column_name from information_schema.columns
              where table_schema = 'public' and table_name = 'chat_traces_live'
              order by ordinal_position`,
          )
        ).rows.map((row) => row.column_name);
      const before = await viewColumns();
      // Run twice: the file is safe to apply again.
      await harness.db.exec(RAW_SQL);
      await harness.db.exec(RAW_SQL);
      const table = await harness.db.query<{ column_name: string; is_nullable: string; data_type: string }>(
        `select column_name, is_nullable, data_type from information_schema.columns
          where table_schema = 'public' and table_name = 'chat_traces'
          order by ordinal_position`,
      );
      const last = table.rows.at(-1);
      expect(last).toEqual({ column_name: "raw_answer", is_nullable: "YES", data_type: "text" });
      expect(table.rows.at(-2)?.column_name).toBe("e2e_latency_ms");
      expect(await viewColumns()).toEqual(before);
      // A writer from before the flag still inserts without naming the column.
      await harness.db.exec("insert into public.chat_traces (original_query) values ('what is the dress code')");
      const row = await harness.db.query<{ raw_answer: string | null }>("select raw_answer from public.chat_traces");
      expect(row.rows).toEqual([{ raw_answer: null }]);
    } finally {
      await harness.close();
    }
    // Starting PGlite with its extensions takes several seconds on its own.
  }, 30_000);

  it("redacts a key before the prompt is stored", () => {
    expect(redactTraceText("token sk-ant-abc123XYZ and the question")).toBe("token [redacted] and the question");
  });
});
