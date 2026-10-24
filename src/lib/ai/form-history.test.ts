import { describe, expect, it } from "vitest";

import { firstMessageDropped, keptFormHistory } from "./form-history";

describe("fresh chat history", () => {
  it("keeps the first manager message when the current turn is not in history yet", () => {
    const history = [
      { id: "u1", role: "user", content: "an employee opened the salon 15 min late and needs CA" },
      { id: "a1", role: "assistant", content: "Here is the form." },
    ];
    const kept = keptFormHistory(history, "current-not-in-history", 1);
    expect(kept.map((message) => message.content)).toContain(history[0]!.content);
  });

  it("counts a missing first message as a harness re-send, not as the case failing", () => {
    const history = [
      { id: "u1", role: "user", content: "create a CA form for ima employee" },
      { id: "a1", role: "assistant", content: "Which salon?" },
    ];
    const payload = [{ id: "a1", role: "assistant", content: "Which salon?" }];
    expect(firstMessageDropped(history, payload)).toBe(true);
    const resent = firstMessageDropped(history, keptFormHistory(history, "missing", 1));
    expect(resent).toBe(false);
  });
});
