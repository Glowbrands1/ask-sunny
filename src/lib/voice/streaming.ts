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
 * The usage row is reserved when the token is minted. The browser gets the row's id and the time the server reserved
 * it, signed together for this person, and `finish` accepts only a handle it signed for the same person: nobody can
 * finish, or read the corrected text through, someone else's row, or move the start time.
 *
 * Port of the Leadership Hub (3630a6f), audit 28 Nov 2026: the session is billed by the server's own clock
 * (`billedSessionSeconds`), the time since the row was reserved, capped at the session maximum. The seconds the
 * browser reports are never trusted to lower it, so a client that says "0" cannot slip under the daily caps.
 */

function signature(secret: string, message: string): string {
  return createHmac("sha256", secret).update(message).digest("base64url");
}

const message = (userId: string, usageId: string, startedAtMs: number | null) =>
  startedAtMs === null ? `voice-stream:${userId}:${usageId}` : `voice-stream:${userId}:${usageId}:${startedAtMs}`;

/** `<usage id>.<reserved at, ms since epoch>.<signature>`. */
export function signSessionHandle(secret: string, userId: string, usageId: string, startedAtMs: number): string {
  const at = Math.trunc(startedAtMs);
  return `${usageId}.${at}.${signature(secret, message(userId, usageId, at))}`;
}

export interface SessionHandle {
  readonly usageId: string;
  /** When the server reserved the row; null for a handle signed before start times were recorded. */
  readonly startedAtMs: number | null;
}

/** The usage id (and reservation time) in a handle signed for this person, or null. */
export function readSessionHandle(secret: string, userId: string, handle: string): SessionHandle | null {
  const dot = handle.lastIndexOf(".");
  if (dot <= 0 || !secret) return null;
  const head = handle.slice(0, dot);
  const given = Buffer.from(handle.slice(dot + 1));
  const at = head.lastIndexOf(".");
  const stamped = at > 0 && /^\d{1,15}$/.test(head.slice(at + 1));
  const usageId = stamped ? head.slice(0, at) : head;
  const startedAtMs = stamped ? Number(head.slice(at + 1)) : null;
  const expected = Buffer.from(signature(secret, message(userId, usageId, startedAtMs)));
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  return { usageId, startedAtMs };
}

/**
 * What a session is billed: the server-measured time since the row was reserved, capped at the session maximum (the
 * token caps the socket there). Without a recorded start (a handle from before this was recorded) the server cannot
 * measure it, so the session counts as the full maximum it reserved: never less than the browser could claim.
 */
export function billedSessionSeconds(startedAtMs: number | null, nowMs: number): number {
  if (startedAtMs === null || !Number.isFinite(startedAtMs)) return SESSION_MAX_SECONDS;
  const measured = Math.max(0, (nowMs - startedAtMs) / 1000);
  return Math.round(Math.min(measured, SESSION_MAX_SECONDS) * 100) / 100;
}
