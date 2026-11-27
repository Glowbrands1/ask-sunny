import { describe, expect, it, vi } from "vitest";

import { ASSEMBLYAI_MODEL, ASSEMBLYAI_SYNC_URL, snakeCase, transcribeVoice, type TranscribeDeps } from "./transcribe";
import { PROVIDER_TIMEOUT_MS } from "./voice-limits";

/*
 * VOICE_INPUT_ENABLED: the AssemblyAI Sync call, with a fake fetch. The status recorded is the number
 * `response.status`; the error class is the provider's problem-details `title`, snake-cased.
 */

const INPUT = {
  audio: new Uint8Array(2048).fill(7),
  mime: "audio/webm" as const,
  keyterms: ["Ada Quill", "Coaching Form"],
  prompt: "A manager is speaking.",
  conversationContext: ["earlier turn"],
};

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": status < 300 ? "application/json" : "application/problem+json", ...headers } });

function deps(responses: (Response | Error)[], extra: Partial<TranscribeDeps> = {}) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const next = responses.shift();
    if (!next) throw new Error("no response scripted");
    if (next instanceof Error) throw next;
    return next;
  }) as unknown as typeof globalThis.fetch;
  const sleep = vi.fn(async () => undefined);
  let clock = 1_000_000;
  return {
    calls,
    sleep,
    deps: { fetch, apiKey: "test-key-not-real", deadline: clock + 43_000, now: () => clock, sleep, ...extra } satisfies TranscribeDeps,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

describe("transcribeVoice", () => {
  it("200: the provider's text as it is, the audio length, and the request it sent", async () => {
    const t = deps([json(200, { text: "  hello ada quill  ", audio_duration_ms: 4200, words: [] })]);
    const result = await transcribeVoice(INPUT, t.deps);
    expect(result).toEqual({ text: "  hello ada quill  ", audioSeconds: 4.2, status: 200, errorClass: null, retried: false, outcome: "ok" });
    expect(t.calls).toHaveLength(1);
    const { url, init } = t.calls[0]!;
    expect(url).toBe(ASSEMBLYAI_SYNC_URL);
    expect(url).toBe("https://sync.assemblyai.com/v1/transcribe");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ Authorization: "test-key-not-real", "X-AAI-Model": ASSEMBLYAI_MODEL });
    expect(ASSEMBLYAI_MODEL).toBe("universal-3-6-pro");
    const form = init.body as FormData;
    const audio = form.get("audio") as File;
    expect(audio.type).toBe("audio/webm");
    expect(audio.size).toBe(2048);
    const config = JSON.parse(await (form.get("config") as Blob).text());
    expect(config).toEqual({
      keyterms_prompt: ["Ada Quill", "Coaching Form"],
      prompt: "A manager is speaking.",
      language_codes: ["en"],
      conversation_context: ["earlier turn"],
    });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("sends audio/mp4 for an MP4 recording, and no conversation_context when there is none", async () => {
    const t = deps([json(200, { text: "ok", audio_duration_ms: 1000 })]);
    await transcribeVoice({ ...INPUT, mime: "audio/mp4", conversationContext: undefined }, t.deps);
    const form = t.calls[0]!.init.body as FormData;
    expect((form.get("audio") as File).type).toBe("audio/mp4");
    expect(JSON.parse(await (form.get("config") as Blob).text())).not.toHaveProperty("conversation_context");
  });

  it("empty text is 'empty', not an answer", async () => {
    const result = await transcribeVoice(INPUT, deps([json(200, { text: "   ", audio_duration_ms: 900 })]).deps);
    expect(result.outcome).toBe("empty");
    expect(result.status).toBe(200);
  });

  it.each([
    [400, "Bad Request", "bad_audio", "bad_request"],
    [401, "Unauthorized", "unauthorized", "unauthorized"],
    [413, "Payload Too Large", "too_long", "payload_too_large"],
    [415, "Unsupported Media Type", "bad_audio", "unsupported_media_type"],
  ])("%i is never retried, and its status (a number) and class are recorded", async (status, title, outcome, errorClass) => {
    const t = deps([json(status, { title, status, detail: "x" })]);
    const result = await transcribeVoice(INPUT, t.deps);
    expect(t.calls).toHaveLength(1);
    expect(t.sleep).not.toHaveBeenCalled();
    expect(typeof result.status).toBe("number");
    expect(result).toMatchObject({ status, outcome, errorClass, retried: false, text: "" });
  });

  it("429 with Retry-After: retried once after that wait; a second 429 is 'busy' with its Retry-After", async () => {
    const t = deps([json(429, { title: "Too Many Requests" }, { "retry-after": "1" }), json(429, { title: "Too Many Requests" }, { "retry-after": "1" })]);
    const result = await transcribeVoice(INPUT, t.deps);
    expect(t.calls).toHaveLength(2);
    expect(t.sleep).toHaveBeenCalledWith(1000);
    expect(result).toMatchObject({ status: 429, outcome: "busy", errorClass: "too_many_requests", retried: true, retryAfterSeconds: 1 });
  });

  it("429 whose Retry-After is longer than the retry wait allows is not retried", async () => {
    const t = deps([json(429, { title: "Too Many Requests" }, { "retry-after": "5" })]);
    const result = await transcribeVoice(INPUT, t.deps);
    expect(t.calls).toHaveLength(1);
    expect(result).toMatchObject({ status: 429, outcome: "busy", retried: false, retryAfterSeconds: 5 });
  });

  it("503 then success: the text, retried", async () => {
    const t = deps([json(503, { title: "Service Unavailable" }), json(200, { text: "second try", audio_duration_ms: 3000 })]);
    const result = await transcribeVoice(INPUT, t.deps);
    expect(t.calls).toHaveLength(2);
    expect(result).toMatchObject({ text: "second try", status: 200, outcome: "ok", retried: true });
  });

  it("504 then success: the text, retried", async () => {
    const t = deps([json(504, { title: "Gateway Timeout" }), json(200, { text: "after the deadline", audio_duration_ms: 3000 })]);
    const result = await transcribeVoice(INPUT, t.deps);
    expect(result).toMatchObject({ text: "after the deadline", status: 200, retried: true });
  });

  it("no retry when too little of the route's time is left", async () => {
    const t = deps([json(503, { title: "Service Unavailable" })]);
    t.advance(36_000);
    const result = await transcribeVoice(INPUT, t.deps);
    expect(t.calls).toHaveLength(1);
    expect(result).toMatchObject({ status: 503, outcome: "busy", retried: false });
  });

  it("a timeout: no status, class 'timeout', and the 28-second limit was set", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    const t = deps([new DOMException("The operation timed out.", "TimeoutError")]);
    const result = await transcribeVoice(INPUT, t.deps);
    expect(timeout).toHaveBeenCalledWith(PROVIDER_TIMEOUT_MS);
    expect(PROVIDER_TIMEOUT_MS).toBe(28_000);
    expect(result).toMatchObject({ status: null, errorClass: "timeout", outcome: "timeout", retried: false });
    timeout.mockRestore();
  });

  it("a malformed 200 body is 'unavailable', never a blank answer", async () => {
    const result = await transcribeVoice(INPUT, deps([json(200, { transcript: "wrong field" })]).deps);
    expect(result).toMatchObject({ status: 200, outcome: "unavailable", errorClass: "invalid_response", text: "" });
  });

  it("snake-cases problem titles", () => {
    expect(snakeCase("Too Many Requests")).toBe("too_many_requests");
    expect(snakeCase("Payload Too Large")).toBe("payload_too_large");
    expect(snakeCase("InvalidAudio")).toBe("invalid_audio");
  });
});
