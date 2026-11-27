// @vitest-environment jsdom
import * as React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { VOICE_CHECK, VOICE_HINT, VOICE_MESSAGES, VOICE_NOTICE } from "@/lib/voice/voice-messages";
import { FakeMediaRecorder, acceptVoiceNotice, installFakeMic, removeFakeMic, type FakeMic } from "@/test/fake-mic";

import { VoiceAccessProvider } from "./voice-access";
import { VoiceButton } from "./voice-button";
import { appendTranscript } from "./voice-draft";

/*
 * VOICE_INPUT_ENABLED: the shared mic button, with a fake MediaRecorder, a fake voice route and fake timers. The
 * host here is a plain text box, as each chat box is: the button hands it the transcript and it appends.
 */

function Host({ initial = "", disabled = false, onText }: { initial?: string; disabled?: boolean; onText?: (text: string, traceId: string) => void }) {
  const [value, setValue] = React.useState(initial);
  const [slot, setSlot] = React.useState<HTMLDivElement | null>(null);
  return (
    <div>
      <textarea aria-label="Box" value={value} onChange={(event) => setValue(event.target.value)} />
      <VoiceButton
        surface="chat"
        conversationId="conv_mvn0000000000aaaa"
        disabled={disabled}
        messageSlot={slot}
        onText={(text, { traceId }) => {
          setValue((current) => appendTranscript(current, text));
          onText?.(text, traceId);
        }}
      />
      <div ref={setSlot} data-testid="slot" />
    </div>
  );
}

function renderOn(element: React.ReactElement, enabled = true) {
  return render(
    <VoiceAccessProvider enabled={enabled} userKey="user-ada">
      {element}
    </VoiceAccessProvider>,
  );
}

const mic = () => screen.queryByRole("button", { name: /speak your message|stop recording|transcribing|waiting for the microphone/i });
const box = () => screen.getByRole("textbox", { name: "Box" }) as HTMLTextAreaElement;

async function flush(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

let fake: FakeMic;

beforeEach(() => {
  vi.useFakeTimers();
  window.localStorage.clear();
  fake = installFakeMic();
  acceptVoiceNotice();
});

afterEach(() => {
  cleanup();
  removeFakeMic();
  vi.useRealTimers();
  Object.defineProperty(navigator, "userAgent", { configurable: true, value: "Mozilla/5.0 (jsdom)" });
});

describe("when the mic shows", () => {
  it("not when voice is off for this person (or there is no provider)", () => {
    renderOn(<Host />, false);
    expect(mic()).toBeNull();
    cleanup();
    render(<Host />);
    expect(mic()).toBeNull();
  });

  it("not when the browser cannot record", () => {
    removeFakeMic();
    renderOn(<Host />);
    expect(mic()).toBeNull();
  });

  it("not in Slack's, Teams' or Gmail's in-app browser", () => {
    for (const agent of ["Mozilla/5.0 Slack/4.41 Electron", "Mozilla/5.0 Teams/24 Chrome", "Mozilla/5.0 (iPhone) Gmail/6.0"]) {
      Object.defineProperty(navigator, "userAgent", { configurable: true, value: agent });
      renderOn(<Host />);
      expect(mic()).toBeNull();
      cleanup();
    }
  });

  it("the hint shows the whole time the mic does, and never without it", () => {
    renderOn(<Host />);
    expect(screen.getByTestId("voice-hint").textContent).toBe(VOICE_HINT);
    cleanup();
    renderOn(<Host />, false);
    expect(screen.queryByText(VOICE_HINT)).toBeNull();
  });

  it("disabled when the box says so", () => {
    renderOn(<Host disabled />);
    expect((mic() as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("recording", () => {
  it("tap to start, a visible timer, tap to stop: the text is appended to what was typed", async () => {
    const onText = vi.fn();
    renderOn(<Host initial="about" onText={onText} />);
    fireEvent.click(mic()!);
    await flush();
    expect(fake.getUserMedia).toHaveBeenCalledWith({ audio: true });
    expect(FakeMediaRecorder.instances[0]!.mimeType).toBe("audio/webm;codecs=opus");
    expect(screen.getByText(VOICE_HINT)).toBeTruthy();
    expect(fake.wakeLock.request).toHaveBeenCalledWith("screen");
    await flush(3_100);
    expect(screen.getByTestId("voice-timer").textContent).toBe("0:03");
    fireEvent.click(screen.getByRole("button", { name: "Stop recording" }));
    await flush();
    expect(fake.track.stop).toHaveBeenCalled();
    expect(fake.fetch).toHaveBeenCalledTimes(1);
    expect(fake.fetch.mock.calls[0]![0]).toBe("/api/chat/voice");
    const form = fake.lastForm()!;
    expect(form.get("surface")).toBe("chat");
    expect(Number(form.get("clipSeconds"))).toBeGreaterThan(3);
    expect(form.get("conversationId")).toBe("conv_mvn0000000000aaaa");
    expect([...form.keys()]).toEqual(["surface", "clipSeconds", "conversationId", "audio"]);
    await flush();
    expect(box().value).toBe("about spoken words from ada");
    expect(onText).toHaveBeenCalledWith("spoken words from ada", "6f1c2b3a-1111-4222-8333-444455556666");
    expect(screen.getByText(VOICE_CHECK)).toBeTruthy();
  });

  it("warns at 50 seconds and stops itself at 60", async () => {
    renderOn(<Host />);
    fireEvent.click(mic()!);
    await flush();
    await flush(50_100);
    expect(screen.getByText(/10 seconds left\. Recording stops at 60 seconds\./)).toBeTruthy();
    expect(fake.fetch).not.toHaveBeenCalled();
    await flush(10_000);
    expect(fake.fetch).toHaveBeenCalledTimes(1);
    expect(Number(fake.lastForm()!.get("clipSeconds"))).toBeLessThanOrEqual(60);
    await flush();
    expect(box().value).toBe("spoken words from ada");
  });

  it("the mic blocked: the sentence, as an alert", async () => {
    fake.getUserMedia.mockRejectedValueOnce(new DOMException("denied", "NotAllowedError"));
    renderOn(<Host />);
    fireEvent.click(mic()!);
    await flush();
    expect(screen.getByRole("alert").textContent).toBe(VOICE_MESSAGES.micBlocked);
  });

  it("waits at most 15 seconds for permission", async () => {
    fake.getUserMedia.mockImplementationOnce(() => new Promise(() => undefined));
    renderOn(<Host />);
    fireEvent.click(mic()!);
    await flush(14_000);
    expect(screen.queryByRole("alert")).toBeNull();
    await flush(1_100);
    expect(screen.getByRole("alert").textContent).toBe(VOICE_MESSAGES.micBlocked);
  });

  it("a clip cut off (the track ended) after more than half a second: 'Transcribe this' or 'Try again'", async () => {
    renderOn(<Host />);
    fireEvent.click(mic()!);
    await flush(2_000);
    act(() => fake.track.onended?.());
    await flush();
    expect(fake.fetch).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Transcribe this" }));
    await flush();
    expect(fake.fetch).toHaveBeenCalledTimes(1);
    await flush();
    expect(box().value).toBe("spoken words from ada");
  });

  it("the track muted: offered the same way; 'Try again' records afresh", async () => {
    renderOn(<Host />);
    fireEvent.click(mic()!);
    await flush(2_000);
    act(() => fake.track.onmute?.());
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await flush();
    expect(fake.getUserMedia).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("button", { name: "Stop recording" })).toBeTruthy();
  });

  it("the tab hidden: the mic is released", async () => {
    renderOn(<Host />);
    fireEvent.click(mic()!);
    await flush(2_000);
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await flush();
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    expect(fake.track.stop).toHaveBeenCalled();
    expect(fake.fetch).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Transcribe this" })).toBeTruthy();
  });

  it("a failure keeps what was typed, and says why", async () => {
    fake.respond(() => Response.json({ error: VOICE_MESSAGES.busy, code: "busy", retryAfterSeconds: 5 }, { status: 429 }));
    renderOn(<Host initial="typed before" />);
    fireEvent.click(mic()!);
    await flush(2_000);
    fireEvent.click(screen.getByRole("button", { name: "Stop recording" }));
    await flush();
    await flush();
    expect(screen.getByRole("alert").textContent).toBe(VOICE_MESSAGES.busy);
    expect(box().value).toBe("typed before");
  });

  it("a network failure is never a blank message", async () => {
    fake.respond(() => Promise.reject(new TypeError("Failed to fetch")));
    renderOn(<Host initial="typed" />);
    fireEvent.click(mic()!);
    await flush(2_000);
    fireEvent.click(screen.getByRole("button", { name: "Stop recording" }));
    await flush();
    await flush();
    expect(screen.getByRole("alert").textContent).toBe(VOICE_MESSAGES.unavailable);
    expect(box().value).toBe("typed");
  });
});

describe("the first-use notice", () => {
  it("shows once per person until they choose; 'Not now' records nothing; 'OK, use voice' starts and is remembered", async () => {
    window.localStorage.clear();
    renderOn(<Host />);
    fireEvent.click(mic()!);
    expect(screen.getByText(VOICE_NOTICE)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect(fake.getUserMedia).not.toHaveBeenCalled();
    expect(screen.queryByText(VOICE_NOTICE)).toBeNull();
    fireEvent.click(mic()!);
    fireEvent.click(screen.getByRole("button", { name: "OK, use voice" }));
    await flush();
    expect(fake.getUserMedia).toHaveBeenCalledTimes(1);
    expect(window.localStorage.getItem("ask-sunny:voice-consent:user-ada")).toBe("accepted");
    fireEvent.click(screen.getByRole("button", { name: "Stop recording" }));
    await flush();
    await flush();
    fireEvent.click(mic()!);
    await flush();
    expect(screen.queryByText(VOICE_NOTICE)).toBeNull();
    expect(fake.getUserMedia).toHaveBeenCalledTimes(2);
  });

  it("another person in the same browser is asked for themselves", async () => {
    render(
      <VoiceAccessProvider enabled userKey="user-bea">
        <Host />
      </VoiceAccessProvider>,
    );
    fireEvent.click(mic()!);
    expect(screen.getByText(VOICE_NOTICE)).toBeTruthy();
  });
});
