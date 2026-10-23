import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { redactTraceText } from "./chat-trace";

const SQL = readFileSync("supabase/migrations/20261023001100_chat_traces.sql", "utf8");

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

  it("redacts a key before the prompt is stored", () => {
    expect(redactTraceText("token sk-ant-abc123XYZ and the question")).toBe("token [redacted] and the question");
  });
});
