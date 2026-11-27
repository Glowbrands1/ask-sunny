/**
 * VOICE INPUT LIMITS (VOICE_INPUT_ENABLED). Plain constants, shared by the four AI chat boxes: one person's minute,
 * day and audio-seconds caps cover all of them together, and the salon and company caps likewise.
 *
 * Day windows run midnight to midnight US Central time (America/Chicago, the business's time zone), with daylight
 * saving: a day is 23 hours in March and 25 in November. The owner, 27 Nov 2026, asked whether the voice day should
 * reset at Manila or Central midnight: "central".
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
/** Requests per person per Central day. */
export const PER_USER_PER_DAY = 120;
/** Seconds of audio per person per Central day (30 minutes). */
export const PER_USER_AUDIO_SECONDS_PER_DAY = 1800;
/** Seconds of audio per salon per Central day (90 minutes). */
export const PER_SALON_AUDIO_SECONDS_PER_DAY = 5400;
/** Seconds of audio for the whole company per Central day (3 hours). */
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

/** The voice caps' day: the business's time zone. The usage RPC uses the same zone name (voice-usage-sql.test.ts checks). */
export const VOICE_DAY_TIME_ZONE = "America/Chicago";

const ZONE_PARTS = new Intl.DateTimeFormat("en-US", {
  timeZone: VOICE_DAY_TIME_ZONE,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

/** The zone's wall clock at `at`, as if it were UTC, minus `at`: the zone's offset then, in ms (negative in Central). */
function zoneOffsetMs(at: number): number {
  const parts = Object.fromEntries(ZONE_PARTS.formatToParts(new Date(at)).map((part) => [part.type, part.value]));
  const wall = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
  return wall - Math.floor(at / 1000) * 1000;
}

/**
 * The instant the Central day containing `now` began (Central midnight): the same day start the usage RPC computes
 * with `date_trunc('day', now at time zone 'America/Chicago') at time zone 'America/Chicago'`. The zone maths is
 * Intl's, never a fixed offset, so it is right on both sides of a daylight-saving change.
 */
export function voiceDayStart(now: Date): Date {
  const local = new Date(now.getTime() + zoneOffsetMs(now.getTime()));
  const midnightAsUtc = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
  // Midnight's own offset (it can differ from `now`'s on a change day); twice, as the first guess may be an hour out.
  let start = midnightAsUtc - zoneOffsetMs(midnightAsUtc);
  start = midnightAsUtc - zoneOffsetMs(start);
  return new Date(start);
}

/** The instant the next Central day begins: 23, 24 or 25 hours after this one began. */
export function nextVoiceDayStart(now: Date): Date {
  return voiceDayStart(new Date(voiceDayStart(now).getTime() + 36 * 60 * 60 * 1000));
}

/** Whole seconds until the caps' day resets (at least 1): a day refusal's Retry-After. */
export function secondsUntilNextVoiceDay(now: Date): number {
  return Math.max(1, Math.ceil((nextVoiceDayStart(now).getTime() - now.getTime()) / 1000));
}

/** The seconds a recording counts for until the provider says how long it was: the browser's figure, clamped. */
export function clampClipSeconds(clipSeconds: number): number {
  if (!Number.isFinite(clipSeconds)) return MAX_SECONDS;
  return Math.min(MAX_SECONDS, Math.max(MIN_SECONDS, clipSeconds));
}
