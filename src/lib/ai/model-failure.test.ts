import { describe, expect, it } from "vitest";

import { runChatTrace, type ChatTraceDraft } from "./chat-trace-store";
import { classifyDiscardedError, noteModelCall } from "./model-failure";

function draft(): ChatTraceDraft {
  return {
    startedAt: Date.now(),
    conversationId: null,
    messageId: null,
    userId: null,
    originalQuery: "hello",
    rewrittenQuery: null,
    intent: null,
    retrievalCount: null,
    retrieved: [],
    prompt: null,
    formInProgress: false,
    modelCall: null,
    errorSubtype: null,
    errorClass: null,
    errorStatus: null,
    succeeded: null,
  };
}

describe("discarded model errors", () => {
  it("classifies the Anthropic error class without reading a message body", () => {
    expect(classifyDiscardedError({ name: "APIError", status: 429, error: { type: "rate_limit_error" } })).toMatchObject({
      subtype: "rate_limit",
      errorStatus: 429,
    });
    expect(classifyDiscardedError({ name: "APIError", status: 529, error: { type: "overloaded_error" } }).subtype).toBe(
      "overloaded",
    );
    expect(classifyDiscardedError({ name: "APIConnectionTimeoutError", status: 408 }).subtype).toBe("timeout");
    expect(classifyDiscardedError({ name: "APIError", status: 500, error: { type: "api_error" } }).subtype).toBe("5xx");
    expect(classifyDiscardedError({ name: "APIError", status: 400, error: { type: "invalid_request_error" } }).subtype).toBe(
      "bad_request",
    );
    expect(classifyDiscardedError({ name: "APIError", status: 502 }).subtype).toBe("5xx");
  });

  it("records stop reason, tokens, thinking, latency, and a retry flag without retrying", async () => {
    const trace = draft();
    await runChatTrace(trace, async () => {
      noteModelCall({
        model: "claude-opus-5",
        maxTokens: 2048,
        stopReason: "end_turn",
        latencyMs: 40,
        usage: { input_tokens: 10, output_tokens: 4, output_tokens_details: { thinking_tokens: 2 } },
        subtype: "empty_answer",
      });
      noteModelCall({
        model: "claude-opus-5",
        maxTokens: 2048,
        stopReason: null,
        latencyMs: 12,
        usage: null,
        error: { name: "APIError", status: 429, error: { type: "rate_limit_error" }, message: "secret request body" },
      });
    });
    expect(trace.modelCall).toMatchObject({
      model: "claude-opus-5",
      maxTokens: 2048,
      errorSubtype: "rate_limit",
      errorStatus: 429,
      retryable: true,
      retried: false,
      latencyMs: 12,
    });
    expect(JSON.stringify(trace)).not.toContain("secret request body");
  });

  it("marks a refusal and does not mark it retryable", async () => {
    const trace = draft();
    await runChatTrace(trace, async () => {
      noteModelCall({
        model: "claude-opus-5",
        maxTokens: 1024,
        stopReason: "refusal",
        latencyMs: 8,
        usage: { input_tokens: 3, output_tokens: 1, output_tokens_details: { thinking_tokens: 0 } },
        subtype: "refused",
      });
    });
    expect(trace.errorSubtype).toBe("refused");
    expect(trace.modelCall?.retryable).toBe(false);
    expect(trace.modelCall?.thinkingTokens).toBe(0);
    expect(trace.modelCall?.retried).toBe(false);
  });
});
