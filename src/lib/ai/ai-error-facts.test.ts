import { APICallError } from "@ai-sdk/provider";
import { RetryError } from "ai";
import { describe, expect, it } from "vitest";

import { aiErrorFacts, isOverloadedError } from "./ai-error-facts";
import { classifyDiscardedError } from "./model-failure";
import { describeAiError } from "./time-limit";

/**
 * Production, 23 Nov 2026: four agent-loop turns failed in about 250 ms and the
 * server log said only "[ai.failure] route=chat call=agent_loop error=aG". The
 * AI SDK's errors carry `statusCode` and a readable `name`, which the log line
 * never read; the class name it did read is minified in a production build.
 */
function apiCallError(statusCode: number, type: string): APICallError {
  return new APICallError({
    message: "the request text could be in here",
    url: "https://api.anthropic.com/v1/messages",
    requestBodyValues: { messages: ["a manager's words"] },
    statusCode,
    responseBody: JSON.stringify({ type: "error", error: { type, message: "Overloaded" } }),
    isRetryable: statusCode >= 500,
  });
}

/** What a production build does to a class name. */
function minified<T extends Error>(error: T): T {
  Object.defineProperty(error.constructor, "name", { value: "aG", configurable: true });
  return error;
}

describe("a failed AI SDK call is logged with its status and type", () => {
  it("an overloaded 529 says so in the log line, never the minified class name", () => {
    const error = minified(apiCallError(529, "overloaded_error"));
    const line = describeAiError(error);
    expect(line).toContain("HTTP 529");
    expect(line).toContain("overloaded_error");
    expect(line).toContain("AI_APICallError");
    expect(line).not.toBe("aG");
    expect(line).not.toContain("a manager's words");
    expect(line).not.toContain("the request text");
  });

  it("an AI SDK RetryError reports the last real failure", () => {
    const retry = new RetryError({ message: "Failed after 3 attempts", reason: "maxRetriesExceeded", errors: [apiCallError(500, "api_error"), apiCallError(529, "overloaded_error")] });
    expect(aiErrorFacts(retry)).toMatchObject({ status: 529, type: "overloaded_error", afterRetries: true });
    expect(describeAiError(retry)).toContain("after_retries");
  });

  it("an overloaded AI SDK error is overloaded (the busy wording), as the Anthropic SDK's is", () => {
    expect(isOverloadedError(apiCallError(529, "overloaded_error"))).toBe(true);
    expect(isOverloadedError({ status: 529, error: { type: "overloaded_error" } })).toBe(true);
    expect(isOverloadedError(apiCallError(400, "invalid_request_error"))).toBe(false);
  });

  it("the trace classifier reads the AI SDK's statusCode too", () => {
    const facts = classifyDiscardedError(minified(apiCallError(429, "rate_limit_error")));
    expect(facts).toMatchObject({ subtype: "rate_limit", errorStatus: 429, errorClass: "AI_APICallError" });
  });

  it("the Anthropic SDK's own shape reads as before", () => {
    expect(describeAiError({ status: 500, error: { type: "api_error" }, name: "InternalServerError" })).toBe("HTTP 500 api_error InternalServerError");
  });
});
