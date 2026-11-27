/**
 * VOICE INPUT'S SENTENCES (VOICE_INPUT_ENABLED), the same in the route and in the mic button. Never a blank, never
 * "No answer was produced". The monthly-budget refusal is not here: the route returns `modelSpendGuard`'s own
 * sentence, the one chat shows.
 */
export const VOICE_MESSAGES = {
  micBlocked: "Your microphone is blocked. Allow it in your browser or phone settings, or type your message.",
  nothingHeard: "I did not hear anything. Check your microphone and try again.",
  tooLong: "That recording was too long. Keep it under 60 seconds.",
  badAudio: "I could not use that recording. Try again, or type your message.",
  userDay: "You have used today's voice limit. Type your message instead.",
  salonDay: "Your salon has used today's voice limit. Type your message instead.",
  companyDay: "Voice is paused for today. Type your message instead.",
  busy: "Voice is busy. Try again in a few seconds, or type your message.",
  timeout: "Voice took too long. Your recording was not saved. Try again, or type your message.",
  unavailable: "Voice is not available right now. Please type your message.",
} as const;

/** Per-minute cap: "Try again in N seconds." */
export function tryAgainIn(seconds: number): string {
  const n = Math.max(1, Math.ceil(seconds));
  return `Try again in ${n} second${n === 1 ? "" : "s"}.`;
}

/** The first-use notice. */
export const VOICE_NOTICE =
  "Voice turns your speech into text using AssemblyAI, a speech service. Your recording is sent to them, including any names you say, and the names of the people and salons you work with may be sent as spelling hints. We do not keep the recording. After you press Send, the text is stored like a typed message. Check the words before you send.";

/** The hint under a box while voice is on. */
export const VOICE_HINT = "Voice sends your recording to AssemblyAI to make text.";

/** Shown once the transcript is in the box. */
export const VOICE_CHECK = "Check the words, then press Send";

export type VoiceErrorCode =
  | "mic_blocked"
  | "nothing_heard"
  | "too_long"
  | "bad_audio"
  | "user_minute"
  | "user_day"
  | "salon_day"
  | "company_day"
  | "monthly_budget"
  | "busy"
  | "timeout"
  | "unavailable"
  | "bad_request"
  | "forbidden"
  | "unauthenticated"
  | "not_found";
