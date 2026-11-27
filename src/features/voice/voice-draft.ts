"use client";

import { useCallback, useRef } from "react";

/**
 * VOICE_INPUT_ENABLED: what a chat box (A, B, C) sends beside its text when that text came from the mic. Reporting
 * only (the chat trace's `slots.voice_input`); it changes nothing about the answer.
 */
export interface VoiceSendFields {
  readonly inputMode: "voice";
  readonly voiceTraceId: string;
  /** Whether the sent text differs from the transcript. */
  readonly voiceEdited: boolean;
}

/** The box's text with the transcript after it (a space between when there is text already). */
export function appendTranscript(current: string, transcript: string): string {
  const spoken = transcript.trim();
  if (!spoken) return current;
  if (!current.trim()) return spoken;
  return /\s$/.test(current) ? `${current}${spoken}` : `${current} ${spoken}`;
}

/** Remembers the last transcript put in the box until the box sends. */
export function useVoiceDraft() {
  const last = useRef<{ readonly transcript: string; readonly traceId: string } | null>(null);

  const note = useCallback((transcript: string, traceId: string) => {
    last.current = { transcript, traceId };
  }, []);

  /** The fields for this send (none when the text was typed), and forgets the transcript. */
  const take = useCallback((sent: string): VoiceSendFields | undefined => {
    const spoken = last.current;
    last.current = null;
    if (!spoken) return undefined;
    return { inputMode: "voice", voiceTraceId: spoken.traceId, voiceEdited: sent.trim() !== spoken.transcript.trim() };
  }, []);

  return { note, take };
}
