"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { MAX_SECONDS, MIN_SECONDS } from "@/lib/voice/voice-limits";
import { VOICE_MESSAGES } from "@/lib/voice/voice-messages";

/**
 * ============================================================================
 * THE MIC, RECORDED IN THE BROWSER (VOICE_INPUT_ENABLED)
 * ============================================================================
 *
 * Tap to start, tap to stop; it stops itself at 60 seconds (a warning at 50). The recording is held in memory only
 * until the transcript comes back or the person cancels, then dropped; it is never saved in the browser. The mic is
 * released when recording stops, when the tab is hidden and when the box unmounts. No Web Speech API: the server
 * turns the recording into text (POST /api/chat/voice).
 */

export const WARN_AT_SECONDS = 50;
export const PERMISSION_WAIT_MS = 15_000;
export const UPLOAD_WAIT_MS = 50_000;

/** The formats asked for, in order; with none supported the browser picks its own. */
export const MIME_PREFERENCE = ["audio/webm;codecs=opus", "audio/mp4;codecs=mp4a.40.2", "audio/mp4", "audio/ogg;codecs=opus"] as const;

export type VoiceSurfaceName = "chat" | "overview" | "report" | "l10";

export type RecorderState =
  | { readonly kind: "idle" }
  | { readonly kind: "asking" }
  | { readonly kind: "recording"; readonly seconds: number }
  | { readonly kind: "cut"; readonly seconds: number }
  | { readonly kind: "uploading" };

export interface VoiceResult {
  readonly text: string;
  readonly traceId: string;
}

export interface RecorderOptions {
  readonly surface: VoiceSurfaceName;
  readonly conversationId?: string | null;
  readonly meetingKey?: string | null;
  readonly onText: (result: VoiceResult) => void;
  readonly onError: (message: string) => void;
}

/** Whether this browser can record at all. */
export function recordingSupported(): boolean {
  return typeof window !== "undefined" && typeof window.MediaRecorder === "function" && typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia;
}

/** Slack's, Teams' and Gmail's own browsers: the mic is hidden there (their web views do not record reliably). */
export function inAppBrowser(userAgent: string): boolean {
  return /\b(Slack|Slack_SSB|Teams|MSTeams|MicrosoftTeams|Gmail)\b/i.test(userAgent);
}

export function pickMimeType(): string | undefined {
  const recorder = typeof window !== "undefined" ? window.MediaRecorder : undefined;
  if (!recorder || typeof recorder.isTypeSupported !== "function") return undefined;
  return MIME_PREFERENCE.find((type) => recorder.isTypeSupported(type));
}

function extensionFor(type: string): string {
  if (type.includes("mp4")) return "m4a";
  if (type.includes("ogg")) return "ogg";
  if (type.includes("wav")) return "wav";
  return "webm";
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new DOMException("timed out", "TimeoutError")), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

interface WakeLockLike {
  release(): Promise<void>;
}

export function useVoiceRecorder(options: RecorderOptions) {
  const [state, setState] = useState<RecorderState>({ kind: "idle" });
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  });

  const stream = useRef<MediaStream | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const startedAt = useRef(0);
  const seconds = useRef(0);
  const ticker = useRef<ReturnType<typeof setInterval> | null>(null);
  const wakeLock = useRef<WakeLockLike | null>(null);
  const upload = useRef<AbortController | null>(null);
  /** What happens when the recorder has stopped: send the clip, offer it, or drop it. */
  const afterStop = useRef<"send" | "offer" | "drop">("send");
  const held = useRef<Blob | null>(null);
  const alive = useRef(true);

  const stopTicker = () => {
    if (ticker.current) clearInterval(ticker.current);
    ticker.current = null;
  };

  const releaseMic = useCallback(() => {
    stopTicker();
    for (const track of stream.current?.getTracks() ?? []) {
      track.onended = null;
      track.onmute = null;
      track.stop();
    }
    stream.current = null;
    void wakeLock.current?.release().catch(() => undefined);
    wakeLock.current = null;
  }, []);

  const drop = useCallback(() => {
    chunks.current = [];
    held.current = null;
  }, []);

  const send = useCallback(
    async (clip: Blob, clipSeconds: number) => {
      const { surface, conversationId, meetingKey } = optionsRef.current;
      setState({ kind: "uploading" });
      const controller = new AbortController();
      upload.current = controller;
      const timer = setTimeout(() => controller.abort(), UPLOAD_WAIT_MS);
      const form = new FormData();
      // The small fields first, the audio last: the server checks access before it reads the audio.
      form.append("surface", surface);
      form.append("clipSeconds", clipSeconds.toFixed(2));
      if (surface === "l10") {
        if (meetingKey) form.append("meetingKey", meetingKey);
      } else if (conversationId) {
        form.append("conversationId", conversationId);
      }
      form.append("audio", clip, `clip.${extensionFor(clip.type)}`);
      try {
        const response = await fetch("/api/chat/voice", { method: "POST", body: form, signal: controller.signal, credentials: "same-origin" });
        const body = (await response.json().catch(() => null)) as { text?: unknown; traceId?: unknown; error?: unknown } | null;
        if (!alive.current || controller.signal.aborted) return;
        if (response.ok && body && typeof body.text === "string" && typeof body.traceId === "string") {
          if (body.text.trim()) optionsRef.current.onText({ text: body.text, traceId: body.traceId });
          else optionsRef.current.onError(VOICE_MESSAGES.nothingHeard);
        } else {
          const message = body && typeof body.error === "string" && body.error.trim() ? body.error : VOICE_MESSAGES.unavailable;
          optionsRef.current.onError(message);
        }
      } catch {
        if (!alive.current) return;
        optionsRef.current.onError(controller.signal.aborted ? VOICE_MESSAGES.timeout : VOICE_MESSAGES.unavailable);
      } finally {
        clearTimeout(timer);
        if (upload.current === controller) upload.current = null;
        drop();
        if (alive.current) setState({ kind: "idle" });
      }
    },
    [drop],
  );

  /** Stops the recorder; what follows depends on `then`. */
  const finish = useCallback(
    (then: "send" | "offer" | "drop") => {
      afterStop.current = then;
      seconds.current = Math.min(MAX_SECONDS, (Date.now() - startedAt.current) / 1000);
      const active = recorder.current;
      if (active && active.state !== "inactive") {
        active.stop();
      } else {
        releaseMic();
      }
    },
    [releaseMic],
  );

  const start = useCallback(async () => {
    if (state.kind !== "idle" && state.kind !== "cut") return;
    drop();
    setState({ kind: "asking" });
    let media: MediaStream;
    try {
      media = await withTimeout(navigator.mediaDevices.getUserMedia({ audio: true }), PERMISSION_WAIT_MS);
    } catch {
      if (!alive.current) return;
      setState({ kind: "idle" });
      optionsRef.current.onError(VOICE_MESSAGES.micBlocked);
      return;
    }
    if (!alive.current) {
      for (const track of media.getTracks()) track.stop();
      return;
    }
    stream.current = media;
    const mimeType = pickMimeType();
    let active: MediaRecorder;
    try {
      active = mimeType ? new MediaRecorder(media, { mimeType }) : new MediaRecorder(media);
    } catch {
      releaseMic();
      setState({ kind: "idle" });
      optionsRef.current.onError(VOICE_MESSAGES.badAudio);
      return;
    }
    recorder.current = active;
    chunks.current = [];
    active.ondataavailable = (event: BlobEvent) => {
      if (event.data && event.data.size > 0) chunks.current.push(event.data);
    };
    active.onstop = () => {
      releaseMic();
      recorder.current = null;
      const clip = new Blob(chunks.current, { type: active.mimeType || mimeType || "audio/webm" });
      chunks.current = [];
      const length = seconds.current;
      const then = afterStop.current;
      if (!alive.current || then === "drop") {
        drop();
        if (alive.current) setState({ kind: "idle" });
        return;
      }
      if (length < MIN_SECONDS || clip.size === 0) {
        drop();
        setState({ kind: "idle" });
        optionsRef.current.onError(VOICE_MESSAGES.nothingHeard);
        return;
      }
      if (then === "offer") {
        held.current = clip;
        setState({ kind: "cut", seconds: length });
        return;
      }
      void send(clip, length);
    };
    // A track that ends or goes silent (another app took the mic, a headset unplugged) cuts the recording off.
    for (const track of media.getAudioTracks()) {
      track.onended = () => finish("offer");
      track.onmute = () => finish("offer");
    }
    startedAt.current = Date.now();
    seconds.current = 0;
    active.start(1000);
    setState({ kind: "recording", seconds: 0 });
    ticker.current = setInterval(() => {
      const elapsed = (Date.now() - startedAt.current) / 1000;
      if (elapsed >= MAX_SECONDS) {
        finish("send");
        return;
      }
      setState({ kind: "recording", seconds: elapsed });
    }, 250);
    const lock = (navigator as Navigator & { wakeLock?: { request(type: "screen"): Promise<WakeLockLike> } }).wakeLock;
    if (lock) {
      lock
        .request("screen")
        .then((sentinel) => {
          if (stream.current) wakeLock.current = sentinel;
          else void sentinel.release().catch(() => undefined);
        })
        .catch(() => undefined);
    }
  }, [state.kind, drop, releaseMic, finish, send]);

  /** Tap while recording: stop and send. */
  const stop = useCallback(() => finish("send"), [finish]);

  /** The cut-off offer: "Transcribe this". */
  const sendHeld = useCallback(() => {
    const clip = held.current;
    held.current = null;
    if (clip && state.kind === "cut") void send(clip, state.seconds);
  }, [send, state]);

  /** Drops everything: the recording, the upload, the mic. */
  const cancel = useCallback(() => {
    upload.current?.abort();
    upload.current = null;
    if (recorder.current && recorder.current.state !== "inactive") finish("drop");
    else releaseMic();
    drop();
    setState({ kind: "idle" });
  }, [drop, finish, releaseMic]);

  // The tab hidden: stop and release the mic; what was captured is offered when they come back.
  useEffect(() => {
    const onHidden = () => {
      if (document.visibilityState === "hidden" && recorder.current && recorder.current.state !== "inactive") finish("offer");
    };
    document.addEventListener("visibilitychange", onHidden);
    return () => document.removeEventListener("visibilitychange", onHidden);
  }, [finish]);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      upload.current?.abort();
      if (recorder.current && recorder.current.state !== "inactive") {
        afterStop.current = "drop";
        recorder.current.stop();
      }
      releaseMic();
      chunks.current = [];
      held.current = null;
    };
  }, [releaseMic]);

  return { state, start, stop, sendHeld, cancel };
}
