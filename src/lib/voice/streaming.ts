import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import { MAX_SECONDS } from "./voice-limits";

/**
 * ============================================================================
 * LIVE DICTATION: ASSEMBLYAI STREAMING, AUTHORISED BY THE SERVER (VOICE_INPUT_ENABLED)
 * ============================================================================
 *
 * The owner, 27 Nov 2026: "it also has this feature and it transcribes as you talk then when done, press check mark and
 * auto send". The browser streams the microphone straight to AssemblyAI's v3 streaming WebSocket
 * (`wss://streaming.assemblyai.com/v3/ws`), so the words appear as they are said. It never holds the API key: the
 * server mints a short-lived token (`POST https://token.assemblyai.com/v1/token`, `product: "streaming"`), after the
 * same access, pilot-list and usage checks as a recording, and the browser opens the socket with `?token=`.
 *
 * NO NAMES ON THE STREAM. Streaming hints travel in the socket URL the browser opens, and the names list must never
 * reach the browser, so the stream gets none. The names are put right on the server instead, when ✓ is pressed: the
 * final text comes back here (`finish`), is respelled against the person's scoped people and salons
 * (`spoken-names.ts`), and only that corrected text is sent.
 *
 * The token lets the browser open a socket for 60 seconds and caps the session at 60 seconds (AssemblyAI's minimum),
 * the same length as a recording. A session is billed by how long the socket is open, so the browser always ends it.
 */

export const STREAMING_TOKEN_URL = "https://token.assemblyai.com/v1/token";
export const STREAMING_SOCKET_URL = "wss://streaming.assemblyai.com/v3/ws";
export const STREAMING_SPEECH_MODEL = "universal-3-6-pro";
export const STREAMING_SAMPLE_RATE = 16_000;
/** How long the browser has to open the socket with the token. */
export const TOKEN_REDEEM_SECONDS = 60;
/** The longest a session may run; AssemblyAI's minimum, and the recording's own limit. */
export const SESSION_MAX_SECONDS = Math.max(60, MAX_SECONDS);

export interface StreamingTokenDeps {
  readonly fetch: typeof fetch;
  readonly apiKey: string;
}

export type StreamingTokenResult = { readonly ok: true; readonly token: string } | { readonly ok: false; readonly status: number | null };

/** A short-lived streaming token, or why there is none. Never logs the key or the token. */
export async function mintStreamingToken(deps: StreamingTokenDeps): Promise<StreamingTokenResult> {
  let response: Response;
  try {
    response = await deps.fetch(STREAMING_TOKEN_URL, {
      method: "POST",
      headers: { Authorization: deps.apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ product: "streaming", expires_in_seconds: TOKEN_REDEEM_SECONDS, max_session_duration_seconds: SESSION_MAX_SECONDS }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return { ok: false, status: null };
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    return { ok: false, status: response.status };
  }
  const body = (await response.json().catch(() => null)) as { token?: unknown } | null;
  return typeof body?.token === "string" && body.token ? { ok: true, token: body.token } : { ok: false, status: response.status };
}

/** The socket URL the browser opens: the token, 16 kHz 16-bit PCM, the same model as a recording. No hints. */
export function streamingSocketUrl(token: string): string {
  const query = new URLSearchParams({
    token,
    sample_rate: String(STREAMING_SAMPLE_RATE),
    encoding: "pcm_s16le",
    speech_model: STREAMING_SPEECH_MODEL,
  });
  return `${STREAMING_SOCKET_URL}?${query.toString()}`;
}

/*
 * ============================================================================
 * THE SESSION HANDLE
 * ============================================================================
 *
 * The usage row is reserved when the token is minted. The browser gets the row's id signed for this person, and
 * `finish` accepts only a handle it signed for the same person: nobody can finish, or read the corrected text through,
 * someone else's row.
 */

function signature(secret: string, userId: string, usageId: string): string {
  return createHmac("sha256", secret).update(`voice-stream:${userId}:${usageId}`).digest("base64url");
}

export function signSessionHandle(secret: string, userId: string, usageId: string): string {
  return `${usageId}.${signature(secret, userId, usageId)}`;
}

/** The usage id in a handle signed for this person, or null. */
export function readSessionHandle(secret: string, userId: string, handle: string): string | null {
  const dot = handle.lastIndexOf(".");
  if (dot <= 0 || !secret) return null;
  const usageId = handle.slice(0, dot);
  const given = Buffer.from(handle.slice(dot + 1));
  const expected = Buffer.from(signature(secret, userId, usageId));
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  return usageId;
}

/** The seconds the browser reports for a session, bounded to what a session can last. */
export function sessionSeconds(reported: number): number {
  if (!Number.isFinite(reported) || reported < 0) return SESSION_MAX_SECONDS;
  return Math.min(reported, SESSION_MAX_SECONDS + 60);
}
