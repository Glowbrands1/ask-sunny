"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { VOICE_MESSAGES } from "@/lib/voice/voice-messages";

import { SILENT_PEAK, microphoneName, openMicrophone, silentMicrophoneMessage } from "./mic-choice";

import type { VoiceSurfaceName } from "./use-voice-recorder";

/**
 * ============================================================================
 * LIVE DICTATION IN THE BROWSER (VOICE_INPUT_ENABLED)
 * ============================================================================
 *
 * The owner, 27 Nov 2026: "it transcribes as you talk then when done, press check mark and auto send". The mic is
 * captured at 16 kHz, turned into 16-bit PCM in an AudioWorklet and streamed, about every 50 ms, to the AssemblyAI
 * socket the server authorised (POST /api/chat/voice/stream, "start"). Each `Turn` message replaces that turn's text,
 * so the words grow as they are said.
 *
 *   ✓ ends the session (`Terminate`, then the final `Termination`), sends the final text back to the server, which
 *     spells the names as the directory does, and hands the corrected text to `onSend`.
 *   ✕ ends the session and tells the server to drop it; nothing is sent.
 *   The 60-second limit, the tab being hidden, or the corrected text not coming back: the words go into the box
 *     (`onText`) for the person to check and send themselves, as with a recording.
 *
 * When live dictation cannot start (no AudioWorklet, the server will not authorise a stream, the socket fails before it
 * begins), `onFallback` is called and the box uses the recording instead. Nothing is stored in the browser: the audio
 * goes to the socket and nowhere else, and the mic is released whenever the session ends.
 */

export type LiveDictationState =
  | { readonly kind: "idle" }
  | { readonly kind: "connecting" }
  | { readonly kind: "live"; readonly seconds: number; readonly text: string }
  | { readonly kind: "finishing"; readonly text: string };

export interface LiveDictationOptions {
  readonly surface: VoiceSurfaceName;
  readonly conversationId?: string | null;
  readonly meetingKey?: string | null;
  /** The microphone chosen in the picker, if any. */
  readonly deviceId?: string | null;
  readonly onSend: (text: string, meta: { readonly traceId: string }) => void;
  readonly onText: (text: string, meta: { readonly traceId: string }) => void;
  readonly onFallback: () => void;
  readonly onError: (message: string) => void;
  /** The microphone opened: the list of microphones can be read again, now with their names. */
  readonly onMicrophoneOpened?: () => void;
}

const FRAME_SAMPLES = 800; // 50 ms at 16 kHz
const SAMPLE_RATE = 16_000;
const TERMINATION_WAIT_MS = 4_000;
const LEVEL_BARS = 48;

/** The worklet: posts each block of microphone samples to the page. */
const WORKLET_SOURCE = `
class PcmCapture extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel) this.port.postMessage(channel.slice(0));
    return true;
  }
}
registerProcessor("pcm-capture", PcmCapture);
`;

/** Whether this browser can stream at all. */
export function liveDictationSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.WebSocket === "function" &&
    typeof window.AudioContext === "function" &&
    typeof window.AudioWorkletNode === "function" &&
    !!navigator.mediaDevices?.getUserMedia
  );
}

/** Float samples (-1..1) as 16-bit little-endian PCM. */
export function toPcm16(samples: Float32Array): ArrayBuffer {
  const buffer = new ArrayBuffer(samples.length * 2);
  const view = new DataView(buffer);
  for (let i = 0; i < samples.length; i += 1) {
    const s = Math.max(-1, Math.min(1, samples[i]!));
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buffer;
}

/** The live text: every turn's latest transcript, in turn order. */
export function joinTurns(turns: ReadonlyMap<number, string>): string {
  return [...turns.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, text]) => text.trim())
    .filter(Boolean)
    .join(" ");
}

interface Session {
  socket: WebSocket | null;
  context: AudioContext | null;
  stream: MediaStream | null;
  node: AudioWorkletNode | null;
  analyser: AnalyserNode | null;
  handle: string;
  turns: Map<number, string>;
  pending: Float32Array[];
  pendingLength: number;
  begun: boolean;
  startedAt: number;
  ended: boolean;
  termination: ((seconds: number | null) => void) | null;
  /** The loudest level heard (RMS), for "no sound came from your microphone". */
  peak: number;
  microphone: string;
}

async function post(body: Record<string, unknown>): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
  const response = await fetch("/api/chat/voice/stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    credentials: "same-origin",
  });
  const data = ((await response.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
  return { ok: response.ok, status: response.status, data };
}

export function useLiveDictation(options: LiveDictationOptions) {
  const [state, setState] = useState<LiveDictationState>({ kind: "idle" });
  const [levels, setLevels] = useState<number[]>(() => Array.from({ length: LEVEL_BARS }, () => 0));
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  });
  const session = useRef<Session | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const frame = useRef<number | null>(null);
  const maxSeconds = useRef(60);

  const where = useCallback(() => {
    const { surface, conversationId, meetingKey } = optionsRef.current;
    return {
      surface,
      ...(surface === "l10" ? { meetingKey: meetingKey ?? undefined } : conversationId ? { conversationId } : {}),
    };
  }, []);

  /** Releases the mic and the audio graph; the socket is closed by the caller. */
  const releaseAudio = useCallback((current: Session) => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    current.node?.port.close();
    current.node?.disconnect();
    current.analyser?.disconnect();
    for (const track of current.stream?.getTracks() ?? []) track.stop();
    void current.context?.close().catch(() => undefined);
    current.node = null;
    current.analyser = null;
    current.stream = null;
    current.context = null;
    setLevels(Array.from({ length: LEVEL_BARS }, () => 0));
  }, []);

  const flush = useCallback((current: Session, all = false) => {
    const socket = current.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    while (current.pendingLength >= FRAME_SAMPLES || (all && current.pendingLength > 0)) {
      const take = Math.min(FRAME_SAMPLES, current.pendingLength);
      const out = new Float32Array(take);
      let filled = 0;
      while (filled < take) {
        const head = current.pending[0]!;
        const need = take - filled;
        if (head.length <= need) {
          out.set(head, filled);
          filled += head.length;
          current.pending.shift();
        } else {
          out.set(head.subarray(0, need), filled);
          current.pending[0] = head.subarray(need);
          filled += need;
        }
      }
      current.pendingLength -= take;
      socket.send(toPcm16(out));
    }
  }, []);

  /** Ends the socket: Terminate, then wait for Termination (its session seconds), or give up after a few seconds. */
  const endSocket = useCallback(
    (current: Session): Promise<number | null> =>
      new Promise((resolve) => {
        const socket = current.socket;
        if (!socket || socket.readyState !== WebSocket.OPEN) {
          resolve(null);
          return;
        }
        flush(current, true);
        const done = setTimeout(() => {
          current.termination = null;
          resolve(null);
        }, TERMINATION_WAIT_MS);
        current.termination = (seconds) => {
          clearTimeout(done);
          current.termination = null;
          resolve(seconds);
        };
        try {
          socket.send(JSON.stringify({ type: "Terminate" }));
        } catch {
          clearTimeout(done);
          resolve(null);
        }
      }),
    [flush],
  );

  const closeSocket = (current: Session) => {
    try {
      current.socket?.close();
    } catch {
      /* already closed */
    }
    current.socket = null;
  };

  const elapsed = (current: Session) => (Date.now() - current.startedAt) / 1000;

  /** Ends the session and returns its final text and seconds. */
  const end = useCallback(
    async (current: Session) => {
      current.ended = true;
      releaseAudio(current);
      const reported = await endSocket(current);
      closeSocket(current);
      return { text: joinTurns(current.turns), seconds: reported ?? elapsed(current) };
    },
    [endSocket, releaseAudio],
  );

  const reset = useCallback(() => {
    session.current = null;
    setState({ kind: "idle" });
  }, []);

  /** ✓: end, correct the names on the server, send. With `toBox`, the words go into the box instead. */
  const finish = useCallback(
    async (toBox: boolean) => {
      const current = session.current;
      if (!current || current.ended) return;
      setState({ kind: "finishing", text: joinTurns(current.turns) });
      const { text, seconds } = await end(current);
      if (!text.trim()) {
        void post({ action: "finish", ...where(), session: current.handle, outcome: "discard", text: "", seconds }).catch(() => undefined);
        reset();
        // The microphone itself sent no sound (a quiet one still does): name it, so another can be picked.
        optionsRef.current.onError(current.peak <= SILENT_PEAK ? silentMicrophoneMessage(current.microphone) : VOICE_MESSAGES.nothingHeard);
        return;
      }
      try {
        const result = await post({ action: "finish", ...where(), session: current.handle, outcome: "send", text, seconds });
        const corrected = typeof result.data.text === "string" ? result.data.text : null;
        const traceId = typeof result.data.traceId === "string" ? result.data.traceId : "";
        reset();
        if (result.ok && corrected) {
          if (toBox) optionsRef.current.onText(corrected, { traceId });
          else optionsRef.current.onSend(corrected, { traceId });
          return;
        }
        // The names could not be checked: the words go into the box, for the person to check and send.
        optionsRef.current.onText(text, { traceId });
      } catch {
        reset();
        optionsRef.current.onText(text, { traceId: "" });
      }
    },
    [end, reset, where],
  );

  /** ✕: end and drop. */
  const cancel = useCallback(async () => {
    const current = session.current;
    if (!current || current.ended) return;
    const { seconds } = await end(current);
    reset();
    void post({ action: "finish", ...where(), session: current.handle, outcome: "discard", text: "", seconds }).catch(() => undefined);
  }, [end, reset, where]);

  const fallBack = useCallback(
    (current: Session | null) => {
      if (current) {
        current.ended = true;
        releaseAudio(current);
        closeSocket(current);
        void post({ action: "finish", ...where(), session: current.handle, outcome: "discard", text: "", seconds: 0 }).catch(() => undefined);
      }
      reset();
      optionsRef.current.onFallback();
    },
    [releaseAudio, reset, where],
  );

  const start = useCallback(async () => {
    if (session.current) return;
    if (!liveDictationSupported()) {
      optionsRef.current.onFallback();
      return;
    }
    setState({ kind: "connecting" });

    let started: Awaited<ReturnType<typeof post>>;
    try {
      started = await post({ action: "start", ...where() });
    } catch {
      fallBack(null);
      return;
    }
    if (!started.ok) {
      const code = started.data.code;
      if (code === "stream_unavailable" || started.status >= 500) {
        fallBack(null);
        return;
      }
      reset();
      optionsRef.current.onError(typeof started.data.error === "string" ? started.data.error : VOICE_MESSAGES.unavailable);
      return;
    }
    const socketUrl = started.data.socketUrl;
    const handle = started.data.session;
    if (typeof socketUrl !== "string" || typeof handle !== "string") {
      fallBack(null);
      return;
    }
    if (typeof started.data.maxSeconds === "number") maxSeconds.current = started.data.maxSeconds;

    const current: Session = {
      socket: null,
      context: null,
      stream: null,
      node: null,
      analyser: null,
      handle,
      turns: new Map(),
      pending: [],
      pendingLength: 0,
      begun: false,
      startedAt: Date.now(),
      ended: false,
      termination: null,
      peak: 0,
      microphone: "",
    };
    session.current = current;

    try {
      current.stream = await openMicrophone(optionsRef.current.deviceId, { echoCancellation: true, noiseSuppression: true, channelCount: 1 });
      current.microphone = microphoneName(current.stream);
      optionsRef.current.onMicrophoneOpened?.();
    } catch (error) {
      current.ended = true;
      session.current = null;
      void post({ action: "finish", ...where(), session: handle, outcome: "discard", text: "", seconds: 0 }).catch(() => undefined);
      setState({ kind: "idle" });
      const name = error instanceof DOMException ? error.name : "";
      optionsRef.current.onError(name === "NotAllowedError" || name === "SecurityError" ? VOICE_MESSAGES.micBlocked : VOICE_MESSAGES.unavailable);
      return;
    }

    try {
      const context = new AudioContext({ sampleRate: SAMPLE_RATE });
      current.context = context;
      const moduleUrl = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: "application/javascript" }));
      try {
        await context.audioWorklet.addModule(moduleUrl);
      } finally {
        URL.revokeObjectURL(moduleUrl);
      }
      const source = context.createMediaStreamSource(current.stream);
      const node = new AudioWorkletNode(context, "pcm-capture");
      const analyser = context.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      source.connect(node);
      current.node = node;
      current.analyser = analyser;
      node.port.onmessage = (event: MessageEvent<Float32Array>) => {
        if (current.ended) return;
        current.pending.push(event.data);
        current.pendingLength += event.data.length;
        flush(current);
      };
    } catch {
      fallBack(current);
      return;
    }

    const socket = new WebSocket(socketUrl);
    socket.binaryType = "arraybuffer";
    current.socket = socket;
    socket.onmessage = (event: MessageEvent) => {
      if (typeof event.data !== "string") return;
      let message: Record<string, unknown>;
      try {
        message = JSON.parse(event.data) as Record<string, unknown>;
      } catch {
        return;
      }
      if (message.type === "Begin") {
        current.begun = true;
        current.startedAt = Date.now();
        setState({ kind: "live", seconds: 0, text: "" });
        flush(current);
      } else if (message.type === "Turn" && typeof message.turn_order === "number" && typeof message.transcript === "string") {
        current.turns.set(message.turn_order, message.transcript);
        if (!current.ended) setState((previous) => (previous.kind === "live" ? { ...previous, text: joinTurns(current.turns) } : previous));
      } else if (message.type === "Termination") {
        const seconds = typeof message.session_duration_seconds === "number" ? message.session_duration_seconds : null;
        current.termination?.(seconds);
      }
    };
    socket.onerror = () => {
      if (!current.begun) fallBack(current);
    };
    socket.onclose = () => {
      current.termination?.(null);
      if (!current.begun && !current.ended) {
        fallBack(current);
        return;
      }
      if (!current.ended) void finish(true);
    };

    timer.current = setInterval(() => {
      if (!current.begun || current.ended) return;
      const seconds = elapsed(current);
      // At the limit the words go into the box for the person to check, as a recording does.
      if (seconds >= maxSeconds.current) void finish(true);
      else setState((previous) => (previous.kind === "live" ? { ...previous, seconds } : previous));
    }, 250);

    // Float samples, not bytes: 8-bit levels round a quiet microphone down to zero.
    const samples = new Float32Array(current.analyser?.fftSize ?? 512);
    let last = 0;
    const tick = (now: number) => {
      if (current.ended || !current.analyser) return;
      if (now - last > 60) {
        last = now;
        current.analyser.getFloatTimeDomainData(samples);
        let sum = 0;
        for (const value of samples) sum += value * value;
        const rms = Math.sqrt(sum / samples.length);
        current.peak = Math.max(current.peak, rms);
        const level = Math.min(1, rms * 4);
        setLevels((previous) => [...previous.slice(1), level]);
      }
      frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
  }, [fallBack, finish, flush, reset, where]);

  // The tab hidden: the words so far go into the box. Leaving the page: the session is dropped.
  useEffect(() => {
    const onHidden = () => {
      if (document.visibilityState === "hidden" && session.current && !session.current.ended) void finish(true);
    };
    document.addEventListener("visibilitychange", onHidden);
    return () => {
      document.removeEventListener("visibilitychange", onHidden);
      const current = session.current;
      if (current && !current.ended) {
        current.ended = true;
        releaseAudio(current);
        try {
          if (current.socket?.readyState === WebSocket.OPEN) current.socket.send(JSON.stringify({ type: "Terminate" }));
        } catch {
          /* closing */
        }
        closeSocket(current);
      }
    };
  }, [finish, releaseAudio]);

  return { state, levels, start, send: () => finish(false), cancel };
}
