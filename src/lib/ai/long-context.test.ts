import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { prepareLongContext } from "./long-context-claude";
import { estimateTokens, selectLongContext } from "./long-context";

function turn(id: string, content: string) {
  return { id, role: "user", content };
}

describe("long context window", () => {
  it("keeps the last 10 when the caller does not ask for a budget", () => {
    const source = readFileSync("src/lib/ai/call-claude.ts", "utf8");
    expect(source).toContain(".slice(-10)");
    expect(source).toContain('historyPolicy === "budget"');
  });

  it("keeps at most 40 messages and leaves the older ones out", () => {
    const messages = Array.from({ length: 45 }, (_, index) => turn(`m${index}`, "ok"));
    const selected = selectLongContext(messages);
    expect(selected.kept).toHaveLength(40);
    expect(selected.kept[0]?.id).toBe("m5");
    expect(selected.older).toHaveLength(5);
    expect(selected.older[4]?.id).toBe("m4");
  });

  it("stops when the token budget is full and still keeps the newest turn", () => {
    const huge = "word ".repeat(8000);
    expect(estimateTokens(huge)).toBeGreaterThan(6000);
    const selected = selectLongContext([
      turn("old", huge),
      turn("mid", "a short follow up"),
      turn("new", "and the question"),
    ]);
    expect(selected.kept.map((item) => item.id)).toEqual(["mid", "new"]);
    expect(selected.older.map((item) => item.id)).toEqual(["old"]);
  });

  it("reuses a stored summary and summarizes only when older turns moved", async () => {
    const history = Array.from({ length: 45 }, (_, index) => turn(`m${index}`, "ok"));
    let summarized = 0;
    let saved: string | null = null;
    const first = await prepareLongContext({
      history,
      userId: "user-1",
      conversationId: "conv-1",
      load: async () => null,
      save: async (summary) => {
        saved = summary.summary;
      },
      summarize: async () => {
        summarized += 1;
        return "Jordan asked about a late open.";
      },
    });
    expect(summarized).toBe(1);
    expect(first.summary).toBe("Jordan asked about a late open.");
    expect(saved).toBe("Jordan asked about a late open.");

    const second = await prepareLongContext({
      history,
      userId: "user-1",
      conversationId: "conv-1",
      load: async () => ({ summary: "Jordan asked about a late open.", throughMessageId: "m4" }),
      save: async () => {
        throw new Error("should not save");
      },
      summarize: async () => {
        throw new Error("should not summarize");
      },
    });
    expect(second.summary).toBe("Jordan asked about a late open.");
  });

  it("keeps the previous summary when the new one fails", async () => {
    const history = Array.from({ length: 45 }, (_, index) => turn(`m${index}`, "ok"));
    const result = await prepareLongContext({
      history,
      userId: null,
      conversationId: null,
      summarize: async () => {
        throw new Error("model down");
      },
    });
    expect(result.summary).toBeNull();
  });
});
