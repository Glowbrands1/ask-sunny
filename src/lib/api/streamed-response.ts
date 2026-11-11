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

export async function streamWhenSlow(produce: () => Promise<Response>): Promise<Response> {
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
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode("\n"));
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
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", [STREAM_HEADER]: "1" },
  });
}

/** The client's side: a streamed body unwrapped into the status and JSON a plain response carries. */
export function unwrapStreamed(text: string): { status: number; body: unknown } {
  const parsed = JSON.parse(text) as { status?: unknown; body?: unknown };
  const status = typeof parsed.status === "number" ? parsed.status : 500;
  return { status, body: parsed.body ?? {} };
}
