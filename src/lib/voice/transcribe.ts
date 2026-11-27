import "server-only";

import { z } from "zod";

import { PROVIDER_TIMEOUT_MS, RETRY_MAX_WAIT_MS, RETRY_MIN_REMAINING_MS } from "./voice-limits";

/**
 * ============================================================================
 * ASSEMBLYAI SYNC, CALLED WITH PLAIN FETCH (VOICE_INPUT_ENABLED)
 * ============================================================================
 *
 * The one place the app talks to AssemblyAI: `POST https://sync.assemblyai.com/v1/transcribe`, model
 * `universal-3-6-pro` (the `X-AAI-Model` header), multipart parts `audio` and `config`. No SDK. Not the Dictation API.
 *
 * The provider's text comes back as it is: nothing here cleans up, rewords or corrects it. Nothing here logs the
 * audio, the transcript, the hints or the prompt; the route logs codes and counts only.
 *
 * One retry, for 429, 500, 503 and 504 only, and only when the wait is short and enough of the route's time is left.
 * 400, 401, 413 and 415 are never retried: the same request would get the same answer.
 */

export const ASSEMBLYAI_SYNC_URL = "https://sync.assemblyai.com/v1/transcribe";
export const ASSEMBLYAI_MODEL = "universal-3-6-pro";

/** The containers the route accepts, as AssemblyAI names them. */
export type VoiceMime = "audio/webm" | "audio/mp4" | "audio/ogg" | "audio/wav";

export interface TranscribeInput {
  readonly audio: Uint8Array;
  readonly mime: VoiceMime;
  /** Spelling hints built on the server (`keyterms.ts`); never from the browser. */
  readonly keyterms: readonly string[];
  readonly prompt: string;
  /** Recent turns of the person's own conversation, oldest first; none for the L10 assistant. */
  readonly conversationContext?: readonly string[];
}

export interface TranscribeDeps {
  readonly fetch: typeof fetch;
  readonly apiKey: string;
  /** Epoch ms by which the route must have answered; a retry is tried only with RETRY_MIN_REMAINING_MS left. */
  readonly deadline: number;
  readonly now?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
}

export type TranscribeOutcome =
  | "ok"
  | "empty"
  | "bad_audio"
  | "too_long"
  | "busy"
  | "timeout"
  | "unauthorized"
  | "unavailable";

export interface TranscribeResult {
  /** The provider's text as it is (empty for every outcome but "ok"). */
  readonly text: string;
  /** How long the provider says the audio was, or null when it did not say. */
  readonly audioSeconds: number | null;
  /** `response.status` of the last attempt; null when no answer came back (timeout, network). */
  readonly status: number | null;
  /** The provider's problem-details `title`, snake-cased; "timeout" / "network" without an answer; null on success. */
  readonly errorClass: string | null;
  readonly retried: boolean;
  readonly outcome: TranscribeOutcome;
  /** The provider's Retry-After on a 429 or 503, in seconds. */
  readonly retryAfterSeconds?: number;
}

const SyncTranscript = z.object({
  text: z.string(),
  audio_duration_ms: z.number().nonnegative().optional().nullable(),
});

const ProblemDetails = z.object({ title: z.string().optional() }).passthrough();

const RETRYABLE = new Set([429, 500, 503, 504]);

export function snakeCase(title: string): string {
  return title
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
}

function retryAfterMs(response: Response): number | null {
  const header = response.headers.get("retry-after");
  if (header === null) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(header);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null;
}

function outcomeForStatus(status: number): TranscribeOutcome {
  if (status === 400 || status === 415) return "bad_audio";
  if (status === 413) return "too_long";
  if (status === 401 || status === 403) return "unauthorized";
  if (status === 429 || status === 503) return "busy";
  if (status === 504) return "timeout";
  return "unavailable";
}

function isTimeout(error: unknown): boolean {
  return error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
}

function body(input: TranscribeInput): FormData {
  const config: Record<string, unknown> = {
    keyterms_prompt: [...input.keyterms],
    prompt: input.prompt,
    language_codes: ["en"],
  };
  if (input.conversationContext && input.conversationContext.length > 0) {
    config.conversation_context = [...input.conversationContext];
  }
  const form = new FormData();
  const extension = input.mime.split("/")[1];
  form.append("audio", new Blob([new Uint8Array(input.audio)], { type: input.mime }), `clip.${extension}`);
  form.append("config", new Blob([JSON.stringify(config)], { type: "application/json" }));
  return form;
}

export async function transcribeVoice(input: TranscribeInput, deps: TranscribeDeps): Promise<TranscribeResult> {
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  let retried = false;

  for (let attempt = 0; ; attempt += 1) {
    const remaining = deps.deadline - now();
    const timeout = Math.max(1, Math.min(PROVIDER_TIMEOUT_MS, remaining));
    let response: Response;
    try {
      response = await deps.fetch(ASSEMBLYAI_SYNC_URL, {
        method: "POST",
        headers: { Authorization: deps.apiKey, "X-AAI-Model": ASSEMBLYAI_MODEL },
        body: body(input),
        signal: AbortSignal.timeout(timeout),
      });
    } catch (error) {
      const timedOut = isTimeout(error);
      return {
        text: "",
        audioSeconds: null,
        status: null,
        errorClass: timedOut ? "timeout" : "network",
        retried,
        outcome: timedOut ? "timeout" : "unavailable",
      };
    }

    const status = response.status;
    if (response.ok) {
      const parsed = SyncTranscript.safeParse(await response.json().catch(() => null));
      if (!parsed.success) {
        return { text: "", audioSeconds: null, status, errorClass: "invalid_response", retried, outcome: "unavailable" };
      }
      const ms = parsed.data.audio_duration_ms;
      const audioSeconds = typeof ms === "number" ? ms / 1000 : null;
      const text = parsed.data.text;
      return { text, audioSeconds, status, errorClass: null, retried, outcome: text.trim() ? "ok" : "empty" };
    }

    const wait = retryAfterMs(response);
    if (attempt === 0 && RETRYABLE.has(status)) {
      const delay = wait ?? 250;
      if (delay <= RETRY_MAX_WAIT_MS && deps.deadline - now() - delay >= RETRY_MIN_REMAINING_MS) {
        await response.body?.cancel().catch(() => undefined);
        await sleep(delay);
        retried = true;
        continue;
      }
    }

    const problem = ProblemDetails.safeParse(await response.json().catch(() => null));
    const title = problem.success ? problem.data.title : undefined;
    const outcome = outcomeForStatus(status);
    return {
      text: "",
      audioSeconds: null,
      status,
      errorClass: title ? snakeCase(title) || `http_${status}` : `http_${status}`,
      retried,
      outcome,
      ...(outcome === "busy" && wait !== null ? { retryAfterSeconds: Math.max(1, Math.ceil(wait / 1000)) } : {}),
    };
  }
}
