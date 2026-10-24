import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { redactTraceText, traceInsertWarning } from "./chat-trace";

const SQL = readFileSync("supabase/migrations/20261023001100_chat_traces.sql", "utf8");
const CACHE_SQL = readFileSync("supabase/migrations/20261024020000_chat_traces_cache.sql", "utf8");

describe("chat trace insert", () => {
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
    expect(statements).toMatch(/grant select on public\.chat_traces_live to service_role/i);
  });

  it("redacts a key before the prompt is stored", () => {
    expect(redactTraceText("token sk-ant-abc123XYZ and the question")).toBe("token [redacted] and the question");
  });
});
