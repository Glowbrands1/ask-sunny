import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

/*
 * The monthly budget reads chat_traces. The reader-aware read (slots.reader) is
 * new; if it errors, the old read (answering calls only) must stand in: never
 * zero, never the guard switched off by the new part.
 */
type Query = { select: string; or: string | null; not: boolean };
const queries: Query[] = [];
let failReaderRead = false;
let failEverything = false;
let withSpend = false;

function builder() {
  const query: Query = { select: "", or: null, not: false };
  queries.push(query);
  const chain: Record<string, unknown> = {};
  chain.select = (columns: string) => ((query.select = columns), chain);
  chain.gte = () => chain;
  chain.or = (filter: string) => ((query.or = filter), chain);
  chain.not = () => ((query.not = true), chain);
  chain.order = () => chain;
  chain.range = async () => {
    if (failEverything) return { data: null, error: { message: "down" } };
    if (query.or && failReaderRead) return { data: null, error: { message: "column slots->reader does not exist" } };
    const rows = [
      { model: "claude-sonnet-5", input_tokens: 100, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, reader: { model: "claude-haiku-5-5", usage: { inputTokens: 3500, outputTokens: 400 } } },
      { model: null, input_tokens: null, output_tokens: null, cache_read_input_tokens: null, cache_creation_input_tokens: null, reader: { usage: { inputTokens: 1000, outputTokens: 100 } } },
    ];
    if (withSpend) {
      return {
        data: [
          // A metered turn: its spend lists the answer and two helpers; the model columns are not added again.
          { ...rows[0], spend: [
            { model: "claude-sonnet-5", inputTokens: 100, outputTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0 },
            { model: "claude-haiku-4-5", inputTokens: 400, outputTokens: 40, cacheReadTokens: 0, cacheWriteTokens: 0 },
            { model: "claude-haiku-4-5", inputTokens: 400, outputTokens: 40, cacheReadTokens: 0, cacheWriteTokens: 0 },
          ] },
          // A spend row (the Create card's draft): no model, only spend.
          { model: null, input_tokens: null, output_tokens: null, cache_read_input_tokens: null, cache_creation_input_tokens: null, reader: null, spend: [
            { model: "claude-opus-5", inputTokens: 2000, outputTokens: 300, cacheReadTokens: 0, cacheWriteTokens: 0 },
          ] },
          // A row from before the flag: counted as before.
          { ...rows[1], spend: null },
        ],
        error: null,
      };
    }
    return { data: query.or ? rows : rows.filter((row) => row.model !== null).map((row) => ({ ...row, reader: undefined })), error: null };
  };
  return chain;
}
vi.mock("@/lib/supabase/server", () => ({ getSupabaseAdmin: () => ({ from: () => builder() }) }));

const { modelUsageSince } = await import("./spend-guard-store");

afterEach(() => {
  queries.length = 0;
  failReaderRead = false;
  failEverything = false;
  withSpend = false;
  delete process.env.SPEND_GUARD_ALL_CALLS_ENABLED;
  vi.restoreAllMocks();
});

describe("modelUsageSince", () => {
  it("reads the model columns and slots.reader, and counts a reader call with no answering call", async () => {
    const usage = await modelUsageSince("2026-10-01T00:00:00Z");
    expect(queries[0]).toMatchObject({ select: expect.stringContaining("reader:slots->reader"), or: "model.not.is.null,slots->reader.not.is.null" });
    expect(usage.map((row) => row.model)).toEqual(["claude-sonnet-5", "claude-haiku-5-5", "claude-haiku-4-5"]);
  });

  it("falls back to the old read, not to zero, when the reader-aware read errors", async () => {
    failReaderRead = true;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const usage = await modelUsageSince("2026-10-01T00:00:00Z");
    expect(usage.map((row) => row.model)).toEqual(["claude-sonnet-5"]);
    expect(queries).toHaveLength(2);
    expect(queries[1]).toMatchObject({ select: "model, input_tokens, output_tokens, cache_read_input_tokens, cache_creation_input_tokens", or: null, not: true });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("counting answering calls only"));
  });

  it("still throws, as before, when the old read fails too (the guard lets the question through and logs)", async () => {
    failEverything = true;
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(modelUsageSince("2026-10-01T00:00:00Z")).rejects.toThrow("chat_traces usage read failed");
  });
});

describe("SPEND_GUARD_ALL_CALLS_ENABLED", () => {
  it("off: the query is as before (no slots.spend read)", async () => {
    await modelUsageSince("2026-10-01T00:00:00Z");
    expect(queries[0]!.select).not.toContain("spend");
    expect(queries[0]!.or).toBe("model.not.is.null,slots->reader.not.is.null");
  });

  it("on: a row's slots.spend replaces its model columns, a spend row counts, an older row counts as before", async () => {
    process.env.SPEND_GUARD_ALL_CALLS_ENABLED = "true";
    withSpend = true;
    const usage = await modelUsageSince("2026-10-01T00:00:00Z");
    expect(queries[0]).toMatchObject({
      select: expect.stringContaining("spend:slots->spend"),
      or: "model.not.is.null,slots->reader.not.is.null,slots->spend.not.is.null",
    });
    expect(usage.map((row) => row.model)).toEqual([
      "claude-sonnet-5",
      "claude-haiku-4-5",
      "claude-haiku-4-5",
      "claude-opus-5",
      "claude-haiku-4-5",
    ]);
  });
});

