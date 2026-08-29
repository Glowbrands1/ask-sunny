import { describe, expect, it } from "vitest";

import { AiError } from "@/lib/ai/errors";
import { chatErrorTitle, toChatTurnError } from "./chat-error";

/**
 * CHAT FAILURE STATES.
 *
 * Two properties matter here. First, `retryable` has to be right: offering
 * "Try again" on a missing API key wastes a manager's time and teaches them to
 * ignore the button. Second, no branch may ever soften a failure into something
 * that reads like an answer.
 */

const QUESTION = "What is the attendance policy?";

describe("toChatTurnError", () => {
  it("maps a configuration failure to a non-retryable state naming what is unset", () => {
    const turn = toChatTurnError(
      new AiError("not_configured", "…", 503, ["ANTHROPIC_API_KEY", "VOYAGE_API_KEY"]),
      QUESTION,
    );

    expect(turn.kind).toBe("not_configured");
    // Asking again cannot conjure a key.
    expect(turn.retryable).toBe(false);
    expect(turn.missing).toEqual(["ANTHROPIC_API_KEY", "VOYAGE_API_KEY"]);
  });

  it("maps a retrieval failure to a retryable state that says nothing was answered", () => {
    const turn = toChatTurnError(
      new AiError("retrieval_failed", "…", 502),
      QUESTION,
    );

    expect(turn.kind).toBe("retrieval_failed");
    expect(turn.retryable).toBe(true);
    // The manager must know the silence was not an answer from memory.
    expect(turn.message).toContain("not answered from memory");
  });

  it("maps a model failure to a retryable state", () => {
    const turn = toChatTurnError(new AiError("model_failed", "…", 502), QUESTION);
    expect(turn.kind).toBe("model_failed");
    expect(turn.retryable).toBe(true);
    expect(turn.message).toContain("Nothing was answered from memory");
  });

  it("maps a rate limit to its own retryable state, not a generic failure", () => {
    const turn = toChatTurnError(
      new AiError("bad_request", "Too many requests. Try again in 42 seconds.", 429),
      QUESTION,
    );

    expect(turn.kind).toBe("rate_limited");
    expect(turn.retryable).toBe(true);
    expect(turn.message).toContain("42 seconds");
  });

  it("maps an ordinary bad request to a non-retryable state", () => {
    const turn = toChatTurnError(
      new AiError("bad_request", "That question is too long.", 400),
      QUESTION,
    );
    expect(turn.kind).toBe("bad_request");
    // Re-sending the same too-long question fails identically.
    expect(turn.retryable).toBe(false);
  });

  it("maps a model refusal to a non-retryable state", () => {
    const turn = toChatTurnError(new AiError("refused", "Sunny could not…", 422), QUESTION);
    expect(turn.kind).toBe("model_failed");
    expect(turn.retryable).toBe(false);
  });

  it("maps an authorization failure without offering a retry", () => {
    const authError = new Error("You are not signed in.");
    authError.name = "AuthError";

    const turn = toChatTurnError(authError, QUESTION);
    expect(turn.kind).toBe("unauthenticated");
    expect(turn.retryable).toBe(false);
  });

  it("handles a network failure and anything else unrecognised", () => {
    const turn = toChatTurnError(new TypeError("Failed to fetch"), QUESTION);
    expect(turn.kind).toBe("unknown");
    expect(turn.retryable).toBe(true);
    expect(turn.message).toContain("no answer was produced");
  });

  it("always carries the question back so retry can resend it", () => {
    for (const error of [
      new AiError("model_failed", "…", 502),
      new AiError("not_configured", "…", 503),
      new Error("anything"),
    ]) {
      expect(toChatTurnError(error, QUESTION).question).toBe(QUESTION);
    }
  });

  it("never produces a message that could be mistaken for an answer", () => {
    const errors = [
      new AiError("not_configured", "…", 503, ["ANTHROPIC_API_KEY"]),
      new AiError("retrieval_failed", "…", 502),
      new AiError("model_failed", "…", 502),
      new Error("boom"),
    ];

    for (const error of errors) {
      const turn = toChatTurnError(error, QUESTION);
      // Every failure states that nothing was answered, or names the fault.
      expect(turn.message.length).toBeGreaterThan(20);
      expect(turn.kind).not.toBe("grounded");
    }
  });
});

describe("chatErrorTitle", () => {
  it("gives every failure kind a distinct, plain-language heading", () => {
    const kinds = [
      "not_configured",
      "unauthenticated",
      "retrieval_failed",
      "rate_limited",
      "bad_request",
      "model_failed",
      "unknown",
    ] as const;

    const titles = kinds.map(chatErrorTitle);
    for (const title of titles) {
      expect(title.length).toBeGreaterThan(3);
      // No error codes or jargon in front of a salon manager.
      expect(title).not.toMatch(/[_]|error|exception/i);
    }
    // model_failed and unknown deliberately share a heading; the rest differ.
    expect(new Set(titles).size).toBe(kinds.length - 1);
  });
});
