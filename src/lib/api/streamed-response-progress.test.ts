import { afterEach, describe, expect, it, vi } from "vitest";

import {
  KEEP_ALIVE_MS,
  PROGRESS_HEADER,
  PROGRESS_STREAM,
  START_AFTER_MS,
  STREAM_HEADER,
  progressChannel,
  readStreamedLines,
  streamWhenSlow,
  unwrapStreamed,
  wantsProgress,
} from "./streamed-response";

/**
 * PROGRESS LINES (rebuild plan PR 6, item 5; QA's design notes, 16 Nov 2026): while the AI loop works, the chat shows a
 * short status per tool step. Version 2 of the stream goes ONLY to a request that asked (the header) on a turn the
 * route enabled (a loop user); everyone else gets version 1 byte for byte. A line the client cannot read is skipped and
 * it waits for the envelope; it never errors.
 */

const ANSWER = { content: "Here is the **Corrective Action Form** for **Remy Calder** for you to review.", citations: [], coverage: "not_applicable", turnId: "turn-1" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const after = (ms: number, make: () => Response) => new Promise<Response>((resolve) => setTimeout(() => resolve(make()), ms));

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** The stream for a 12 s answer, with statuses sent at the given times (ms from the request). */
async function run(options: { enable: boolean; channel: boolean; statuses?: [number, string][] }) {
  vi.useFakeTimers();
  const progress = options.channel ? progressChannel() : undefined;
  if (options.enable) progress?.enable();
  for (const [at, status] of options.statuses ?? []) setTimeout(() => progress?.emit(status), at);
  const pending = streamWhenSlow(() => after(12_000, () => json(ANSWER)), progress);
  await vi.advanceTimersByTimeAsync(START_AFTER_MS);
  const response = await pending;
  const text = response.text();
  await vi.advanceTimersByTimeAsync(12_000);
  return { response, text: await text, progress };
}

describe("version 1 is unchanged for everyone who did not get the progress channel", () => {
  it("no channel (the browser did not ask), or a channel never enabled (not a loop user): the same bytes and headers as before", async () => {
    const plain = await run({ enable: false, channel: false });
    const notEnabled = await run({ enable: false, channel: true, statuses: [[3_000, "Looking up Remy…"]] });
    for (const { response, text } of [plain, notEnabled]) {
      expect(response.headers.get(STREAM_HEADER)).toBe("1");
      expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
      expect(text).not.toContain("progress");
      expect(JSON.parse(text)).toEqual({ status: 200, body: ANSWER });
    }
    expect(notEnabled.text, "version 1 bytes changed").toBe(plain.text);
  });

  it("a status emitted on a channel that is not enabled is dropped", () => {
    const channel = progressChannel();
    const seen: string[] = [];
    channel.listen((status) => seen.push(status));
    channel.emit("Looking up Remy…");
    expect(seen).toEqual([]);
  });

  it("wantsProgress reads only the request header", () => {
    expect(wantsProgress(new Request("https://app.test/api/chat", { method: "POST", headers: { [PROGRESS_HEADER]: "1" } }))).toBe(true);
    expect(wantsProgress(new Request("https://app.test/api/chat", { method: "POST" }))).toBe(false);
  });
});

describe("version 2: the header and an enabled channel", () => {
  it("statuses line by line, keep-alives, then the same envelope on the last line", async () => {
    const { response, text } = await run({ enable: true, channel: true, statuses: [[1_000, "Looking up Remy Calder…"], [4_000, "Reading the policy…"], [8_000, "Building the card…"]] });
    expect(response.status).toBe(200);
    expect(response.headers.get(STREAM_HEADER)).toBe(PROGRESS_STREAM);
    const lines = text.split("\n").filter((line) => line !== "");
    // The status sent before the stream began (1 s) is sent first, as the latest so far.
    expect(lines.slice(0, -1).map((line) => JSON.parse(line))).toEqual([{ progress: "Looking up Remy Calder…" }, { progress: "Reading the policy…" }, { progress: "Building the card…" }]);
    expect(JSON.parse(lines.at(-1)!)).toEqual({ status: 200, body: ANSWER });
    expect(text.match(/\n\n/g)?.length ?? 0, "no keep-alives").toBeGreaterThanOrEqual(Math.floor(10_000 / KEEP_ALIVE_MS) - 1);
  });

  it("a fast answer (under 2 s) is returned as it is, with no statuses", async () => {
    vi.useFakeTimers();
    const progress = progressChannel();
    progress.enable();
    const fast = json(ANSWER);
    const pending = streamWhenSlow(() => after(300, () => fast), progress);
    await vi.advanceTimersByTimeAsync(300);
    expect(await pending).toBe(fast);
  });
});

describe("a multi-line reply stays on the envelope's one line (QA's review of #1058)", () => {
  it("newlines in the reply are escaped by JSON.stringify, so the envelope line is never split", async () => {
    vi.useFakeTimers();
    const multi = { ...ANSWER, content: "Here is the card.\n\n**Observation of Offense:** she was late.\r\n**Policy:** Attendance (p.14)" };
    const progress = progressChannel();
    progress.enable();
    setTimeout(() => progress.emit("Building the card…"), 3_000);
    const pending = streamWhenSlow(() => after(6_000, () => json(multi)), progress);
    await vi.advanceTimersByTimeAsync(START_AFTER_MS);
    const response = await pending;
    const text = response.text();
    await vi.advanceTimersByTimeAsync(6_000);
    const lines = (await text).split("\n").filter((line) => line !== "");
    expect(JSON.parse(lines.at(-1)!)).toEqual({ status: 200, body: multi });
    expect(lines.filter((line) => line.includes("Observation"))).toHaveLength(1);
    vi.useRealTimers();
    const seen: string[] = [];
    await expect(readStreamedLines(new Response(await text, { headers: { [STREAM_HEADER]: PROGRESS_STREAM } }), (status) => seen.push(status))).resolves.toEqual({ status: 200, body: multi });
    expect(seen).toEqual(["Building the card…"]);
  });
});

describe("the client reads version 2, and never errors on a line it cannot read", () => {
  const body = (text: string) => new Response(text, { status: 200, headers: { [STREAM_HEADER]: PROGRESS_STREAM } });

  it("hands each status to onProgress and returns the envelope", async () => {
    const seen: string[] = [];
    const text = `\n${JSON.stringify({ progress: "Looking up Remy…" })}\n\n${JSON.stringify({ progress: "Building the card…" })}\n${JSON.stringify({ status: 200, body: ANSWER })}`;
    await expect(readStreamedLines(body(text), (status) => seen.push(status))).resolves.toEqual({ status: 200, body: ANSWER });
    expect(seen).toEqual(["Looking up Remy…", "Building the card…"]);
  });

  it("an unreadable line, a line of another shape, and a throwing screen update are skipped", async () => {
    const text = `\n{"progress": "Looking up Re\n[1,2]\n"just text"\n${JSON.stringify({ progress: 7 })}\n${JSON.stringify({ status: 200, body: ANSWER })}\n`;
    await expect(readStreamedLines(body(text), () => {
      throw new Error("the screen failed");
    })).resolves.toEqual({ status: 200, body: ANSWER });
  });

  it("lines split across chunks are joined", async () => {
    const whole = `\n${JSON.stringify({ progress: "Reading the policy…" })}\n${JSON.stringify({ status: 200, body: ANSWER })}`;
    const bytes = new TextEncoder().encode(whole);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let at = 0; at < bytes.length; at += 7) controller.enqueue(bytes.slice(at, at + 7));
        controller.close();
      },
    });
    const seen: string[] = [];
    await expect(readStreamedLines(new Response(stream), (status) => seen.push(status))).resolves.toEqual({ status: 200, body: ANSWER });
    expect(seen).toEqual(["Reading the policy…"]);
  });

  it("no envelope: a 502, as an unreadable version 1 body is", async () => {
    await expect(readStreamedLines(body(`\n${JSON.stringify({ progress: "Building the card…" })}\n`))).resolves.toEqual({ status: 502, body: {} });
  });

  it("ClaudeProvider: asks with the header only when given onProgress, shows the statuses, and returns the same answer as version 1", async () => {
    const asked: Record<string, string>[] = [];
    const v2 = `\n${JSON.stringify({ progress: "Looking up Remy…" })}\n${JSON.stringify({ status: 200, body: ANSWER })}`;
    vi.stubGlobal("fetch", async (_url: string, init: { headers: Record<string, string> }) => {
      asked.push(init.headers);
      return init.headers[PROGRESS_HEADER] === "1" ? body(v2) : new Response(`\n${JSON.stringify({ status: 200, body: ANSWER })}`, { status: 200, headers: { [STREAM_HEADER]: "1" } });
    });
    const { ClaudeProvider } = await import("@/lib/ai/claude-provider");
    const seen: string[] = [];
    const request = { question: "ca for remy calder, she was 20 minutes late on 11/12", history: [] } as never;
    await expect(new ClaudeProvider().ask(request, { onProgress: (status) => seen.push(status) })).resolves.toEqual(ANSWER);
    await expect(new ClaudeProvider().ask(request)).resolves.toEqual(ANSWER);
    expect(seen).toEqual(["Looking up Remy…"]);
    expect(asked[0]![PROGRESS_HEADER]).toBe("1");
    expect(asked[1]![PROGRESS_HEADER]).toBeUndefined();
    expect(unwrapStreamed(`\n${JSON.stringify({ status: 200, body: ANSWER })}`).body).toEqual(ANSWER);
  });
});
