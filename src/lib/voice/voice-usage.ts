import "server-only";

import { getSupabaseAdmin } from "@/lib/supabase/server";
import { traceInsertWarning } from "@/lib/ai/chat-trace";

import {
  COMPANY_AUDIO_SECONDS_PER_DAY,
  MAX_SECONDS,
  MIN_SECONDS,
  PER_SALON_AUDIO_SECONDS_PER_DAY,
  PER_USER_AUDIO_SECONDS_PER_DAY,
  PER_USER_PER_DAY,
  PER_USER_PER_MINUTE,
  USD_PER_HOUR,
  clampClipSeconds,
  manilaDayStart,
} from "./voice-limits";

/**
 * ============================================================================
 * THE VOICE LIMITS' COUNTERS, AND THE VOICE TRACE ROW (VOICE_INPUT_ENABLED)
 * ============================================================================
 *
 * The counters live in `voice_usage` (supabase/migrations/20261127001000_voice_usage.sql). One RPC,
 * `voice_usage_reserve`, counts and inserts the pending row in one step, before AssemblyAI is called; the row is
 * finished after the call. Every row counts as a request (failed ones too). A pending row is never released, so a
 * crash still counts against the caps; a failed row keeps its clip length unless the provider clearly rejected it
 * (`finishedAudioSeconds`). Any failure
 * to read the counts or write the pending row THROWS, and the route refuses (fails closed).
 *
 * The caps are shared by the four AI chat boxes: one person's minute, day and audio-seconds caps cover all of them.
 */

export type VoiceSurface = "chat" | "overview" | "report" | "l10";

export type VoiceRefusal = "user_minute" | "user_day" | "salon_day" | "company_day";

export type VoiceReservation =
  | { readonly ok: true; readonly id: string }
  | { readonly ok: false; readonly refused: VoiceRefusal; readonly retryAfterSeconds?: number };

export interface VoiceReserveInput {
  readonly userId: string;
  /** The person's salon when their scope is one salon (`scope.primaryAreaId`); null otherwise (no salon cap). */
  readonly salonId: string | null;
  readonly surface: VoiceSurface;
  /** What the browser measured; counted clamped between MIN_SECONDS and MAX_SECONDS until the provider answers. */
  readonly clipSeconds: number;
}

export interface VoiceFinishInput {
  readonly status: "succeeded" | "failed";
  readonly audioSeconds: number | null;
}

export interface VoiceUsageStore {
  /** Throws when the counts cannot be read or the pending row cannot be written. */
  reserve(input: VoiceReserveInput): Promise<VoiceReservation>;
  /** Throws when the row cannot be updated (the caller logs a warning; the pending row still counts). */
  finish(id: string, input: VoiceFinishInput): Promise<void>;
}

/* ── The rule, in TypeScript (the RPC applies the same rule in SQL) ───── */

export interface VoiceUsageRow {
  readonly id: string;
  readonly userId: string;
  readonly salonId: string | null;
  readonly surface: VoiceSurface;
  readonly createdAt: Date;
  status: "pending" | "succeeded" | "failed";
  /** Already clamped. */
  readonly clipSeconds: number;
  audioSeconds: number | null;
}

/**
 * The audio seconds a row counts for. Pending: the clamped clip. Finished: the seconds written at `finish` (the
 * provider's length on success, 0 after a clear rejection), or the clamped clip when none was written (any other
 * failure: the provider may have processed and charged for it).
 */
function counted(row: VoiceUsageRow): number {
  return row.status === "pending" ? row.clipSeconds : (row.audioSeconds ?? row.clipSeconds);
}

/** Provider answers that clearly rejected the clip without transcribing it: its seconds count 0. */
const CLEAR_REJECTIONS = new Set([400, 401, 413, 415]);

/**
 * What to write at `finish` for a call that ended with this provider status and outcome: the provider's length on
 * success; 0 after a clear rejection (HTTP 400, 401, 413, 415); null (counted as the clamped clip) on any other
 * failure (no answer, 429, 5xx, a bad answer).
 */
export function finishedAudioSeconds(input: { readonly processed: boolean; readonly providerStatus: number | null; readonly audioSeconds: number | null; readonly clampedClip: number }): number | null {
  if (input.processed) return input.audioSeconds ?? input.clampedClip;
  if (input.providerStatus !== null && CLEAR_REJECTIONS.has(input.providerStatus)) return 0;
  return null;
}

/** Whether one more clip fits under every cap, given the rows already written. */
export function evaluateVoiceCaps(rows: readonly VoiceUsageRow[], input: VoiceReserveInput, now: Date): VoiceReservation | { ok: true; id: null } {
  /* Every row the person started counts as a request (pending, succeeded and failed): each one was a provider call. */
  const live = rows;
  const clip = clampClipSeconds(input.clipSeconds);
  const minuteAgo = now.getTime() - 60_000;
  const minute = live.filter((row) => row.userId === input.userId && row.createdAt.getTime() > minuteAgo);
  if (minute.length >= PER_USER_PER_MINUTE) {
    const oldest = Math.min(...minute.map((row) => row.createdAt.getTime()));
    return { ok: false, refused: "user_minute", retryAfterSeconds: Math.max(1, Math.ceil((oldest + 60_000 - now.getTime()) / 1000)) };
  }
  const dayStart = manilaDayStart(now).getTime();
  const today = live.filter((row) => row.createdAt.getTime() >= dayStart);
  const mine = today.filter((row) => row.userId === input.userId);
  const mineSeconds = mine.reduce((sum, row) => sum + counted(row), 0);
  if (mine.length >= PER_USER_PER_DAY || mineSeconds + clip > PER_USER_AUDIO_SECONDS_PER_DAY) return { ok: false, refused: "user_day" };
  if (input.salonId !== null) {
    const salonSeconds = today.filter((row) => row.salonId === input.salonId).reduce((sum, row) => sum + counted(row), 0);
    if (salonSeconds + clip > PER_SALON_AUDIO_SECONDS_PER_DAY) return { ok: false, refused: "salon_day" };
  }
  const companySeconds = today.reduce((sum, row) => sum + counted(row), 0);
  if (companySeconds + clip > COMPANY_AUDIO_SECONDS_PER_DAY) return { ok: false, refused: "company_day" };
  return { ok: true, id: null };
}

/**
 * The same rule over rows held in memory, one reservation at a time (as the RPC's advisory lock does). For tests;
 * the route uses the database.
 */
export function memoryVoiceUsageStore(options: { now?: () => Date; failReads?: () => boolean } = {}): VoiceUsageStore & { readonly rows: VoiceUsageRow[] } {
  const rows: VoiceUsageRow[] = [];
  let queue: Promise<unknown> = Promise.resolve();
  let next = 0;
  const now = options.now ?? (() => new Date());
  return {
    rows,
    reserve(input) {
      const run = queue.then(async () => {
        if (options.failReads?.()) throw new Error("voice usage read failed");
        const at = now();
        const decision = evaluateVoiceCaps(rows, input, at);
        if (!decision.ok) return decision;
        next += 1;
        const id = `00000000-0000-4000-8000-${String(next).padStart(12, "0")}`;
        rows.push({ id, userId: input.userId, salonId: input.salonId, surface: input.surface, createdAt: at, status: "pending", clipSeconds: clampClipSeconds(input.clipSeconds), audioSeconds: null });
        return { ok: true as const, id };
      });
      queue = run.catch(() => undefined);
      return run;
    },
    async finish(id, input) {
      const row = rows.find((entry) => entry.id === id);
      if (!row) throw new Error("voice usage row not found");
      row.status = input.status;
      row.audioSeconds = input.audioSeconds;
    },
  };
}

/* ── The database ─────────────────────────────────────────────────────── */

const REFUSALS: readonly VoiceRefusal[] = ["user_minute", "user_day", "salon_day", "company_day"];

export const supabaseVoiceUsageStore: VoiceUsageStore = {
  async reserve(input) {
    const { data, error } = await getSupabaseAdmin().rpc("voice_usage_reserve", {
      p_user_id: input.userId,
      p_salon_id: input.salonId,
      p_surface: input.surface,
      p_clip_seconds: input.clipSeconds,
      p_min_seconds: MIN_SECONDS,
      p_max_seconds: MAX_SECONDS,
      p_per_minute: PER_USER_PER_MINUTE,
      p_per_day: PER_USER_PER_DAY,
      p_user_audio_seconds: PER_USER_AUDIO_SECONDS_PER_DAY,
      p_salon_audio_seconds: PER_SALON_AUDIO_SECONDS_PER_DAY,
      p_company_audio_seconds: COMPANY_AUDIO_SECONDS_PER_DAY,
    });
    if (error) throw new Error(`voice_usage_reserve failed: ${error.code ?? "error"}`);
    const row = (Array.isArray(data) ? data[0] : data) as { usage_id?: unknown; refused?: unknown; retry_after_seconds?: unknown } | null | undefined;
    if (!row) throw new Error("voice_usage_reserve returned no row");
    if (typeof row.refused === "string" && (REFUSALS as readonly string[]).includes(row.refused)) {
      const retry = typeof row.retry_after_seconds === "number" ? row.retry_after_seconds : undefined;
      return { ok: false, refused: row.refused as VoiceRefusal, ...(retry !== undefined ? { retryAfterSeconds: retry } : {}) };
    }
    if (typeof row.usage_id !== "string" || !row.usage_id) throw new Error("voice_usage_reserve returned no id");
    return { ok: true, id: row.usage_id };
  },
  async finish(id, input) {
    const { error } = await getSupabaseAdmin()
      .from("voice_usage")
      .update({ status: input.status, audio_seconds: input.audioSeconds, finished_at: new Date().toISOString() })
      .eq("id", id);
    if (error) throw new Error(`voice_usage update failed: ${error.code ?? "error"}`);
  },
};

/* ── The trace row (`persistSpendRow`'s shape) ────────────────────────── */

export interface VoiceTraceInput {
  readonly id: string;
  readonly userId: string;
  readonly surface: VoiceSurface;
  readonly latencyMs: number;
  readonly succeeded: boolean;
  readonly errorStatus: number | null;
  readonly errorClass: string | null;
  readonly audioSeconds: number | null;
  /** What the spend meter counts: the provider's length, or the clamped clip when it did not say. */
  readonly billedSeconds: number;
  readonly bytes: number;
  readonly mime: string;
  readonly keytermCount: number;
  readonly retried: boolean;
  readonly outcome: string;
}

/** The chat_traces row for one voice transcription. Never audio, never text, never the hints; no e2e_latency_ms. */
export function voiceTraceRow(input: VoiceTraceInput): Record<string, unknown> {
  return {
    id: input.id,
    conversation_id: null,
    message_id: null,
    user_id: input.userId,
    original_query: "[voice] transcription",
    intent: "voice",
    model: null,
    latency_ms: Math.max(0, Math.round(input.latencyMs)),
    succeeded: input.succeeded,
    error_status: input.errorStatus,
    error_class: input.errorClass,
    slots: {
      voice: {
        provider: "assemblyai",
        endpoint: "sync",
        surface: input.surface,
        audio_seconds: input.audioSeconds,
        bytes: input.bytes,
        mime: input.mime,
        keyterm_count: input.keytermCount,
        retried: input.retried,
        outcome: input.outcome,
      },
      spend: [{ source: "voice", audio_seconds: input.billedSeconds, usd_per_hour: USD_PER_HOUR }],
    },
  };
}

export async function writeVoiceTrace(row: Record<string, unknown>): Promise<void> {
  try {
    const inserted = await getSupabaseAdmin().from("chat_traces").insert(row);
    const error = inserted && typeof inserted === "object" && "error" in inserted ? inserted.error : null;
    if (error) throw error;
  } catch (error) {
    console.warn(`voice: ${traceInsertWarning(error)}`);
  }
}
