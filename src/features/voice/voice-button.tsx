"use client";

import { useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { Loader2, Mic, Square } from "lucide-react";

import { cn } from "@/lib/utils/cn";
import { MAX_SECONDS } from "@/lib/voice/voice-limits";
import { VOICE_CHECK, VOICE_HINT, VOICE_NOTICE } from "@/lib/voice/voice-messages";

import { LiveDictationPanel } from "./live-dictation-panel";
import { useMicrophones } from "./mic-choice";
import { liveDictationSupported, useLiveDictation } from "./use-live-dictation";
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
 * ("Voice turns your recording into text.", shown whenever the mic is) go where the box already shows
 * its own notices: `messageSlot`, an element the box renders for them; without one, beside the button.
 *
 * LIVE DICTATION (the owner, 27 Nov 2026: "it transcribes as you talk then when done, press check mark and auto
 * send"). A box that gives `onSend` and a `liveSlot` (an element laid over its input row) gets the words as they are
 * said, in `LiveDictationPanel`, with ✓ to send (the names spelled as the directory spells them, on the server) and ✕
 * to drop. Where the browser cannot stream, or the server will not start a stream, the same press records instead, as
 * before, and the words go into the box to be checked. Boxes without `onSend` record, as before.
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
  /** Live dictation's ✓: send this text now. With `liveSlot`, turns live dictation on for the box. */
  readonly onSend?: (text: string, meta: { readonly traceId: string }) => void;
  /** Where the dictating box is drawn: an element laid over the box's input row. */
  readonly liveSlot?: HTMLElement | null;
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

function VoiceButtonOn({ surface, meetingKey, conversationId, disabled = false, onText, onSend, liveSlot, messageSlot, tone = "band", className }: VoiceButtonProps) {
  const { userKey } = useVoiceAccess();
  const [message, setMessage] = useState<Message | null>(null);
  // The owner, 27 Nov 2026: "i think i need to choose which mic because i have usb mic not built in".
  const microphones = useMicrophones();
  const recorder = useVoiceRecorder({
    surface,
    conversationId,
    meetingKey,
    deviceId: microphones.chosen,
    onMicrophoneOpened: () => void microphones.refresh(),
    onText: ({ text, traceId }) => {
      setMessage({ kind: "check" });
      onText(text, { traceId });
    },
    onError: (text) => setMessage({ kind: "error", text }),
  });
  const { state } = recorder;
  const live = useLiveDictation({
    surface,
    conversationId,
    meetingKey,
    deviceId: microphones.chosen,
    onMicrophoneOpened: () => void microphones.refresh(),
    onSend: (text, meta) => {
      setMessage(null);
      onSend?.(text, meta);
    },
    onText: (text, meta) => {
      setMessage({ kind: "check" });
      onText(text, meta);
    },
    onFallback: () => void recorder.start(),
    onError: (text) => setMessage({ kind: "error", text }),
  });
  const liveOn = Boolean(onSend) && liveSlot !== undefined && liveDictationSupported();
  const dictating = live.state.kind !== "idle";
  const begin = () => {
    if (liveOn) void live.start();
    else void recorder.start();
  };

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
    if (uploading || asking || dictating) return;
    if (!readConsent(userKey)) {
      setMessage({ kind: "notice" });
      return;
    }
    setMessage(null);
    begin();
  };

  const label = recording ? "Stop recording" : uploading ? "Transcribing your recording" : asking ? "Waiting for the microphone" : "Speak your message";
  const idleDisabled = disabled && !recording;

  const button = (
    <button
      type="button"
      onClick={onPress}
      disabled={idleDisabled || uploading || asking || dictating}
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
              begin();
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
  /*
   * WHICH MICROPHONE: always there while voice is on (the owner: "i still cant pick a microfphone to use"). Opening it
   * reads the list again and, when the browser still hides the names, asks for the microphone once. The choice is kept
   * in this browser. The options are dark on light: a browser that draws its own dropdown shows them readably.
   */
  const picker =
    microphones.supported ? (
      <label className={cn("flex flex-wrap items-center gap-1.5 text-[11px] leading-snug", muted)}>
        Microphone
        <select
          aria-label="Microphone"
          data-testid="voice-microphone"
          value={microphones.chosen ?? ""}
          disabled={recording || uploading || asking || dictating}
          onChange={(event) => microphones.choose(event.target.value || null)}
          onFocus={() => void microphones.open()}
          onPointerDown={() => void microphones.open()}
          className={cn(
            "max-w-[16rem] truncate rounded-md px-1.5 py-0.5 text-[11px] font-semibold",
            tone === "band" ? "border border-band-pill-border bg-transparent text-brand-yellow" : "bg-white/70 text-ink ring-1 ring-white/80",
          )}
        >
          <option value="" className="bg-white text-black">
            Default microphone
          </option>
          {microphones.microphones.map((microphone) => (
            <option key={microphone.id} value={microphone.id} className="bg-white text-black">
              {microphone.label}
            </option>
          ))}
        </select>
      </label>
    ) : null;

  const messages = (
    <div data-testid="voice-message" className="mt-2 space-y-1">
      {line}
      {picker}
      <p data-testid="voice-hint" className={cn("m-0 text-[11px] leading-snug", muted)}>
        {VOICE_HINT}
      </p>
    </div>
  );

  const panel =
    dictating && liveSlot ? (
      <LiveDictationPanel
        text={live.state.kind === "live" || live.state.kind === "finishing" ? live.state.text : ""}
        levels={live.levels}
        seconds={live.state.kind === "live" ? live.state.seconds : 0}
        connecting={live.state.kind === "connecting"}
        finishing={live.state.kind === "finishing"}
        onCancel={() => void live.cancel()}
        onSend={() => void live.send()}
      />
    ) : null;

  return (
    <>
      {button}
      {panel && liveSlot ? createPortal(panel, liveSlot) : null}
      {messageSlot ? createPortal(messages, messageSlot) : messageSlot === undefined ? messages : null}
    </>
  );
}
