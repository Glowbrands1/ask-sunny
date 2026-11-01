import { afterEach, describe, expect, it, vi } from "vitest";

import { AiError } from "@/lib/ai/errors";

import { KEEP_ALIVE_MS, START_AFTER_MS, STREAM_HEADER, streamWhenSlow, unwrapStreamed } from "./streamed-response";

/**
 * QA, live, 1 Nov 2026: "Show me the most recent Daily Stats and what I need
 * to focus on today." took 30.5 s on the server and the manager saw "No answer
 * was produced" at about 30 s — the request was cut off before its response
 * began. CHAT_RESPONSE_STREAM_ENABLED streams a slow answer.
 */

const ANSWER = { content: "Using the most recent Daily Stats — Sales Totals for Fri, Oct 30 …", citations: [], coverage: "covered", turnId: "turn-1" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const after = (ms: number, response: Response) => new Promise<Response>((resolve) => setTimeout(() => resolve(response), ms));

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function streamed(produce: () => Promise<Response>, totalMs: number) {
  vi.useFakeTimers();
  const pending = streamWhenSlow(produce);
  await vi.advanceTimersByTimeAsync(START_AFTER_MS);
  const response = await pending;
  const text = response.text();
  await vi.advanceTimersByTimeAsync(totalMs);
  return { response, text: await text };
}

describe("a slow answer (35 s) is streamed: 200 at once, keep-alive whitespace, then the same JSON", () => {
  it("delivers the answer the handler made, with its status, as one JSON document", async () => {
    const { response, text } = await streamed(() => after(35_000, json(ANSWER)), 35_000);
    expect(response.status).toBe(200);
    expect(response.headers.get(STREAM_HEADER)).toBe("1");
    // A newline at once and every KEEP_ALIVE_MS: JSON whitespace before the one object.
    expect(text.startsWith("\n")).toBe(true);
    expect(text.match(/^\n+/)![0].length).toBeGreaterThanOrEqual(Math.floor(35_000 / KEEP_ALIVE_MS));
    expect(JSON.parse(text)).toEqual({ status: 200, body: ANSWER });
    expect(unwrapStreamed(text)).toEqual({ status: 200, body: ANSWER });
  });

  it("an error after the stream began carries its own status and the same code and message", async () => {
    const failure = { error: "Sunny could not reach the language model. No answer was generated.", code: "model_failed", missing: [] };
    const { text } = await streamed(() => after(31_000, json(failure, 502)), 31_000);
    expect(unwrapStreamed(text)).toEqual({ status: 502, body: failure });
  });
});

describe("a fast answer, and every early refusal, is returned as it is", () => {
  it("auth, rate limit and bad requests keep their own HTTP status and headers", async () => {
    vi.useFakeTimers();
    const refused = new Response(JSON.stringify({ error: "Too many requests.", code: "bad_request" }), { status: 429, headers: { "retry-after": "12" } });
    const pending = streamWhenSlow(() => after(150, refused));
    await vi.advanceTimersByTimeAsync(150);
    const response = await pending;
    expect(response).toBe(refused);
    expect(response.headers.get(STREAM_HEADER)).toBeNull();
  });
});

describe("the client reads a streamed answer exactly like a plain one", () => {
  async function ask(response: Response) {
    vi.stubGlobal("fetch", async () => response);
    const { ClaudeProvider } = await import("@/lib/ai/claude-provider");
    return new ClaudeProvider().ask({ question: "Show me the most recent Daily Stats and what I need to focus on today.", history: [] } as never);
  }
  const streamedBody = (status: number, body: unknown) =>
    new Response(`\n\n\n${JSON.stringify({ status, body })}`, { status: 200, headers: { [STREAM_HEADER]: "1" } });

  it("the answer", async () => {
    await expect(ask(streamedBody(200, ANSWER))).resolves.toEqual(ANSWER);
  });

  it("an error: the same AiError as today's non-OK response", async () => {
    const failure = { error: "Sunny could not reach the language model. No answer was generated.", code: "model_failed" };
    const plain = await ask(json(failure, 502)).catch((error: unknown) => error);
    const viaStream = await ask(streamedBody(502, failure)).catch((error: unknown) => error);
    expect(viaStream).toBeInstanceOf(AiError);
    expect(viaStream).toMatchObject({ code: (plain as AiError).code, message: (plain as AiError).message, status: 502 });
  });

  it("a plain response (flag off) is read as before", async () => {
    await expect(ask(json(ANSWER))).resolves.toEqual(ANSWER);
  });
});
