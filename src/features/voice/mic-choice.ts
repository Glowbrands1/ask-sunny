"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * ============================================================================
 * WHICH MICROPHONE (VOICE_INPUT_ENABLED)
 * ============================================================================
 *
 * The owner, 27 Nov 2026: "i think i need to choose which mic because i have usb mic not built in". The browser's own
 * default microphone is not always the one a person speaks into. When this browser has more than one, a small
 * "Microphone" choice lists them (their names appear once the browser has been allowed to use a microphone, so the
 * list is read again after the first recording starts and whenever a device is plugged in or out). The choice is kept
 * in this browser only. A saved microphone that is no longer there is never forced: the default is used instead.
 *
 * The owner again, 27 Nov 2026: "i still cant pick a microfphone to use". Until the browser has been allowed a
 * microphone it lists one nameless device with no id (Chrome, Safari), so there was nothing to choose and the choice was
 * hidden. Now the choice always shows while voice is on; opening it reads the list again, and when the names are still
 * hidden it asks for the microphone once (the browser's own prompt), then reads the list with the names. The options
 * are dark on light, readable in every browser's own dropdown.
 *
 * And "I did not hear anything" is said only when the provider heard nothing. When the microphone itself sent no
 * sound at all (its level stayed at zero, which a quiet USB microphone does not do), the message names the microphone
 * that was used and says to pick another.
 */

export const MIC_STORAGE_KEY = "ask-sunny:voice-microphone";

/** At or below this peak level (RMS, 0..1) the microphone sent no sound at all: digital silence, not a quiet voice. */
export const SILENT_PEAK = 0.0005;

export interface Microphone {
  readonly id: string;
  readonly label: string;
}

export function readSavedMicrophone(): string | null {
  try {
    return window.localStorage.getItem(MIC_STORAGE_KEY) || null;
  } catch {
    return null;
  }
}

export function saveMicrophone(id: string | null): void {
  try {
    if (id) window.localStorage.setItem(MIC_STORAGE_KEY, id);
    else window.localStorage.removeItem(MIC_STORAGE_KEY);
  } catch {
    /* A private window: the default microphone is used next time. */
  }
}

export interface MicrophoneList {
  readonly microphones: Microphone[];
  /** The browser hides the microphones' names (and ids) until it has been allowed one. */
  readonly namesHidden: boolean;
}

/** The microphones this browser lists (ids it hides before permission are left out). */
export async function readMicrophones(): Promise<MicrophoneList> {
  const devices = (await navigator.mediaDevices?.enumerateDevices?.().catch(() => [])) ?? [];
  const inputs = devices.filter((device) => device.kind === "audioinput");
  const microphones = inputs
    .filter((device) => device.deviceId && device.deviceId !== "default" && device.deviceId !== "communications")
    .map((device, index) => ({ id: device.deviceId, label: device.label || `Microphone ${index + 1}` }));
  const namesHidden = inputs.length > 0 && inputs.every((device) => !device.label);
  return { microphones, namesHidden };
}

export async function listMicrophones(): Promise<Microphone[]> {
  return (await readMicrophones()).microphones;
}

/** Asks for the microphone (the browser's prompt) only so it shows the microphones' names; nothing is recorded. */
async function allowMicrophoneNames(): Promise<boolean> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    for (const track of stream.getTracks()) track.stop();
    return true;
  } catch {
    return false;
  }
}

function deviceGone(error: unknown): boolean {
  const name = error instanceof DOMException || error instanceof Error ? error.name : "";
  return name === "OverconstrainedError" || name === "NotFoundError" || name === "NotReadableError";
}

/**
 * Opens the chosen microphone, or the default when none is chosen. A chosen microphone that is not there (unplugged,
 * renamed) falls back to the default instead of failing.
 */
export async function openMicrophone(deviceId: string | null | undefined, extra: MediaTrackConstraints = {}): Promise<MediaStream> {
  if (deviceId) {
    try {
      return await navigator.mediaDevices.getUserMedia({ audio: { ...extra, deviceId: { exact: deviceId } } });
    } catch (error) {
      if (!deviceGone(error)) throw error;
    }
  }
  return navigator.mediaDevices.getUserMedia({ audio: Object.keys(extra).length > 0 ? extra : true });
}

/** The name of the microphone a stream is using, for the "no sound" message. */
export function microphoneName(stream: MediaStream | null): string {
  const label = stream?.getAudioTracks()[0]?.label?.trim();
  return label || "the default microphone";
}

/** The message when the microphone itself sent no sound. */
export function silentMicrophoneMessage(name: string): string {
  return `No sound came from your microphone (${name}). Choose another microphone and try again.`;
}

/**
 * Peak input level of a stream, measured while it records. Returns a stop function that answers the peak (0..1 RMS),
 * or null when this browser cannot measure (then the message is never the "no sound" one).
 */
export function measurePeak(stream: MediaStream): () => number | null {
  if (typeof window === "undefined" || typeof window.AudioContext !== "function") return () => null;
  let context: AudioContext;
  try {
    context = new AudioContext();
  } catch {
    return () => null;
  }
  let peak = 0;
  let timer: ReturnType<typeof setInterval> | null = null;
  try {
    const source = context.createMediaStreamSource(stream);
    const analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    source.connect(analyser);
    const samples = new Float32Array(analyser.fftSize);
    timer = setInterval(() => {
      analyser.getFloatTimeDomainData(samples);
      let sum = 0;
      for (const value of samples) sum += value * value;
      peak = Math.max(peak, Math.sqrt(sum / samples.length));
    }, 100);
  } catch {
    void context.close().catch(() => undefined);
    return () => null;
  }
  return () => {
    if (timer) clearInterval(timer);
    void context.close().catch(() => undefined);
    return peak;
  };
}

/** The microphones and the one chosen in this browser; follows devices being plugged in and out. */
export function useMicrophones() {
  const [microphones, setMicrophones] = useState<Microphone[]>([]);
  const [saved, setSaved] = useState<string | null>(() => (typeof window === "undefined" ? null : readSavedMicrophone()));
  const asked = useRef(false);

  const refresh = useCallback(async () => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.enumerateDevices) return;
    setMicrophones(await listMicrophones());
  }, []);

  /** The choice is opened: read the list again; when the names are hidden, ask for the microphone once, then read it. */
  const open = useCallback(async () => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.enumerateDevices) return;
    const first = await readMicrophones();
    setMicrophones(first.microphones);
    if (!first.namesHidden || asked.current) return;
    asked.current = true;
    if (await allowMicrophoneNames()) setMicrophones(await listMicrophones());
  }, []);

  const supported = typeof navigator !== "undefined" && typeof navigator.mediaDevices?.enumerateDevices === "function";

  // The list now, and again whenever a device is plugged in or out (state is set only when the browser answers).
  useEffect(() => {
    const devices = typeof navigator === "undefined" ? undefined : navigator.mediaDevices;
    if (!devices?.enumerateDevices) return;
    let alive = true;
    const read = () => {
      void listMicrophones().then((list) => {
        if (alive) setMicrophones(list);
      });
    };
    read();
    devices.addEventListener?.("devicechange", read);
    return () => {
      alive = false;
      devices.removeEventListener?.("devicechange", read);
    };
  }, []);

  const choose = useCallback((id: string | null) => {
    saveMicrophone(id);
    setSaved(id);
  }, []);

  // A saved microphone that is not plugged in now: the default is used (the choice comes back with the device).
  const chosen = saved && microphones.some((microphone) => microphone.id === saved) ? saved : null;
  return { microphones, chosen, choose, refresh, open, supported };
}
