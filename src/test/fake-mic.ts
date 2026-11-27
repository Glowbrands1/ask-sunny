import { vi } from "vitest";

/*
 * VOICE_INPUT_ENABLED: a fake microphone, MediaRecorder and voice route for the DOM tests. Test-only: nothing in the
 * app imports this file.
 */

export interface FakeTrack {
  stop: ReturnType<typeof vi.fn>;
  onended: (() => void) | null;
  onmute: (() => void) | null;
}

export class FakeMediaRecorder {
  static supported = new Set(["audio/webm;codecs=opus"]);
  static instances: FakeMediaRecorder[] = [];
  static isTypeSupported(type: string): boolean {
    return FakeMediaRecorder.supported.has(type);
  }
  state: "inactive" | "recording" = "inactive";
  readonly mimeType: string;
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  constructor(_stream: unknown, options?: { mimeType?: string }) {
    this.mimeType = options?.mimeType ?? "audio/webm";
    FakeMediaRecorder.instances.push(this);
  }
  start() {
    this.state = "recording";
  }
  stop() {
    if (this.state === "inactive") return;
    this.state = "inactive";
    const bytes = new Uint8Array(4096).fill(1);
    bytes.set([0x1a, 0x45, 0xdf, 0xa3]);
    this.ondataavailable?.({ data: new Blob([bytes], { type: this.mimeType }) });
    this.onstop?.();
  }
}

export interface FakeMic {
  track: FakeTrack;
  getUserMedia: ReturnType<typeof vi.fn>;
  fetch: ReturnType<typeof vi.fn>;
  wakeLock: { request: ReturnType<typeof vi.fn>; released: ReturnType<typeof vi.fn> };
  /** The form the last upload sent. */
  lastForm(): FormData | null;
  respond(next: () => Response | Promise<Response>): void;
}

export function installFakeMic(): FakeMic {
  FakeMediaRecorder.instances = [];
  FakeMediaRecorder.supported = new Set(["audio/webm;codecs=opus"]);
  const track: FakeTrack = { stop: vi.fn(), onended: null, onmute: null };
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
  const getUserMedia = vi.fn(async () => stream);
  let reply: () => Response | Promise<Response> = () => Response.json({ text: "spoken words from ada", traceId: "6f1c2b3a-1111-4222-8333-444455556666" });
  let form: FormData | null = null;
  const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
    form = (init?.body as FormData) ?? null;
    return reply();
  });
  const released = vi.fn(async () => undefined);
  const wakeLock = { request: vi.fn(async () => ({ release: released })), released };
  Object.defineProperty(window, "MediaRecorder", { configurable: true, writable: true, value: FakeMediaRecorder });
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia } });
  Object.defineProperty(navigator, "wakeLock", { configurable: true, value: wakeLock });
  vi.stubGlobal("fetch", fetch);
  return {
    track,
    getUserMedia,
    fetch,
    wakeLock,
    lastForm: () => form,
    respond(next) {
      reply = next;
    },
  };
}

export function removeFakeMic(): void {
  Reflect.deleteProperty(window, "MediaRecorder");
  Reflect.deleteProperty(navigator, "mediaDevices");
  Reflect.deleteProperty(navigator, "wakeLock");
  vi.unstubAllGlobals();
}

/** The first-use notice already accepted for this person. */
export function acceptVoiceNotice(userKey = "user-ada"): void {
  window.localStorage.setItem(`ask-sunny:voice-consent:${userKey}`, "accepted");
}
