import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * CHAT_PARALLEL_LOADS_ENABLED (QA's conditions, 9 Nov 2026): a load started early is always awaited on the same turn, so
 * a turn never pays for a read it would not have made, and the two loads that write never write on a turn that would
 * not have written. Read from the source: between where the loads start and where each is awaited, nothing returns.
 */
const SOURCE = readFileSync("src/lib/ai/server-ask.ts", "utf8");

function between(from: string, to: string): string {
  const start = SOURCE.indexOf(from);
  const end = SOURCE.indexOf(to, start);
  expect(start, `"${from}" is in server-ask.ts`).toBeGreaterThan(-1);
  expect(end, `"${to}" follows it`).toBeGreaterThan(start);
  return SOURCE.slice(start, end);
}

describe("CHAT_PARALLEL_LOADS: what starts early is awaited on the same turn", () => {
  it("the reads start once, after the turn's last early return, and nothing returns before their last await", () => {
    expect(SOURCE.match(/turnReads\(\{/g)).toHaveLength(1);
    const span = between("const reads = chatParallelLoadsEnabled()", "reads?.cited ?? citedManualGrounding");
    expect(span).not.toMatch(/\breturn\b/);
    // The form paths (proposal, understood turn) and the framework refusals return before the reads start.
    const reads = SOURCE.indexOf("const reads = chatParallelLoadsEnabled()");
    expect(SOURCE.indexOf("const understood = askedQuestion ? null : await understandFormTurn({")).toBeLessThan(reads);
    expect(SOURCE.indexOf("content: PERFORMANCE_MANAGEMENT_FRAMEWORK_UNAVAILABLE_MESSAGE")).toBeLessThan(reads);
    expect(SOURCE.indexOf("content: FRAMEWORK_UNAVAILABLE_MESSAGE")).toBeLessThan(reads);
  });

  it("the two loads that write start once, after the memory read, and nothing returns or throws-out before their awaits", () => {
    expect(SOURCE.match(/turnWrites\(\{/g)).toHaveLength(1);
    expect(SOURCE.indexOf("const personMemory = await memoryPromise;")).toBeLessThan(SOURCE.indexOf("const writes = reads ? turnWrites("));
    const span = between("const writes = reads ? turnWrites(", "writes?.longContext ??");
    expect(span).not.toMatch(/\breturn\b/);
    // Only the system prompt's build lies between: the recalled memory is awaited just before it (the stage marks,
    // QA-approved 10 Nov 2026: changed on purpose from an await inside the build's argument object).
    expect(span).toMatch(/const recalledMemory = await \(writes\?\.recalled \?\? recalledMemoryBlock\(request, actor\)\)/);
  });

  it("each early load's await falls back to the same call: never both", () => {
    for (const [started, call] of [
      ["reads?.reviews", "loadGoogleReviewsChatBlock("],
      ["reads?.fewShot", "fewShotBlock("],
      ["reads?.data", "loadChatDataBlock("],
      ["reads?.cited", "citedManualGrounding("],
      ["writes?.recalled", "recalledMemoryBlock("],
      ["writes?.longContext", "prepareLongContext("],
    ] as const) {
      expect(SOURCE, `${started} ?? ${call}`).toContain(`${started} ??`);
      expect(SOURCE.slice(SOURCE.indexOf(`${started} ??`), SOURCE.indexOf(`${started} ??`) + 200)).toContain(call);
    }
  });

  it("server-ask.ts adds no .catch( of its own (held() lives in held-promise.ts)", () => {
    expect(SOURCE.match(/\.catch\(/g)?.length ?? 0).toBe(2);
  });
});
