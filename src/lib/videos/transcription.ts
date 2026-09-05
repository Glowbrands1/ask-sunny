import "server-only";

/**
 * ============================================================================
 * THE SPEECH-TO-TEXT SEAM, WITH NOTHING BEHIND IT YET
 * ============================================================================
 *
 * THE AUDIT RESULT, STATED PLAINLY: this project has no transcription provider,
 * and none was added. `package.json` carries one AI dependency,
 * `@anthropic-ai/sdk`. Claude does not accept video or audio input, so nothing
 * currently installed can turn a training video into text — and Supabase
 * Storage stores bytes, it does not transcribe them.
 *
 * Every real option — OpenAI's transcription API, Deepgram, AssemblyAI — is
 * paid per minute of audio and needs an account, a key and a budget. The
 * instruction for this milestone was to skip anything that costs money, so no
 * provider was chosen, no key was invented, and no dependency was added.
 *
 * WHAT EXISTS INSTEAD IS THE SEAM AND AN HONEST RESTING STATE. Wiring a
 * provider later is implementing this interface and registering it; no route,
 * no table column and no piece of UI has to move. What must NEVER happen in the
 * meantime is the thing this file exists to prevent: a plausible-looking
 * transcript produced by a model that never heard the audio. A fabricated
 * transcript of a safety procedure is worse than no transcript, because a
 * manager would act on it.
 *
 * SO THE UNCONFIGURED PROVIDER REFUSES. It does not return an empty string, it
 * does not return a summary of the title, and it cannot be mistaken for a
 * successful run.
 */

export interface TranscriptionRequest {
  readonly videoId: string;
  /**
   * A short-lived signed URL for the media.
   *
   * A URL rather than bytes, because a provider that can fetch the media itself
   * keeps the media out of this process entirely. Buffering a video into a
   * serverless function to POST it onward is how a request times out and a
   * function runs out of memory — true at this deployment's 50 MB ceiling and
   * more so at any larger one.
   *
   * IT IS A CREDENTIAL. It grants read access to a private object for as long
   * as it lives, which is why no implementation may put it in a log, an error
   * message, or a value stored on the row — see `transcript_error_safe`.
   */
  readonly mediaUrl: string;
  readonly mimeType: string;
}

export type TranscriptionResult =
  /** Text exists. The only outcome that may set the status to `ready`. */
  | { readonly ok: true; readonly text: string; readonly provider: string }
  /**
   * It did not produce a transcript.
   *
   * `safeMessage` is written by the implementation for a person to read and
   * must contain no provider payload, no signed URL and no key. `notConfigured`
   * separates "there is no provider" from "the provider tried and failed",
   * because only the second is worth retrying.
   */
  | {
      readonly ok: false;
      readonly safeMessage: string;
      readonly notConfigured: boolean;
    };

export interface VideoTranscriptionProvider {
  readonly name: string;
  /** False for any stand-in. Nothing may treat a false here as usable. */
  readonly configured: boolean;
  /** What an administrator must supply. Names only, never values. */
  readonly missingConfiguration: readonly string[];
  transcribe(request: TranscriptionRequest): Promise<TranscriptionResult>;
}

/**
 * The only provider that ships today.
 *
 * It REFUSES rather than returning empty text, so no caller can mistake it for
 * a provider that ran and found nothing to transcribe. The distinction matters
 * at exactly one place — the point where a status would be set to `ready` — and
 * the database refuses that too: `training_videos_ready_transcript_has_text`
 * rejects a `ready` row with no text, so even a bug here cannot produce a
 * transcript UI with nothing in it.
 */
export class UnconfiguredTranscriptionProvider implements VideoTranscriptionProvider {
  readonly name = "None configured";
  readonly configured = false;
  readonly missingConfiguration = [
    "A speech-to-text provider account, its API key, and a per-minute budget. " +
      "None is configured, and none was chosen: every option is paid.",
  ] as const;

  async transcribe(): Promise<TranscriptionResult> {
    return {
      ok: false,
      notConfigured: true,
      safeMessage:
        "No speech-to-text provider is configured, so transcripts cannot be generated yet. Playback is unaffected.",
    };
  }
}

let provider: VideoTranscriptionProvider = new UnconfiguredTranscriptionProvider();

export function getTranscriptionProvider(): VideoTranscriptionProvider {
  return provider;
}

/**
 * The swap seam a real provider arrives through.
 *
 * Also the test seam. A test that needs a working provider registers a fake
 * here; it does not get one by loosening the unconfigured provider, which would
 * make the shipped default capable of producing text.
 */
export function __setTranscriptionProvider(next: VideoTranscriptionProvider): void {
  provider = next;
}

/** Readiness for the Integrations screen. Names and booleans only. */
export function transcriptionStatus(): {
  name: string;
  configured: boolean;
  missing: readonly string[];
} {
  const current = getTranscriptionProvider();
  return {
    name: current.name,
    configured: current.configured,
    missing: current.missingConfiguration,
  };
}
