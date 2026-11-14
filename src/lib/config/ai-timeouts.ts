/**
 * ============================================================================
 * EVERY AI CALL'S TIME LIMIT, IN ONE PLACE
 * ============================================================================
 *
 * QA, 14 Nov 2026. Only the main chat answer had a limit, and only with
 * MODEL_RETRY_ENABLED on (off in production): every other call ran on the
 * SDK's 10-minute default, bounded only by the route's maxDuration (120 s on
 * chat and drafting), so a stalled call ended in the platform's own error
 * instead of a reply. Each limit here is the call's WHOLE time, retries
 * included (`lib/ai/time-limit.ts`), so a retry can never push a call past it.
 *
 *   main answer     45 s   AI_MAIN_TIMEOUT_MS     (5,000 to 110,000)
 *   helper calls    30 s   AI_HELPER_TIMEOUT_MS   (1,000 to 60,000)
 *   AI reader       3.5 s  AI_READER_TIMEOUT_MS   (500 to 10,000; unchanged)
 *   form patch      5 s    FORM_PATCH_TIMEOUT_MS  (1,000 to 10,000; unchanged)
 *
 * The reader and the form patch already had tighter limits with a fallback to
 * today's readers; those values are unchanged, only moved here. A value
 * outside its range, or not a number, is the default.
 */

export const AI_MAIN_TIMEOUT_DEFAULT_MS = 45_000;
export const AI_HELPER_TIMEOUT_DEFAULT_MS = 30_000;
export const AI_READER_TIMEOUT_DEFAULT_MS = 3_500;
export const FORM_PATCH_TIMEOUT_DEFAULT_MS = 5_000;

/**
 * The SDK's own retry count for a timed call. The SDK default is 2; it is
 * kept, because the time limit above covers the retries too.
 */
export const AI_MAX_RETRIES = 2;

function fromEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < min || value > max) return fallback;
  return value;
}

/** The main chat answer (`callClaude`), and the L10 assistant's step. */
export function mainAnswerTimeoutMs(): number {
  return fromEnv("AI_MAIN_TIMEOUT_MS", AI_MAIN_TIMEOUT_DEFAULT_MS, 5_000, 110_000);
}

/** Helper calls: `callClaudeTool`, drafting, chat revision, the L10 assistant's chunk gap. */
export function helperTimeoutMs(): number {
  return fromEnv("AI_HELPER_TIMEOUT_MS", AI_HELPER_TIMEOUT_DEFAULT_MS, 1_000, 60_000);
}

/** The AI reader (AI_READS_CODE_CHECKS_ENABLED). Read once, at load, as before. */
export function readerTimeoutMs(): number {
  return fromEnv("AI_READER_TIMEOUT_MS", AI_READER_TIMEOUT_DEFAULT_MS, 500, 10_000);
}

/** The form-patch call (FORM_PATCH_REDUCER_ENABLED); clamped, as before. */
export function formPatchTimeoutMs(): number {
  const configured = Number(process.env.FORM_PATCH_TIMEOUT_MS);
  if (!process.env.FORM_PATCH_TIMEOUT_MS || !Number.isFinite(configured)) return FORM_PATCH_TIMEOUT_DEFAULT_MS;
  return Math.min(10_000, Math.max(1_000, Math.round(configured)));
}
