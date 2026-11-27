// @vitest-environment jsdom
import * as React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { acceptVoiceNotice, installFakeMic, removeFakeMic } from "@/test/fake-mic";

import { joinTurns, toPcm16 } from "./use-live-dictation";
import { VoiceAccessProvider } from "./voice-access";
import { VoiceButton } from "./voice-button";
import { appendTranscript } from "./voice-draft";

/*
 * VOICE_INPUT_ENABLED, live dictation. The owner, 27 Nov 2026: "it transcribes as you talk then when done, press check
 * mark and auto send", and "i said Curt, it spelled it as Kurt" (here invented: "Cade Holloway", heard as "Kade").
 * The socket, the audio graph and the stream route are fakes; the words arrive as AssemblyAI's `Turn` messages do.
 */

class FakeSocket {
  static last: FakeSocket | null = null;
  static readonly OPEN = 1;
  readyState = 0;
  binaryType = "blob";
  sent: unknown[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(readonly url: string) {
    FakeSocket.last = this;
  }
  send(data: unknown) {
    this.sent.push(data);
    if (typeof data === "string" && JSON.parse(data).type === "Terminate") {
      queueMicrotask(() => this.say({ type: "Termination", audio_duration_seconds: 4, session_duration_seconds: 4.5 }));
    }
  }
  close() {
    this.readyState = 3;
  }
  open() {
    this.readyState = 1;
    this.say({ type: "Begin", id: "s1", expires_at: 0 });
  }
  say(message: Record<string, unknown>) {
    act(() => this.onmessage?.({ data: JSON.stringify(message) } as MessageEvent));
  }
}

class FakeAudioContext {
  audioWorklet = { addModule: vi.fn(async () => undefined) };
  constructor(readonly options: { sampleRate: number }) {}
  createMediaStreamSource() {
    return { connect: vi.fn() };
  }
  createAnalyser() {
    return { fftSize: 512, connect: vi.fn(), disconnect: vi.fn(), getByteTimeDomainData: (array: Uint8Array) => array.fill(128) };
  }
  close = vi.fn(async () => undefined);
}

class FakeWorkletNode {
  port = { onmessage: null as unknown, close: vi.fn() };
  disconnect = vi.fn();
}

let routeCalls: Record<string, unknown>[];
let startAnswer: () => Response;

function Host({ onSend }: { onSend: (text: string, traceId: string) => void }) {
  const [value, setValue] = React.useState("");
  const [slot, setSlot] = React.useState<HTMLDivElement | null>(null);
  const [live, setLive] = React.useState<HTMLDivElement | null>(null);
  return (
    <VoiceAccessProvider enabled userKey="user-ada">
      <div style={{ position: "relative" }}>
        <div ref={setLive} data-testid="live-slot" />
        <textarea aria-label="Box" value={value} onChange={(event) => setValue(event.target.value)} />
        <VoiceButton
          surface="chat"
          messageSlot={slot}
          liveSlot={live}
          onSend={(text, { traceId }) => onSend(text, traceId)}
          onText={(text) => setValue((current) => appendTranscript(current, text))}
        />
      </div>
      <div ref={setSlot} />
    </VoiceAccessProvider>
  );
}

beforeEach(() => {
  window.localStorage.clear();
  const mic = installFakeMic();
  acceptVoiceNotice();
  routeCalls = [];
  startAnswer = () =>
    Response.json({ socketUrl: "wss://streaming.assemblyai.com/v3/ws?token=t&sample_rate=16000&encoding=pcm_s16le", session: "usage-1.sig", maxSeconds: 60 });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/chat/voice/stream") {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        routeCalls.push(body);
        if (body.action === "start") return startAnswer();
        // The server respells the names: "Kade" is the directory's "Cade".
        return Response.json(
          body.outcome === "send" ? { text: String(body.text).replace("Kade", "Cade"), traceId: "usage-1" } : { traceId: "usage-1" },
        );
      }
      return (mic.fetch as unknown as typeof fetch)(url, init);
    }),
  );
  vi.stubGlobal("WebSocket", FakeSocket);
  vi.stubGlobal("AudioContext", FakeAudioContext);
  vi.stubGlobal("AudioWorkletNode", FakeWorkletNode);
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal("cancelAnimationFrame", () => undefined);
  FakeSocket.last = null;
});

afterEach(() => {
  cleanup();
  removeFakeMic();
  vi.unstubAllGlobals();
});

async function startDictating() {
  fireEvent.click(screen.getByRole("button", { name: "Speak your message" }));
  await waitFor(() => expect(FakeSocket.last).not.toBeNull());
  FakeSocket.last!.open();
}

describe('"it transcribes as you talk then when done, press check mark and auto send"', () => {
  it("the words appear as they are said, in the dictating box over the input", async () => {
    render(<Host onSend={vi.fn()} />);
    await startDictating();
    expect(screen.getByTestId("live-dictation")).toBeTruthy();
    FakeSocket.last!.say({ type: "Turn", turn_order: 0, transcript: "Hey can you", end_of_turn: false });
    expect(screen.getByTestId("live-dictation-text").textContent).toBe("Hey can you");
    FakeSocket.last!.say({ type: "Turn", turn_order: 0, transcript: "Hey can you create a CA for Kade Holloway please", end_of_turn: false });
    expect(screen.getByTestId("live-dictation-text").textContent).toBe("Hey can you create a CA for Kade Holloway please");
    expect(screen.getByRole("button", { name: "Cancel dictation" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Send" })).toBeTruthy();
    expect(screen.getByTestId("live-dictation-wave")).toBeTruthy();
  });

  it("✓ sends straight away, with the names spelled as the directory spells them (i said Cade, it heard Kade)", async () => {
    const onSend = vi.fn();
    render(<Host onSend={onSend} />);
    await startDictating();
    FakeSocket.last!.say({ type: "Turn", turn_order: 0, transcript: "Hey can you create a CA for Kade Holloway please", end_of_turn: true });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(onSend).toHaveBeenCalledWith("Hey can you create a CA for Cade Holloway please", "usage-1"));
    expect(FakeSocket.last!.sent.some((data) => typeof data === "string" && JSON.parse(data).type === "Terminate")).toBe(true);
    expect(routeCalls.at(-1)).toMatchObject({ action: "finish", outcome: "send", seconds: 4.5 });
    expect(screen.queryByTestId("live-dictation")).toBeNull();
  });

  it("✕ stops and drops: nothing is sent, and the box is untouched", async () => {
    const onSend = vi.fn();
    render(<Host onSend={onSend} />);
    await startDictating();
    FakeSocket.last!.say({ type: "Turn", turn_order: 0, transcript: "never mind", end_of_turn: true });
    fireEvent.click(screen.getByRole("button", { name: "Cancel dictation" }));
    await waitFor(() => expect(routeCalls.at(-1)).toMatchObject({ action: "finish", outcome: "discard" }));
    expect(onSend).not.toHaveBeenCalled();
    expect((screen.getByRole("textbox", { name: "Box" }) as HTMLTextAreaElement).value).toBe("");
    expect(screen.queryByTestId("live-dictation")).toBeNull();
  });

  it("several turns read as one message, in order", () => {
    expect(joinTurns(new Map([[1, "second part"], [0, "First part"]]))).toBe("First part second part");
  });

  it("the audio is 16-bit little-endian PCM", () => {
    const pcm = new DataView(toPcm16(new Float32Array([0, 1, -1])));
    expect([pcm.getInt16(0, true), pcm.getInt16(2, true), pcm.getInt16(4, true)]).toEqual([0, 32767, -32768]);
  });
});

describe("when live dictation cannot start, the same press records instead", () => {
  it("the server will not start a stream: the recording starts", async () => {
    startAnswer = () => Response.json({ code: "stream_unavailable", error: "x" }, { status: 503 });
    render(<Host onSend={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Speak your message" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Stop recording" })).toBeTruthy());
    expect(screen.queryByTestId("live-dictation")).toBeNull();
  });

  it("a refusal (the day's limit) is said, not recorded around", async () => {
    startAnswer = () => Response.json({ code: "user_day", error: "You have used today's voice limit. Type your message instead." }, { status: 429 });
    render(<Host onSend={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Speak your message" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/today's voice limit/));
  });
});

describe("reduced motion", () => {
  it("the bars do not move: a still row and the word 'Listening'", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("reduce"), addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    render(<Host onSend={vi.fn()} />);
    await startDictating();
    expect(screen.getByTestId("live-dictation-still")).toBeTruthy();
    expect(screen.queryByTestId("live-dictation-wave")).toBeNull();
    expect(screen.getByTestId("live-dictation-timer").textContent).toMatch(/Listening/);
  });
});
