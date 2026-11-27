/**
 * VOICE INPUT LIMITS (VOICE_INPUT_ENABLED). Plain constants, shared by the four AI chat boxes: one person's minute,
 * day and audio-seconds caps cover all of them together, and the salon and company caps likewise.
 *
 * Day windows start at Manila midnight (Asia/Manila, UTC+8, no daylight saving), not UTC.
 */

/** A recording stops itself here. */
export const MAX_SECONDS = 60;
/** Shorter than this is "I did not hear anything". */
export const MIN_SECONDS = 0.5;
/** Fewer bytes than this is not a recording. */
export const MIN_BYTES = 1024;
/** The upload is cut off past this many bytes (3 MB), whatever Content-Length says. */
export const MAX_BYTES = 3 * 1024 * 1024;

/** Requests per person per minute, all four boxes together. */
export const PER_USER_PER_MINUTE = 10;
/** Requests per person per Manila day. */
export const PER_USER_PER_DAY = 120;
/** Seconds of audio per person per Manila day (30 minutes). */
export const PER_USER_AUDIO_SECONDS_PER_DAY = 1800;
/** Seconds of audio per salon per Manila day (90 minutes). */
export const PER_SALON_AUDIO_SECONDS_PER_DAY = 5400;
/** Seconds of audio for the whole company per Manila day (3 hours). */
export const COMPANY_AUDIO_SECONDS_PER_DAY = 10800;

/** The route's own time limit (`maxDuration`). */
export const ROUTE_MAX_SECONDS = 45;
/** One AssemblyAI call may take this long. */
export const PROVIDER_TIMEOUT_MS = 28_000;
/** A retry is tried only while at least this much of the route's time is left. */
export const RETRY_MIN_REMAINING_MS = 8_000;
/** A retry waits at most this long (a longer Retry-After is not retried). */
export const RETRY_MAX_WAIT_MS = 2_000;

/** Budget buffer: AssemblyAI's Sync rate is $0.30 an hour (keyterms included); the spend meter counts $0.35. */
export const USD_PER_HOUR = 0.35;

/** Asia/Manila is UTC+8 all year. */
const MANILA_OFFSET_MS = 8 * 60 * 60 * 1000;

/**
 * The instant Manila's current day began, as an ISO string. The same day start the usage RPC computes with
 * `date_trunc('day', now() at time zone 'Asia/Manila') at time zone 'Asia/Manila'`.
 */
export function manilaDayStart(now: Date): Date {
  const manila = now.getTime() + MANILA_OFFSET_MS;
  const midnight = manila - (((manila % 86_400_000) + 86_400_000) % 86_400_000);
  return new Date(midnight - MANILA_OFFSET_MS);
}

/** The seconds a recording counts for until the provider says how long it was: the browser's figure, clamped. */
export function clampClipSeconds(clipSeconds: number): number {
  if (!Number.isFinite(clipSeconds)) return MAX_SECONDS;
  return Math.min(MAX_SECONDS, Math.max(MIN_SECONDS, clipSeconds));
}
