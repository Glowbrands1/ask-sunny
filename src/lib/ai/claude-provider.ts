import { truncate } from "@/lib/utils/format";
import { AiError } from "./errors";
import type { AIProvider, ClientAskRequest, AskResponse } from "./types";
import { STREAM_HEADER, unwrapStreamed } from "@/lib/api/streamed-response";

/**
 * ClaudeProvider — the AIProvider the chat UI uses in live mode.
 *
 * It contains no SDK, no model name and no key. It posts to internal route
 * handlers, which do the retrieval and the Anthropic call server-side. That is
 * what keeps `features/chat/` free of infrastructure: the components still call
 * `provider.ask(...)` and get an AskResponse, exactly as with the mock.
 *
 * `connected` is true because this provider genuinely talks to a live service.
 * If that service is unconfigured, `ask()` throws with the missing variable
 * names — it does not return a seeded answer dressed up as a real one.
 */
export class ClaudeProvider implements AIProvider {
  readonly name = "Claude (Anthropic)";
  readonly connected = true;

  async ask(request: ClientAskRequest): Promise<AskResponse> {
    return post<AskResponse>("/api/chat", request);
  }

  titleForConversation(firstMessage: string): string {
    const cleaned = firstMessage.replace(/\s+/g, " ").trim();
    if (!cleaned) return "New conversation";
    return truncate(cleaned.replace(/[?.!]+$/, ""), 46);
  }
}

async function post<T>(url: string, body: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new AiError(
      "model_failed",
      "Ask Sunny could not be reached. Check your connection and try again.",
      503,
      [],
    );
  }

  /*
   * CHAT_RESPONSE_STREAM_ENABLED: a slow answer arrives as a 200 stream —
   * keep-alive whitespace, then {status, body} — and is read to the end and
   * unwrapped, so the rest of this function sees exactly what a plain
   * response carries. See `api/streamed-response.ts`. A plain response (the
   * flag off, or a fast answer) is read as before.
   */
  let status = response.status;
  let payload: Partial<T> & { error?: string; code?: string; missing?: string[] };
  // Read defensively: a fetch stand-in without `headers` (as several chat
  // screen tests use) is a plain response, exactly as before this flag.
  if (response.headers?.get?.(STREAM_HEADER) === "1") {
    let text: string;
    try {
      text = await response.text();
    } catch {
      throw new AiError("model_failed", "Ask Sunny could not be reached. Check your connection and try again.", 503, []);
    }
    let unwrapped: { status: number; body: unknown };
    try {
      unwrapped = unwrapStreamed(text);
    } catch {
      unwrapped = { status: 502, body: {} };
    }
    status = unwrapped.status;
    payload = (unwrapped.body ?? {}) as typeof payload;
  } else {
    payload = (await response.json().catch(() => ({}))) as typeof payload;
  }

  if (status < 200 || status > 299) {
    throw new AiError(
      (payload.code as AiError["code"]) ?? "model_failed",
      payload.error ?? "Ask Sunny could not answer that right now.",
      status,
      payload.missing ?? [],
    );
  }

  return payload as T;
}
