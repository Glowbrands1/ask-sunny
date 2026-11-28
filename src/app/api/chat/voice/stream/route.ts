import { z } from "zod";

import { modelSpendGuard } from "@/lib/ai/spend-guard";
import { noteSpendUser } from "@/lib/ai/spend-meter";
import { assertWithinRateLimit } from "@/lib/api/respond";
import { AiError } from "@/lib/ai/errors";
import { isClientConversationId } from "@/lib/chat/client-ids";
import { isSameOriginRequest } from "@/lib/reviews/gbp/csrf";
import { isMeetingKey } from "@/features/l10/lib/config";
import { correctSpokenNames } from "@/lib/voice/spoken-names";
import { billedSessionSeconds, readSessionHandle, signSessionHandle, streamingSocketUrl, SESSION_MAX_SECONDS } from "@/lib/voice/streaming";
import { checkVoiceCaller } from "@/lib/voice/voice-caller";
import { VOICE_MESSAGES, tryAgainIn, type VoiceErrorCode } from "@/lib/voice/voice-messages";
import { voiceRouteDeps } from "@/lib/voice/voice-route-deps";
import { voiceTraceRow, type VoiceSurface } from "@/lib/voice/voice-usage";
import { secondsUntilNextVoiceDay } from "@/lib/voice/voice-limits";

/**
 * ============================================================================
 * POST /api/chat/voice/stream — LIVE DICTATION (VOICE_INPUT_ENABLED)
 * ============================================================================
 *
 * The owner, 27 Nov 2026: "it transcribes as you talk then when done, press check mark and auto send". Two steps,
 * both JSON, both checked like a recording (same origin; the box's own access and the pilot list, `voice-caller.ts`;
 * the first guard and the monthly budget; the usage caps):
 *
 *   "start"   reserves a usage row for a full session and mints a short-lived AssemblyAI streaming token. Answers the
 *             socket URL (token, audio format; never the API key, never any names) and a session handle signed for
 *             this person. Any failure answers an error the browser treats as "use the recording instead".
 *   "finish"  the browser's final text and how long the socket was open. The row is finished with those seconds and
 *             the trace row written (`endpoint: "streaming"`). For ✓ ("send") the text is respelled against the
 *             person's scoped people and salons (`spoken-names.ts`) and the corrected text is answered; for ✕
 *             ("discard") nothing is answered but the trace id. Only a handle signed for this person is accepted.
 *
 * Logs carry codes and counts only: never the text, a name, an email, the token or the handle.
 */

export const runtime = "nodejs";
export const maxDuration = 20;
export const dynamic = "force-dynamic";

const MAX_TEXT = 5_000;

const Where = {
  surface: z.enum(["chat", "overview", "report", "l10"]),
  conversationId: z
    .string()
    .refine((value) => isClientConversationId(value))
    .optional(),
  meetingKey: z
    .string()
    .refine((value) => isMeetingKey(value))
    .optional(),
};

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("start"), ...Where }).strict(),
  z
    .object({
      action: z.literal("finish"),
      ...Where,
      session: z.string().min(10).max(200),
      outcome: z.enum(["send", "discard"]),
      text: z.string().max(MAX_TEXT),
      seconds: z.number().min(0).max(10_000),
    })
    .strict(),
]);

function answer(status: number, body: Record<string, unknown>, retryAfterSeconds?: number): Response {
  const headers: Record<string, string> = { "Cache-Control": "no-store" };
  if (retryAfterSeconds !== undefined) headers["Retry-After"] = String(Math.max(1, Math.ceil(retryAfterSeconds)));
  return Response.json(body, { status, headers });
}

function refuse(status: number, code: VoiceErrorCode | "stream_unavailable", error: string, retryAfterSeconds?: number): Response {
  return answer(status, { error, code, ...(retryAfterSeconds !== undefined ? { retryAfterSeconds: Math.max(1, Math.ceil(retryAfterSeconds)) } : {}) }, retryAfterSeconds);
}


function apiKey(): string {
  return (process.env.ASSEMBLYAI_API_KEY ?? "").trim();
}

export async function POST(request: Request): Promise<Response> {
  try {
    return await handle(request);
  } catch (error) {
    console.error(`voice-stream: unexpected ${error instanceof Error ? error.name : "error"}`);
    return refuse(503, "stream_unavailable", VOICE_MESSAGES.unavailable);
  }
}

async function handle(request: Request): Promise<Response> {
  if (!isSameOriginRequest(request)) return refuse(403, "forbidden", "This request must come from the app itself.");
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return refuse(400, "bad_request", VOICE_MESSAGES.unavailable);
  const body = parsed.data;
  const surface: VoiceSurface = body.surface;
  if ((surface === "l10") !== Boolean(body.meetingKey) || (surface === "l10" && body.conversationId)) {
    return refuse(400, "bad_request", VOICE_MESSAGES.unavailable);
  }

  const check = await checkVoiceCaller(request, surface, body.meetingKey);
  if (!check.ok) return check.status === 404 ? refuse(404, "not_found", "Not found.") : refuse(check.status, check.code, check.message);
  const caller = check.caller;
  const deps = voiceRouteDeps;

  if (body.action === "finish") {
    const handle = readSessionHandle(apiKey(), caller.userId, body.session);
    if (!handle) return refuse(404, "not_found", "Not found.");
    const usageId = handle.usageId;
    // Billed by the server's clock since the row was reserved; body.seconds is the browser's count, never trusted.
    const seconds = billedSessionSeconds(handle.startedAtMs, Date.now());
    try {
      await deps.store.finish(usageId, { status: "succeeded", audioSeconds: seconds });
    } catch {
      console.warn(`voice-stream: ${surface} usage_update_failed`);
    }
    let text = "";
    let keyterms = 0;
    if (body.outcome === "send" && body.text.trim()) {
      const hints =
        surface === "l10"
          ? await deps.l10Hints({ meetingKey: body.meetingKey!, scope: caller.scope }).catch(() => null)
          : await deps.chatHints({ actor: { userId: caller.userId, role: caller.role, scope: caller.scope }, conversationId: body.conversationId ?? null }).catch(() => null);
      keyterms = hints?.vocabulary?.entries.length ?? 0;
      text = hints?.vocabulary ? correctSpokenNames(body.text, hints.vocabulary) : body.text;
    }
    await deps.writeTrace(
      voiceTraceRow({
        id: usageId,
        userId: caller.userId,
        surface,
        latencyMs: 0,
        succeeded: body.outcome === "send" && Boolean(text.trim()),
        errorStatus: null,
        errorClass: body.outcome === "discard" ? "discarded" : text.trim() ? null : "empty_transcript",
        audioSeconds: seconds,
        billedSeconds: seconds,
        bytes: 0,
        mime: "audio/pcm",
        keytermCount: keyterms,
        retried: false,
        outcome: body.outcome === "discard" ? "discarded" : text.trim() ? "ok" : "empty",
        endpoint: "streaming",
      }),
    );
    console.info(`voice-stream: ${surface} finish ${body.outcome} seconds=${Math.round(seconds)}`);
    if (body.outcome === "discard") return answer(200, { traceId: usageId });
    if (!text.trim()) return refuse(422, "nothing_heard", VOICE_MESSAGES.nothingHeard);
    return answer(200, { text, traceId: usageId });
  }

  /* start: the same first guard and monthly budget as a recording. */
  try {
    assertWithinRateLimit(request, "voice");
  } catch (error) {
    if (error instanceof AiError && error.status === 429) {
      const wait = error.retryAfterSeconds ?? 60;
      return refuse(429, "user_minute", tryAgainIn(wait), wait);
    }
    throw error;
  }
  noteSpendUser(caller.userId);
  const capped = await modelSpendGuard({ userId: caller.userId, role: caller.role });
  if (capped) return refuse(429, "monthly_budget", capped.content, 3600);

  const salonId = caller.scope.level === "salon" ? caller.scope.primaryAreaId : null;
  const now = new Date();
  // When the row is reserved (taken just before, so never later than the database's own time): "finish" bills the time
  // since then, signed into the handle so it cannot be moved.
  const reservedAt = Date.now();
  let reservation;
  try {
    reservation = await deps.store.reserve({ userId: caller.userId, salonId, surface, clipSeconds: SESSION_MAX_SECONDS });
  } catch {
    console.warn(`voice-stream: ${surface} usage_unavailable`);
    return refuse(503, "unavailable", VOICE_MESSAGES.unavailable);
  }
  if (!reservation.ok) {
    console.info(`voice-stream: ${surface} refused ${reservation.refused}`);
    if (reservation.refused === "user_minute") {
      const wait = reservation.retryAfterSeconds ?? 60;
      return refuse(429, "user_minute", tryAgainIn(wait), wait);
    }
    const message = reservation.refused === "user_day" ? VOICE_MESSAGES.userDay : reservation.refused === "salon_day" ? VOICE_MESSAGES.salonDay : VOICE_MESSAGES.companyDay;
    return refuse(429, reservation.refused, message, secondsUntilNextVoiceDay(now));
  }

  const minted = await deps.streamingToken({ fetch: deps.fetch, apiKey: apiKey() });
  if (!minted.ok) {
    try {
      await deps.store.finish(reservation.id, { status: "failed", audioSeconds: 0 });
    } catch {
      console.warn(`voice-stream: ${surface} usage_update_failed`);
    }
    console.warn(`voice-stream: ${surface} token_failed status=${minted.status ?? "none"}`);
    return refuse(503, "stream_unavailable", VOICE_MESSAGES.unavailable);
  }
  console.info(`voice-stream: ${surface} started`);
  return answer(200, {
    socketUrl: streamingSocketUrl(minted.token),
    session: signSessionHandle(apiKey(), caller.userId, reservation.id, reservedAt),
    maxSeconds: SESSION_MAX_SECONDS,
  });
}
