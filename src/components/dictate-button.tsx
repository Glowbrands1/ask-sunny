"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Mic, Square } from "lucide-react";

import { cn } from "@/lib/utils/cn";

/**
 * ============================================================================
 * DICTATE WITH YOUR VOICE
 * ============================================================================
 *
 * QA, 24 Nov 2026 retest: "No upload or voice". The composer used to carry a
 * DISABLED voice button with a "Coming later" label, and it was removed because
 * a manager cannot tell "not built yet" from "broken" (see composer.tsx). This
 * is the control coming back because it now works.
 *
 * THE BROWSER DOES THE LISTENING. It is the Web Speech API
 * (`SpeechRecognition`, `webkitSpeechRecognition` in Chrome, Edge and Safari):
 * no server of ours, no API key, and nothing is recorded or stored by Sunny —
 * the words arrive as text and that is all we keep, in the text box.
 *
 * THE WORDS GO INTO THE BOX, NEVER STRAIGHT TO SEND. Interim words appear as
 * they are recognized so the manager can see it hearing them; the final words
 * replace them; the manager reads, edits and presses Send themselves.
 *
 * WHERE THE BROWSER HAS NO SPEECH RECOGNITION (Firefox) THE BUTTON IS NOT
 * RENDERED, rather than shown disabled — the same rule that took the dead
 * controls out of the composer.
 */

/* ---------------------------------------------------- the browser API --- */

/** The slice of the Web Speech API this uses. Not in TypeScript's DOM lib. */
export interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechRecognitionResultEventLike) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
}

export interface SpeechRecognitionResultEventLike {
  resultIndex: number;
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function recognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const noSubscribe = () => () => {};

/**
 * Whether this browser can dictate. False on the server and on the first
 * client render, so the markup hydrates identically and the button appears
 * only once it is known to work.
 */
export function useDictationSupported(): boolean {
  return useSyncExternalStore(
    noSubscribe,
    () => recognitionCtor() !== null,
    () => false,
  );
}

/* ------------------------------------------------------------ messages --- */

/** Short and friendly; what the manager can do about it, not the error code. */
export function dictationErrorMessage(error: string): string | null {
  switch (error) {
    case "aborted":
      return null; // we asked for it (Send, or leaving the page)
    case "not-allowed":
    case "service-not-allowed":
      return "Microphone access is off. Allow the microphone for this site in your browser, then try again.";
    case "no-speech":
      return "I didn't hear anything. Tap the mic and try again.";
    case "audio-capture":
      return "No microphone was found. Check it's connected, or type your question.";
    case "network":
      return "Dictation needs an internet connection. Try again, or type your question.";
    default:
      return "Dictation stopped. Try again, or type your question.";
  }
}

/* ---------------------------------------------------------------- hook --- */

export interface Dictation {
  supported: boolean;
  listening: boolean;
  /** "Listening…" while on, a friendly error after one, otherwise null. */
  message: string | null;
  isError: boolean;
  start: () => void;
  /** Stop listening and keep the last words the browser finalizes. */
  stop: () => void;
  /** Stop listening and ignore anything still on its way (used by Send). */
  cancel: () => void;
  toggle: () => void;
}

export function useDictation({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}): Dictation {
  const supported = useDictationSupported();
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  // The latest props, read from the recognition callbacks.
  const valueRef = useRef(value);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    valueRef.current = value;
    onChangeRef.current = onChange;
  });

  const detach = useCallback((recognition: SpeechRecognitionLike) => {
    recognition.onresult = null;
    recognition.onerror = null;
    recognition.onend = null;
  }, []);

  const cancel = useCallback(() => {
    const recognition = recognitionRef.current;
    recognitionRef.current = null;
    setListening(false);
    if (!recognition) return;
    // Detach first: a result that lands after Send must not refill the box.
    detach(recognition);
    recognition.abort();
  }, [detach]);

  const stop = useCallback(() => {
    // Results that arrive while stopping are the last words; keep them. The
    // browser fires `end` once they are in.
    recognitionRef.current?.stop();
  }, []);

  const start = useCallback(() => {
    const Ctor = recognitionCtor();
    if (!Ctor || recognitionRef.current) return;

    const recognition = new Ctor();
    recognition.lang = "en-US";
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    // What was already in the box stays; dictated words follow it.
    const before = valueRef.current;
    const prefix = before && !/\s$/.test(before) ? `${before} ` : before;

    recognition.onresult = (event) => {
      let heard = "";
      for (let i = 0; i < event.results.length; i++) {
        heard += event.results[i][0].transcript;
      }
      onChangeRef.current(prefix + heard.replace(/^\s+/, ""));
    };
    recognition.onerror = (event) => {
      setError(dictationErrorMessage(event.error));
    };
    recognition.onend = () => {
      if (recognitionRef.current === recognition) recognitionRef.current = null;
      detach(recognition);
      setListening(false);
    };

    recognitionRef.current = recognition;
    setError(null);
    try {
      recognition.start();
      setListening(true);
    } catch {
      recognitionRef.current = null;
      detach(recognition);
      setError(dictationErrorMessage("unknown"));
    }
  }, [detach]);

  const toggle = useCallback(() => {
    if (recognitionRef.current) stop();
    else start();
  }, [start, stop]);

  // Leaving the page turns the microphone off.
  useEffect(() => () => {
    const recognition = recognitionRef.current;
    recognitionRef.current = null;
    if (recognition) {
      detach(recognition);
      recognition.abort();
    }
  }, [detach]);

  return {
    supported,
    listening,
    message: listening ? "Listening… speak now, then tap stop." : error,
    isError: !listening && error !== null,
    start,
    stop,
    cancel,
    toggle,
  };
}

/* -------------------------------------------------------------- button --- */

/**
 * The mic toggle. Renders nothing where the browser cannot dictate. A real
 * button, so Enter and Space work, with `aria-pressed` for the listening state
 * and a label that says what pressing it will do.
 */
export function DictateButton({
  dictation,
  disabled,
  className,
}: {
  dictation: Dictation;
  disabled?: boolean;
  className?: string;
}) {
  if (!dictation.supported) return null;
  const { listening } = dictation;
  return (
    <button
      type="button"
      onClick={dictation.toggle}
      disabled={disabled}
      aria-pressed={listening}
      aria-label={listening ? "Stop dictating" : "Dictate with your voice"}
      title={listening ? "Stop dictating" : "Dictate with your voice"}
      data-state={listening ? "listening" : "idle"}
      className={cn(
        "grid size-9 shrink-0 place-items-center rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-40",
        listening ? "bg-red-700 text-white motion-safe:animate-pulse" : "text-muted-foreground hover:bg-muted hover:text-foreground",
        className,
      )}
    >
      {listening ? <Square className="size-3.5" fill="currentColor" /> : <Mic className="size-[17px]" />}
    </button>
  );
}

/**
 * The listening state and any error, in a live region so a screen reader
 * hears "Listening…" when it starts and the reason when it stops.
 */
export function DictationStatus({
  dictation,
  id,
  className,
}: {
  dictation: Dictation;
  id?: string;
  className?: string;
}) {
  if (!dictation.supported) return null;
  return (
    <p
      id={id}
      role="status"
      aria-live="polite"
      data-state={dictation.listening ? "listening" : dictation.isError ? "error" : "idle"}
      className={cn("text-[11.5px] leading-snug empty:hidden", className)}
    >
      {dictation.message ?? ""}
    </p>
  );
}
