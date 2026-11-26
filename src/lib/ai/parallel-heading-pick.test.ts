import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { manualHeadingQuery, rewriteToManualTerms } from "./query-rewrite-claude";

/**
 * CHAT_PARALLEL_REWRITE_ENABLED, second half (owner, 25 Nov 2026: "1 and 3 only" — speed for Quick and Detailed without
 * changing what Sunny says). The search rewrite's heading pick starts as the turn arrives. These tests hold the two
 * promises the owner was given: the query is the same as before, and the early pick is used only for the turn it read.
 */
const HEADINGS = ["Attendance", "Standards of Conduct", "Dress Code"];
const base = { question: "what does the policy say about being late?", history: [], scopeId: "scope", loadHeadings: async () => HEADINGS };

describe("manualHeadingQuery gives rewriteToManualTerms' query, or null where the fallback stood", () => {
  const cases: [string, (headings: readonly string[]) => Promise<unknown>][] = [
    ["the model names a heading", async () => ({ heading: "Attendance" })],
    ["the model names none", async () => ({ heading: "" })],
    ["the model names a heading not in the manual", async () => ({ heading: "Lunch Breaks" })],
    ["the model call fails", async () => { throw new Error("down"); }],
  ];
  for (const [name, callModel] of cases) {
    it(name, async () => {
      const fallback = "FALLBACK QUERY";
      const before = await rewriteToManualTerms({ ...base, fallback, callModel });
      const pick = await manualHeadingQuery({ ...base, callModel });
      expect(pick ?? fallback).toBe(before);
    });
  }

  it("a question that names a heading: the same query either way", async () => {
    const callModel = async () => ({ heading: "" });
    const question = "what does the Dress Code say about sandals?";
    const before = await rewriteToManualTerms({ ...base, question, fallback: "F", callModel });
    const pick = await manualHeadingQuery({ ...base, question, callModel });
    expect(pick ?? "F").toBe(before);
  });
});

describe("server-ask.ts: the early pick is used only for the turn and scope it read", () => {
  const SOURCE = readFileSync("src/lib/ai/server-ask.ts", "utf8");

  it("starts once, behind the flag, before intent extraction, and never for a turn the rewrite skips", () => {
    expect(SOURCE.match(/const earlyHeading =/g)).toHaveLength(1);
    const early = SOURCE.indexOf("const earlyHeading =");
    expect(early).toBeLessThan(SOURCE.indexOf('markStage("intent_extraction");'));
    const start = SOURCE.slice(early, SOURCE.indexOf(": null;", early));
    expect(start).toMatch(/chatParallelRewriteEnabled\(\) && queryRewriteEnabled\(\)/);
    expect(start).toMatch(/slotOnlyRetrievalTopic\(request\.question, request\.history\) \?\? carriedPolicyTopic\(request\.question, request\.history\)/);
    expect(start).toMatch(/startedFor\(request, \(turn\) => manualHeadingQuery\(/);
  });

  it("at the rewrite: the same scope and turn take the early pick (with the same fallback); otherwise today's call", () => {
    const at = SOURCE.indexOf("const earlyPick =");
    const span = SOURCE.slice(at, SOURCE.indexOf(": followedUp;", at));
    expect(span).toMatch(/earlyHeading && earlyScope === request\.scopeId \? earlyHeading : null/);
    expect(span).toMatch(/\(\(await earlyPick\.take\(request\)\) \?\? glossed\)/);
    expect(span).toMatch(/await rewriteToManualTerms\(\{\s+question: request\.question,\s+history: request\.history,\s+fallback: glossed,\s+scopeId: request\.scopeId,/);
    expect(span).toMatch(/queryRewriteEnabled\(\) && !slotTopic/);
  });
});
