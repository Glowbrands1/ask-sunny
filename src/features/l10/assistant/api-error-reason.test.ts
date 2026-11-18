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
