import { truncate } from "@/lib/utils/format";
import { AiError } from "./errors";
import type {
  AIProvider,
  AskRequest,
  AskResponse,
  FormDraftRequest,
  FormDraftResponse,
} from "./types";

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

  async ask(request: AskRequest): Promise<AskResponse> {
    return post<AskResponse>("/api/chat", request);
  }

  async draftForm(request: FormDraftRequest): Promise<FormDraftResponse> {
    return post<FormDraftResponse>("/api/forms/draft", request);
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

  const payload = (await response.json().catch(() => ({}))) as Partial<T> & {
    error?: string;
    code?: string;
    missing?: string[];
  };

  if (!response.ok) {
    throw new AiError(
      (payload.code as AiError["code"]) ?? "model_failed",
      payload.error ?? "Ask Sunny could not answer that right now.",
      response.status,
      payload.missing ?? [],
    );
  }

  return payload as T;
}
