"use client";

import { useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { Loader2, Mic, Square } from "lucide-react";

import { cn } from "@/lib/utils/cn";
import { MAX_SECONDS } from "@/lib/voice/voice-limits";
import { VOICE_CHECK, VOICE_HINT, VOICE_NOTICE } from "@/lib/voice/voice-messages";

import { useVoiceAccess } from "./voice-access";
import { WARN_AT_SECONDS, inAppBrowser, recordingSupported, useVoiceRecorder, type VoiceSurfaceName } from "./use-voice-recorder";

/**
 * ============================================================================
 * THE MIC BUTTON, SHARED BY THE FOUR AI CHAT BOXES (VOICE_INPUT_ENABLED)
 * ============================================================================
 *
 * Voice only fills the box: the transcript is handed to `onText`, the box appends it to its own text, and the person
 * checks it and presses Send as usual. Nothing is sent to the AI from here.
 *
 * Renders nothing when voice is off for this person (`useVoiceAccess`), when the browser cannot record, and in
 * Slack's, Teams' and Gmail's in-app browsers. Its notices, every error (with role="alert") and the standing hint
 * ("Voice sends your recording to AssemblyAI to make text.", shown whenever the mic is) go where the box already shows
 * its own notices: `messageSlot`, an element the box renders for them; without one, beside the button.
 */

const CONSENT_PREFIX = "ask-sunny:voice-consent:";

function consentKey(userKey: string | null): string {
  return `${CONSENT_PREFIX}${userKey ?? "signed-in"}`;
}

function readConsent(userKey: string | null): boolean {
  try {
    return window.localStorage.getItem(consentKey(userKey)) === "accepted";
  } catch {
    return false;
  }
}

function saveConsent(userKey: string | null, choice: "accepted" | "declined"): void {
  try {
    window.localStorage.setItem(consentKey(userKey), choice);
  } catch {
    /* A private window: the notice shows again next time. */
  }
}

const noSubscription = () => () => undefined;

function canRecordHere(): boolean {
  return recordingSupported() && !inAppBrowser(navigator.userAgent ?? "");
}

function clock(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

type Message = { readonly kind: "error"; readonly text: string } | { readonly kind: "check" } | { readonly kind: "notice" };

export interface VoiceButtonProps {
  readonly surface: VoiceSurfaceName;
  /** Box D only: the meeting the assistant is open on. */
  readonly meetingKey?: string | null;
  /** Boxes A-C: the conversation, when there is one (its names become spelling hints on the server). */
  readonly conversationId?: string | null;
  /** The box is busy: the mic is too. */
  readonly disabled?: boolean;
  readonly onText: (text: string, meta: { readonly traceId: string }) => void;
  /** Where the notices and errors go (the box's own notice area). */
  readonly messageSlot?: HTMLElement | null;
  /** "band": the dark chat dock, Overview band and report bar. "light": the L10 assistant's glass panel. */
  readonly tone?: "band" | "light";
  /** The button's classes, to match its neighbours. */
  readonly className?: string;
}

export function VoiceButton(props: VoiceButtonProps) {
  const { enabled } = useVoiceAccess();
  const supported = useSyncExternalStore(noSubscription, canRecordHere, () => false);
  if (!enabled || !supported) return null;
  return <VoiceButtonOn {...props} />;
}

function VoiceButtonOn({ surface, meetingKey, conversationId, disabled = false, onText, messageSlot, tone = "band", className }: VoiceButtonProps) {
  const { userKey } = useVoiceAccess();
  const [message, setMessage] = useState<Message | null>(null);
  const recorder = useVoiceRecorder({
    surface,
    conversationId,
    meetingKey,
    onText: ({ text, traceId }) => {
      setMessage({ kind: "check" });
      onText(text, { traceId });
    },
    onError: (text) => setMessage({ kind: "error", text }),
  });
  const { state } = recorder;

  // Sending (the box goes busy) retires "Check the words".
  const [wasDisabled, setWasDisabled] = useState(disabled);
  if (wasDisabled !== disabled) {
    setWasDisabled(disabled);
    if (disabled && message?.kind === "check") setMessage(null);
  }

  const recording = state.kind === "recording";
  const uploading = state.kind === "uploading";
  const asking = state.kind === "asking";

  const onPress = () => {
    if (recording) {
      recorder.stop();
      return;
    }
    if (uploading || asking) return;
    if (!readConsent(userKey)) {
      setMessage({ kind: "notice" });
      return;
    }
    setMessage(null);
    void recorder.start();
  };

  const label = recording ? "Stop recording" : uploading ? "Transcribing your recording" : asking ? "Waiting for the microphone" : "Speak your message";
  const idleDisabled = disabled && !recording;

  const button = (
    <button
      type="button"
      onClick={onPress}
      disabled={idleDisabled || uploading || asking}
      aria-label={label}
      data-voice-state={state.kind}
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center gap-1 transition-opacity disabled:cursor-not-allowed disabled:opacity-40",
        recording && "text-measure-flagged",
        className,
      )}
    >
      {uploading ? (
        <Loader2 aria-hidden className="size-4 motion-safe:animate-spin" />
      ) : recording ? (
        <>
          <Square aria-hidden className="size-3.5 fill-current" />
          <span className="text-[11px] font-bold tabular-nums" data-testid="voice-timer">
            {clock(state.seconds)}
          </span>
        </>
      ) : (
        <Mic aria-hidden className={cn("size-4", asking && "motion-safe:animate-pulse")} />
      )}
    </button>
  );

  const muted = tone === "band" ? "text-band-label" : "text-muted";
  const strong = tone === "band" ? "font-semibold text-brand-yellow" : "font-semibold text-[#8a1c1c]";
  const action =
    tone === "band"
      ? "rounded-full border border-band-pill-border px-2.5 py-1 text-[11px] font-bold text-brand-yellow hover:bg-white/10"
      : "rounded-lg bg-white/70 px-2.5 py-1 text-xs font-semibold text-ink ring-1 ring-white/80 hover:bg-white";

  let line: React.ReactNode = null;
  if (message?.kind === "notice") {
    line = (
      <div role="group" aria-label="About voice input" className={cn("space-y-2 text-[11.5px] leading-snug", muted)}>
        <p className="m-0">{VOICE_NOTICE}</p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={action}
            onClick={() => {
              saveConsent(userKey, "declined");
              setMessage(null);
            }}
          >
            Not now
          </button>
          <button
            type="button"
            className={action}
            onClick={() => {
              saveConsent(userKey, "accepted");
              setMessage(null);
              void recorder.start();
            }}
          >
            OK, use voice
          </button>
        </div>
      </div>
    );
  } else if (recording) {
    const left = Math.max(0, Math.ceil(MAX_SECONDS - state.seconds));
    line = (
      <div className={cn("space-y-0.5 text-[11.5px] leading-snug", muted)}>
        <p className="m-0" role="status">
          {state.seconds >= WARN_AT_SECONDS ? (
            <span className={strong}>{`${left} seconds left. Recording stops at ${MAX_SECONDS} seconds.`}</span>
          ) : (
            `Recording ${clock(state.seconds)}. Tap the mic again to stop.`
          )}
        </p>
      </div>
    );
  } else if (uploading) {
    line = (
      <div className={cn("flex flex-wrap items-center gap-2 text-[11.5px] leading-snug", muted)}>
        <p className="m-0" role="status">
          Transcribing…
        </p>
        <button type="button" className={action} onClick={recorder.cancel}>
          Cancel
        </button>
      </div>
    );
  } else if (state.kind === "cut") {
    line = (
      <div className={cn("space-y-2 text-[11.5px] leading-snug", muted)}>
        <p className="m-0" role="status">
          {`The recording stopped early, after ${clock(state.seconds)}.`}
        </p>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={action} onClick={recorder.sendHeld}>
            Transcribe this
          </button>
          <button
            type="button"
            className={action}
            onClick={() => {
              setMessage(null);
              void recorder.start();
            }}
          >
            Try again
          </button>
        </div>
      </div>
    );
  } else if (message?.kind === "error") {
    line = (
      <p role="alert" data-testid="voice-error" className={cn("m-0 text-[11.5px] leading-snug", strong)}>
        {message.text}
      </p>
    );
  } else if (message?.kind === "check") {
    line = (
      <p role="status" className={cn("m-0 text-[11.5px] leading-snug", muted)}>
        {VOICE_CHECK}
      </p>
    );
  }

  /*
   * The hint is always there while voice is on for this person (whenever the mic shows), under any notice, so nobody
   * uses the mic without being told where the recording goes.
   */
  const messages = (
    <div data-testid="voice-message" className="mt-2 space-y-1">
      {line}
      <p data-testid="voice-hint" className={cn("m-0 text-[11px] leading-snug", muted)}>
        {VOICE_HINT}
      </p>
    </div>
  );

  return (
    <>
      {button}
      {messageSlot ? createPortal(messages, messageSlot) : messageSlot === undefined ? messages : null}
    </>
  );
}
