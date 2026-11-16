import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { MAX_OPEN_QUESTIONS, personKey, readOpenQuestions } from "./card-record";
import { askedQuestion, type ToolEffects } from "./tools";

/** The open question record (Pau, 16 Nov 2026: every answer to a question Sunny asked is applied to that field). */
describe("the open question record", () => {
  it("keeps one question per kind, at most MAX_OPEN_QUESTIONS, so an earlier question is never overwritten", () => {
    const effects: ToolEffects = { proposal: null, formUpdate: null };
    askedQuestion(effects, { kind: "payroll" });
    askedQuestion(effects, { kind: "payroll", proposalId: "p-2" });
    askedQuestion(effects, { kind: "date", optionKeys: [personKey("2026-11-12"), personKey("2026-11-13")] });
    askedQuestion(effects, { kind: "exit_offer" });
    askedQuestion(effects, { kind: "ask" });
    expect(effects.openQuestions?.map((question) => question.kind)).toEqual(["payroll", "date", "exit_offer"]);
    expect(effects.openQuestions).toHaveLength(MAX_OPEN_QUESTIONS);
    expect(effects.openQuestions?.[0]?.proposalId).toBeUndefined();
  });

  it("reads back only known kinds and string keys, and holds no names or values", () => {
    const read = readOpenQuestions([
      { kind: "payroll", proposalId: "p-1" },
      { kind: "date", optionKeys: [personKey("2026-11-12"), 7] },
      { kind: "made_up" },
      null,
      { kind: "exit_offer" },
      { kind: "ask" },
    ]);
    expect(read).toEqual([{ kind: "payroll", proposalId: "p-1" }, { kind: "date", optionKeys: [personKey("2026-11-12")] }, { kind: "exit_offer" }]);
    expect(JSON.stringify(read)).not.toMatch(/2026-11-12/);
    expect(readOpenQuestions("payroll")).toEqual([]);
  });
});
