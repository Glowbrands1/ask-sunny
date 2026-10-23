import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const TRGM = readFileSync("supabase/migrations/20261023001200_knowledge_section_trgm.sql", "utf8");
const SUMMARY = readFileSync("supabase/migrations/20261023001300_chat_context_summaries.sql", "utf8");

function statements(sql: string): string {
  return sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
}

describe("recall and long-context migrations", () => {
  it("adds trigram heading search without replacing the similarity function", () => {
    const sql = statements(TRGM);
    expect(sql).toMatch(/create extension if not exists pg_trgm/i);
    expect(sql).toContain("match_knowledge_sections_fuzzy");
    expect(sql).toMatch(/gin \(section extensions\.gin_trgm_ops\)/i);
    expect(sql).not.toMatch(/create or replace function public\.match_knowledge_chunks\b/i);
    expect(sql).not.toMatch(/drop (table|column|function|index)/i);
    expect(sql).not.toMatch(/alter column/i);
    expect(sql).not.toMatch(/vector\s*\(\s*\d+\s*\)/i);
    expect(sql).toMatch(/revoke execute on function public\.match_knowledge_sections_fuzzy/i);
  });

  it("adds a summary table and keeps it off the browser roles", () => {
    const sql = statements(SUMMARY);
    expect(sql).toMatch(/create table public\.chat_context_summaries/i);
    expect(sql).toMatch(/unique \(user_id, conversation_id\)/i);
    expect(sql).not.toMatch(/drop (table|column|function|index)/i);
    expect(sql).not.toMatch(/alter column/i);
    expect(sql).not.toMatch(/vector\s*\(\s*\d+\s*\)/i);
    expect(sql).toMatch(/revoke all on public\.chat_context_summaries from public, anon, authenticated/i);
    expect(sql).toMatch(/grant select, insert, update on public\.chat_context_summaries to service_role/i);
  });
});
