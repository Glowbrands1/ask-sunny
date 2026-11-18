import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import { apiErrorReason } from "./assistant.server";

// 18 Nov 2026: the L10 assistant failed with a bare "AI_APICallError 400" in the logs; the model API's own reason is
// logged now, by position only (quoted values cut out), so the next failure says what was refused.
describe("apiErrorReason", () => {
  it("logs the API's error type and message, without quoted values", () => {
    const body = JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: 'messages.4.content.1: unexpected "how is Kearney doing"' } });
    expect(apiErrorReason({ responseBody: body })).toBe("invalid_request_error: messages.4.content.1: unexpected …");
  });
  it("falls back to the error message, capped, and is null without one", () => {
    expect(apiErrorReason({ message: "x".repeat(400) })).toHaveLength(300);
    expect(apiErrorReason({})).toBeNull();
    expect(apiErrorReason(null)).toBeNull();
  });
});

// 18 Nov 2026, the screenshot: after one failed answer, "hello" and "hi" failed too. The failed reply was saved with a
// lookup that never finished, and the whole chat was sent back with it. Unfinished lookups are left out now.
describe("modelMessages", () => {
  it("leaves out a lookup that never finished, and keeps the rest of the chat", async () => {
    const { modelMessages } = await import("./assistant.server");
    const chat = [
      { id: "1", role: "user", parts: [{ type: "text", text: "how is Kearney doing this month" }] },
      { id: "2", role: "assistant", parts: [{ type: "tool-read_stats", toolCallId: "t1", state: "input-available", input: { report: "comp", salon: "Kearney" } }] },
      { id: "3", role: "user", parts: [{ type: "text", text: "hi" }] },
    ];
    const out = await modelMessages(chat as never);
    const json = JSON.stringify(out);
    expect(json).not.toContain("tool-call");
    expect(json).toContain("how is Kearney doing this month");
    expect(json).toContain('"hi"');
  });
});
