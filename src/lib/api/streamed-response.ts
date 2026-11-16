/**
 * ============================================================================
 * A SLOW ANSWER IS STREAMED, SO NOTHING CUTS IT OFF AT 30 SECONDS
 * ============================================================================
 *
 * CHAT_RESPONSE_STREAM_ENABLED (QA, live, 1 Nov 2026; Pau: "Go streaming";
 * same flag in both apps). Between the browser and the function, a request
 * that has not begun its response within about 30 s is cut off — even with
 * `maxDuration = 120` — so a long Daily Stats answer finished on the server
 * while the manager saw "No answer was produced".
 *
 * WIRE FORMAT, when the handler is slow:
 *
 *   HTTP 200, `x-chat-stream: 1`, `content-type: application/json`
 *   "\n" at once, then "\n" every KEEP_ALIVE_MS while the answer is made
 *   then ONE JSON object: {"status": <the handler's HTTP status>, "body": <its JSON body>}
 *
 * The keep-alive bytes are JSON whitespace, so the whole body is still one
 * valid JSON document. The client (`ai/claude-provider.ts`) sees the header,
 * reads the body to the end, and treats `status` and `body` exactly as it
 * treats a plain response today — same codes, same messages, same shape.
 *
 * A HANDLER THAT ANSWERS WITHIN START_AFTER_MS is returned as it is, byte for
 * byte. Auth, the rate limit and a bad body are decided in the first
 * milliseconds, so they keep their own HTTP status and headers.
 */

export const START_AFTER_MS = 2_000;
export const KEEP_ALIVE_MS = 5_000;
export const STREAM_HEADER = "x-chat-stream";

/*
 * PROGRESS LINES (rebuild plan PR 6, item 5; QA-approved design, 16 Nov 2026): while the AI loop works, a short status
 * per tool step ("Looking up <name>…", "Building the card…") in place of the empty wait. Only when BOTH the browser
 * asked for them (request header PROGRESS_HEADER: 1) AND the route enabled the channel for this turn (a loop user,
 * `agentLoopFor`) by the time the stream starts. Then the stream is version 2:
 *
 *   HTTP 200, `x-chat-stream: 2`
 *   "\n" at once, a line {"progress": "<status>"} per status, "\n" keep-alives,
 *   then the same envelope {"status", "body"} as version 1, on the last line
 *
 * Everyone else gets version 1, byte for byte. A status is display only: never part of the reply, the history or a
 * trace. The client reads version 2 line by line (`readStreamedLines`); a line it cannot read is skipped.
 */
export const PROGRESS_HEADER = "x-chat-progress";
export const PROGRESS_STREAM = "2";

export interface ProgressChannel {
  /** The route turns the channel on for a turn that may send statuses (a loop user). Off, nothing is ever sent. */
  enable(): void;
  readonly enabled: boolean;
  /** A status for the screen. Ignored while off, and after the stream started as version 1. */
  emit(status: string): void;
  /** The stream's side: the latest status so far, then each new one. */
  listen(onStatus: (status: string) => void): void;
}

export function progressChannel(): ProgressChannel {
  let enabled = false;
  let latest: string | null = null;
  let listener: ((status: string) => void) | null = null;
  return {
    enable() {
      enabled = true;
    },
    get enabled() {
      return enabled;
    },
    emit(status) {
      if (!enabled || status.trim() === "") return;
      latest = status;
      listener?.(status);
    },
    listen(onStatus) {
      listener = onStatus;
      if (latest !== null) onStatus(latest);
    },
  };
}

/** The browser asked for progress lines (the request header). */
export function wantsProgress(request: Request): boolean {
  return request.headers.get(PROGRESS_HEADER) === "1";
}

export async function streamWhenSlow(produce: () => Promise<Response>, progress?: ProgressChannel): Promise<Response> {
  const pending = produce();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const early = await Promise.race([
    pending,
    new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), START_AFTER_MS);
    }),
  ]);
  clearTimeout(timer);
  if (early) return early;

  const encoder = new TextEncoder();
  let beat: ReturnType<typeof setInterval> | undefined;
  /* Version 2 only when the channel was enabled before the stream starts; decided once, here. */
  const withProgress = progress?.enabled === true;
  let finished = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode("\n"));
      if (withProgress) {
        progress!.listen((status) => {
          if (finished) return;
          try {
            controller.enqueue(encoder.encode(`${JSON.stringify({ progress: status })}\n`));
          } catch {
            // The browser went away.
          }
        });
      }
      beat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode("\n"));
        } catch {
          clearInterval(beat);
        }
      }, KEEP_ALIVE_MS);
      void (async () => {
        let envelope: { status: number; body: unknown };
        try {
          const response = await pending;
          const text = await response.text();
          let body: unknown = {};
          try {
            body = text ? JSON.parse(text) : {};
          } catch {
            body = {};
          }
          envelope = { status: response.status, body };
        } catch {
          envelope = { status: 500, body: {} };
        }
        clearInterval(beat);
        finished = true;
        try {
          controller.enqueue(encoder.encode(JSON.stringify(envelope)));
          controller.close();
        } catch {
          // The browser went away; nothing to deliver.
        }
      })();
    },
    cancel() {
      clearInterval(beat);
    },
  });
  return new Response(stream, {
    status: 200,
    headers: withProgress
      ? { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store", [STREAM_HEADER]: PROGRESS_STREAM }
      : { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", [STREAM_HEADER]: "1" },
  });
}

/** The client's side: a streamed body unwrapped into the status and JSON a plain response carries. */
export function unwrapStreamed(text: string): { status: number; body: unknown } {
  const parsed = JSON.parse(text) as { status?: unknown; body?: unknown };
  const status = typeof parsed.status === "number" ? parsed.status : 500;
  return { status, body: parsed.body ?? {} };
}

/**
 * The client's side of version 2: reads the body line by line, hands each status to `onProgress`, and returns the
 * envelope from the last line. A line that is not JSON, or not a status or an envelope, is skipped; a body with no
 * envelope is a 502, as an unreadable version 1 body is.
 */
export async function readStreamedLines(response: Response, onProgress?: (status: string) => void): Promise<{ status: number; body: unknown }> {
  let envelope: { status: number; body: unknown } | null = null;
  const take = (line: string) => {
    if (line.trim() === "") return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      return;
    }
    if (!parsed || typeof parsed !== "object") return;
    const record = parsed as { progress?: unknown; status?: unknown; body?: unknown };
    if (typeof record.progress === "string") {
      try {
        onProgress?.(record.progress);
      } catch {
        // A screen update never fails the answer.
      }
    } else if ("status" in record || "body" in record) {
      envelope = { status: typeof record.status === "number" ? record.status : 500, body: record.body ?? {} };
    }
  };
  const reader = response.body?.getReader();
  if (!reader) {
    for (const line of (await response.text()).split("\n")) take(line);
  } else {
    const decoder = new TextDecoder();
    let pending = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      pending += decoder.decode(value, { stream: true });
      const lines = pending.split("\n");
      pending = lines.pop() ?? "";
      for (const line of lines) take(line);
    }
    take(pending + decoder.decode());
  }
  return envelope ?? { status: 502, body: {} };
}
