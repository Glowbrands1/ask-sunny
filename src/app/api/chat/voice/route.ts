import { z } from "zod";

import { modelSpendGuard } from "@/lib/ai/spend-guard";
import { noteSpendUser } from "@/lib/ai/spend-meter";
import { withSpendMeter } from "@/lib/ai/spend-meter-run";
import { assertWithinRateLimit } from "@/lib/api/respond";
import { AiError } from "@/lib/ai/errors";
import { isClientConversationId } from "@/lib/chat/client-ids";
import { isSameOriginRequest } from "@/lib/reviews/gbp/csrf";
import { isMeetingKey } from "@/features/l10/lib/config";
import { VOICE_MESSAGES, tryAgainIn, type VoiceErrorCode } from "@/lib/voice/voice-messages";
import { voiceRouteDeps } from "@/lib/voice/voice-route-deps";
import { checkVoiceCaller } from "@/lib/voice/voice-caller";
import { transcribeVoice, type TranscribeOutcome } from "@/lib/voice/transcribe";
import { correctSpokenNames } from "@/lib/voice/spoken-names";
import { VoiceUploadError, declaredAudioType, openVoiceUpload, sniffAudio, type VoiceUpload } from "@/lib/voice/voice-upload";
import { finishedAudioSeconds, voiceTraceRow, type VoiceRefusal, type VoiceSurface } from "@/lib/voice/voice-usage";
import { MAX_BYTES, MAX_SECONDS, MIN_BYTES, MIN_SECONDS, ROUTE_MAX_SECONDS, clampClipSeconds, secondsUntilNextVoiceDay } from "@/lib/voice/voice-limits";
import type { AccessScope, Role } from "@/types";

/**
 * ============================================================================
 * POST /api/chat/voice — ONE ROUTE FOR THE FOUR AI CHAT BOXES (VOICE_INPUT_ENABLED)
 * ============================================================================
 *
 * A recording in, the provider's text out, for the person to check and edit in the box it came from. Voice only
 * fills a text box: nothing here asks the AI anything, and nothing is stored but counts (no audio, no text).
 *
 * The body is multipart: `surface` ("chat", "overview", "report" or "l10"), `clipSeconds` (what the browser
 * measured), `conversationId` (boxes A-C, optional) or `meetingKey` (box D), then `audio` last. In order:
 *
 *   a. same origin (403);
 *   b. the access of the box that called, checked again here; the browser's word is never trusted:
 *        "chat", "overview", "report": `authorizeRequest(request, "ask_questions")`, as /api/chat does;
 *        "l10": a verified viewer (`l10Viewer()`) and a meeting the Hub lists for them (`listMyMeetings()`), else 404;
 *   c. voice on for this verified email (`voiceInputEnabledFor`), else the same 404 as an unknown route;
 *   d. the in-memory first guard, then `modelSpendGuard` (the monthly budget sentence chat shows);
 *   e. the audio, read as a stream and cut off at MAX_BYTES, checked by type and by its first bytes;
 *   f. the usage counters (a pending row before AssemblyAI is called), the hints, AssemblyAI, the trace row.
 *
 * Only the small text fields ahead of the audio (16 KB at most) are read before step b, because they say which box
 * is asking; the audio itself is read only after every check has passed.
 *
 * Logs carry codes and counts only: never the transcript, a name, an email, the hints or the audio.
 */

export const runtime = "nodejs";
export const maxDuration = 45;
export const dynamic = "force-dynamic";

const Fields = z
  .object({
    surface: z.enum(["chat", "overview", "report", "l10"]),
    clipSeconds: z
      .string()
      .regex(/^\d{1,4}(\.\d{1,3})?$/)
      .transform(Number),
    conversationId: z
      .string()
      .refine((value) => isClientConversationId(value))
      .optional(),
    meetingKey: z
      .string()
      .refine((value) => isMeetingKey(value))
      .optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.surface === "l10") {
      if (!value.meetingKey) context.addIssue({ code: z.ZodIssueCode.custom, message: "meetingKey" });
      if (value.conversationId) context.addIssue({ code: z.ZodIssueCode.custom, message: "conversationId" });
    } else if (value.meetingKey) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "meetingKey" });
    }
  });

interface Caller {
  readonly userId: string;
  readonly email: string;
  readonly role: Role;
  readonly scope: AccessScope;
}

function answer(status: number, body: Record<string, unknown>, retryAfterSeconds?: number): Response {
  const headers: Record<string, string> = { "Cache-Control": "no-store" };
  if (retryAfterSeconds !== undefined) headers["Retry-After"] = String(Math.max(1, Math.ceil(retryAfterSeconds)));
  return Response.json(body, { status, headers });
}

function refuse(status: number, code: VoiceErrorCode, error: string, retryAfterSeconds?: number): Response {
  return answer(status, { error, code, ...(retryAfterSeconds !== undefined ? { retryAfterSeconds: Math.max(1, Math.ceil(retryAfterSeconds)) } : {}) }, retryAfterSeconds);
}

/** The same answer as a route that does not exist, so nobody learns voice is here. */
const notFound = () => refuse(404, "not_found", "Not found.");


function refusalFor(refused: VoiceRefusal, retryAfterSeconds: number | undefined, now: Date): Response {
  if (refused === "user_minute") {
    const wait = retryAfterSeconds ?? 60;
    return refuse(429, "user_minute", tryAgainIn(wait), wait);
  }
  const untilTomorrow = secondsUntilNextVoiceDay(now);
  if (refused === "user_day") return refuse(429, "user_day", VOICE_MESSAGES.userDay, untilTomorrow);
  if (refused === "salon_day") return refuse(429, "salon_day", VOICE_MESSAGES.salonDay, untilTomorrow);
  return refuse(429, "company_day", VOICE_MESSAGES.companyDay, untilTomorrow);
}

function outcomeAnswer(outcome: TranscribeOutcome, retryAfterSeconds: number | undefined, providerStatus: number | null): Response {
  switch (outcome) {
    case "empty":
      return refuse(422, "nothing_heard", VOICE_MESSAGES.nothingHeard);
    case "bad_audio":
      return refuse(providerStatus === 415 ? 415 : 400, "bad_audio", VOICE_MESSAGES.badAudio);
    case "too_long":
      return refuse(413, "too_long", VOICE_MESSAGES.tooLong);
    case "busy":
      return refuse(providerStatus === 503 ? 503 : 429, "busy", VOICE_MESSAGES.busy, retryAfterSeconds ?? 5);
    case "timeout":
      return refuse(504, "timeout", VOICE_MESSAGES.timeout);
    default:
      return refuse(503, "unavailable", VOICE_MESSAGES.unavailable);
  }
}

export async function POST(request: Request): Promise<Response> {
  return withSpendMeter("voice", async () => {
    try {
      return await handle(request);
    } catch (error) {
      /* Never a blank body: anything unexpected is "not available", and the log says where, never what was said. */
      console.error(`voice: unexpected ${error instanceof Error ? error.name : "error"}`);
      return refuse(503, "unavailable", VOICE_MESSAGES.unavailable);
    }
  });
}

async function handle(request: Request): Promise<Response> {
  const started = Date.now();
  /* The route's own time limit, less a margin to answer in. */
  const deadline = started + ROUTE_MAX_SECONDS * 1000 - 2_000;

  /* a. Same origin. */
  if (!isSameOriginRequest(request)) return refuse(403, "forbidden", "This request must come from the app itself.");

  /* The small fields ahead of the audio: which box is asking. */
  let upload: VoiceUpload;
  try {
    upload = await openVoiceUpload(request);
  } catch (error) {
    if (error instanceof VoiceUploadError) return refuse(400, "bad_request", VOICE_MESSAGES.badAudio);
    throw error;
  }
  const parsed = Fields.safeParse(upload.fields);
  if (!parsed.success) {
    await upload.cancel();
    return refuse(400, "bad_request", VOICE_MESSAGES.badAudio);
  }
  const fields = parsed.data;
  const surface: VoiceSurface = fields.surface;

  /* b, c. The box's own access, checked again, then voice on for that verified email (`voice-caller.ts`). */
  const check = await checkVoiceCaller(request, surface, fields.meetingKey);
  if (!check.ok) {
    await upload.cancel();
    return check.status === 404 ? notFound() : refuse(check.status, check.code, check.message);
  }
  const caller: Caller = check.caller;

  /* d. The cheap first guard, then the monthly budget (and the daily cap where it is on), as chat. */
  try {
    assertWithinRateLimit(request, "voice");
  } catch (error) {
    await upload.cancel();
    if (error instanceof AiError && error.status === 429) {
      const wait = error.retryAfterSeconds ?? 60;
      return refuse(429, "user_minute", tryAgainIn(wait), wait);
    }
    throw error;
  }
  noteSpendUser(caller.userId);
  const capped = await modelSpendGuard({ userId: caller.userId, role: caller.role });
  if (capped) {
    await upload.cancel();
    return refuse(429, "monthly_budget", capped.content, 3600);
  }

  /* e. The audio: streamed, cut off at MAX_BYTES, checked by type and first bytes. */
  if (fields.clipSeconds > MAX_SECONDS + 2) {
    await upload.cancel();
    return refuse(413, "too_long", VOICE_MESSAGES.tooLong);
  }
  const declaredLength = Number(request.headers.get("content-length") ?? "");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BYTES + 64 * 1024) {
    await upload.cancel();
    return refuse(413, "too_long", VOICE_MESSAGES.tooLong);
  }
  let audio: { bytes: Uint8Array; contentType: string | null };
  try {
    audio = await upload.readAudio(MAX_BYTES);
  } catch (error) {
    if (error instanceof VoiceUploadError) {
      return error.code === "too_large" ? refuse(413, "too_long", VOICE_MESSAGES.tooLong) : refuse(400, "bad_audio", VOICE_MESSAGES.badAudio);
    }
    throw error;
  }
  if (fields.clipSeconds < MIN_SECONDS || audio.bytes.length < MIN_BYTES) {
    return refuse(422, "nothing_heard", VOICE_MESSAGES.nothingHeard);
  }
  const declared = declaredAudioType(audio.contentType);
  const sniffed = sniffAudio(audio.bytes);
  if (!declared || !sniffed || declared !== sniffed) return refuse(415, "bad_audio", VOICE_MESSAGES.badAudio);

  /* f. The counters first: a pending row before AssemblyAI is called, or no call at all (fail closed). */
  const deps = voiceRouteDeps;
  const salonId = caller.scope.level === "salon" ? caller.scope.primaryAreaId : null;
  const now = new Date();
  let reservation;
  try {
    reservation = await deps.store.reserve({ userId: caller.userId, salonId, surface, clipSeconds: fields.clipSeconds });
  } catch {
    console.warn(`voice: ${surface} usage_unavailable`);
    return refuse(503, "unavailable", VOICE_MESSAGES.unavailable);
  }
  if (!reservation.ok) {
    console.info(`voice: ${surface} refused ${reservation.refused}`);
    return refusalFor(reservation.refused, reservation.retryAfterSeconds, now);
  }
  const usageId = reservation.id;

  const hints =
    surface === "l10"
      ? await deps.l10Hints({ meetingKey: fields.meetingKey!, scope: caller.scope }).catch(() => ({ keyterms: [] as string[], prompt: "" }))
      : await deps.chatHints({ actor: { userId: caller.userId, role: caller.role, scope: caller.scope }, conversationId: fields.conversationId ?? null }).catch(() => ({ keyterms: [] as string[], prompt: "" }));

  const result = await transcribeVoice(
    {
      audio: audio.bytes,
      mime: sniffed,
      keyterms: hints.keyterms,
      prompt: hints.prompt,
      ...("conversationContext" in hints && hints.conversationContext ? { conversationContext: hints.conversationContext } : {}),
    },
    { fetch: deps.fetch, apiKey: (process.env.ASSEMBLYAI_API_KEY ?? "").trim(), deadline },
  );
  const bytes = audio.bytes.length;
  /* The recording is dropped here: nothing below holds it. */
  audio = { bytes: new Uint8Array(0), contentType: null };

  const processed = result.outcome === "ok" || result.outcome === "empty";
  const clamped = clampClipSeconds(fields.clipSeconds);
  /* The provider's length on success; 0 only after a clear rejection (400, 401, 413, 415); otherwise the clip counts. */
  const finishedSeconds = finishedAudioSeconds({ processed, providerStatus: result.status, audioSeconds: result.audioSeconds, clampedClip: clamped });
  try {
    await deps.store.finish(usageId, { status: processed ? "succeeded" : "failed", audioSeconds: finishedSeconds });
  } catch {
    console.warn(`voice: ${surface} usage_update_failed`);
  }

  await deps.writeTrace(
    voiceTraceRow({
      id: usageId,
      userId: caller.userId,
      surface,
      latencyMs: Date.now() - started,
      succeeded: result.outcome === "ok",
      errorStatus: result.outcome === "ok" ? null : result.status,
      errorClass: result.errorClass ?? (result.outcome === "empty" ? "empty_transcript" : null),
      audioSeconds: result.audioSeconds,
      billedSeconds: finishedSeconds ?? clamped,
      bytes,
      mime: sniffed,
      keytermCount: hints.keyterms.length,
      retried: result.retried,
      outcome: result.outcome,
    }),
  );

  if (result.outcome === "unauthorized") console.error(`voice: ${surface} provider_rejected_key status=${result.status}`);
  else if (result.outcome === "unavailable") console.error(`voice: ${surface} provider_unavailable status=${result.status ?? "none"} class=${result.errorClass ?? "none"}`);
  console.info(
    `voice: ${surface} ${result.outcome} status=${result.status ?? "none"} bytes=${bytes} audio_seconds=${result.audioSeconds ?? "none"} keyterms=${hints.keyterms.length} retried=${result.retried} ms=${Date.now() - started}`,
  );

  if (result.outcome !== "ok") return outcomeAnswer(result.outcome, result.retryAfterSeconds, result.status);
  /*
   * Names spelled as the directory spells them (the owner, 27 Nov 2026: "i said Curt, it spelled it as Kurt"): a heard
   * word that sounds like exactly one scoped person's or salon's spelling is written that way. The list stays here; the
   * text still goes into the box for the person to read and edit before sending.
   */
  const text = "vocabulary" in hints && hints.vocabulary ? correctSpokenNames(result.text, hints.vocabulary) : result.text;
  return answer(200, { text, traceId: usageId });
}
