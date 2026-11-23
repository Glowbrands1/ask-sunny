import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

import { searchedWords } from "./run";

/*
 * Board f111 (QA, 23 Nov 2026): the words the loop searched with go on the chat trace (`slots.agent_loop_queries`), for
 * later checks. They live in the database only: the repository is public, so no fixture or other committed file may hold
 * them.
 */
describe("the searched words (f111)", () => {
  it("each search tool's own inputs, joined", () => {
    expect(searchedWords("find_staff", { name: "Remy Calder", person_evidence: { quote: "x" } })).toBe("name: Remy Calder");
    expect(searchedWords("find_past_forms", { employee_name: "Remy Calder", form: "CA", forms_on_file_evidence: {} })).toBe("employee_name: Remy Calder; form: CA");
    expect(searchedWords("read_policy", { heading: "Attendance" })).toBe("heading: Attendance");
    expect(searchedWords("search_knowledge", { query: "lateness policy" })).toBe("query: lateness policy");
  });

  it("a tool that searches nothing, or a search with no words, records nothing", () => {
    expect(searchedWords("propose_form", { employee_name: "Remy Calder", what_happened: "late" })).toBeNull();
    expect(searchedWords("find_staff", {})).toBeNull();
  });
});

describe("guard: no committed file is generated from agent_loop_queries (f111; the repository is public)", () => {
  /* The only files that may name the slot: the code that writes it, the cases and tests that read it, the parity entry. */
  const ALLOWED = new Set([
    "src/lib/ai/agent-loop/run.ts",
    "src/lib/ai/agent-loop/trace-queries.test.ts",
    "src/app/api/chat/replay-pack/nov14-agent-loop-cases.ts",
    "docs/parity-log/2026-11-23-f111-loop-search-queries.md",
  ]);
  const root = join(__dirname, "../../../..");
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((entry) => {
      if (entry === "node_modules" || entry === ".git" || entry === ".next") return [];
      const path = join(dir, entry);
      return statSync(path).isDirectory() ? walk(path) : [path];
    });

  it("only the code that writes the slot and the tests that read it name it", () => {
    const named = ["src", "docs", "supabase", "scripts"].flatMap((top) => {
      try {
        return walk(join(root, top));
      } catch {
        return [];
      }
    }).filter((path) => readFileSync(path, "utf8").includes("agent_loop_queries")).map((path) => relative(root, path));
    expect(named.filter((path) => !ALLOWED.has(path)), "a committed file holds agent_loop_queries (a fixture or a dump of searched words)").toEqual([]);
  });
});
