// @vitest-environment jsdom
import * as React from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { Providers } from "@/app/providers";
import { VoiceAccessProvider } from "@/features/voice/voice-access";
import { MockAIProvider } from "@/lib/ai/mock-provider";
import type { AskResponse, ClientAskRequest } from "@/lib/ai/types";
import { acceptVoiceNotice, installFakeMic, removeFakeMic, type FakeMic } from "@/test/fake-mic";
import { ChatScreen } from "./chat-screen";

/*
 * VOICE_INPUT_ENABLED, box A: the main chat's Composer, on the chat screen. The mic shows only when voice is on for
 * the person, sits in the input pill, is off while a turn is in flight, appends the transcript to the composer's
 * text, and Send is unchanged apart from saying the text came from voice (and whether it was edited). Every person
 * here is invented.
 */

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_DEMO_MODE = "true";
});

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(window.location.search),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn() }),
}));

beforeAll(() => {
  if (!("ResizeObserver" in globalThis)) {
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
  for (const name of ["hasPointerCapture", "setPointerCapture", "releasePointerCapture"] as const) {
    if (!(name in Element.prototype)) Object.defineProperty(Element.prototype, name, { value: () => false, writable: true });
  }
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
});

let fake: FakeMic;
let asks: ClientAskRequest[];
let hold: Promise<void> | null;

beforeEach(() => {
  window.history.replaceState(null, "", "/chat");
  window.localStorage.clear();
  fake = installFakeMic();
  acceptVoiceNotice("user-ada");
  asks = [];
  hold = null;
  vi.spyOn(MockAIProvider.prototype, "ask").mockImplementation(async (request: ClientAskRequest) => {
    asks.push(request);
    if (hold) await hold;
    return { content: "Here is the answer.", citations: [], coverage: "not_applicable", recommendedVideoIds: [] } as AskResponse;
  });
});

afterEach(() => {
  cleanup();
  removeFakeMic();
  vi.restoreAllMocks();
});

const HINT = "Voice sends your recording to AssemblyAI to make text.";
const screenWith = (enabled: boolean) =>
  render(
    <VoiceAccessProvider enabled={enabled} userKey="user-ada">
      <Providers>
        <ChatScreen />
      </Providers>
    </VoiceAccessProvider>,
  );
const input = async () => (await screen.findByPlaceholderText(/ask about policy/i)) as HTMLTextAreaElement;
const mic = () => screen.queryByRole("button", { name: "Speak your message" }) as HTMLButtonElement | null;

async function speak(user: ReturnType<typeof userEvent.setup>) {
  await user.click(mic()!);
  const stop = await screen.findByRole("button", { name: "Stop recording" });
  await new Promise((resolve) => setTimeout(resolve, 600));
  await user.click(stop);
  await screen.findByText("Check the words, then press Send");
}

describe("box A: the main chat composer", () => {
  it("no mic when voice is off", async () => {
    screenWith(false);
    await input();
    expect(mic()).toBeNull();
    expect(screen.queryByText(HINT)).toBeNull();
  });

  it("a mic in the input pill when on; the transcript is appended; Send says it came from voice, unedited", async () => {
    const user = userEvent.setup();
    screenWith(true);
    const box = await input();
    await user.type(box, "quick one:");
    expect(screen.getByText(HINT)).toBeTruthy();
    await speak(user);
    expect(box.value).toBe("quick one: spoken words from ada");
    expect(document.activeElement).toBe(box);
    expect(fake.lastForm()!.get("surface")).toBe("chat");
    await user.click(screen.getByRole("button", { name: "Send message" }));
    await waitFor(() => expect(asks).toHaveLength(1));
    // The sent text differs from the transcript (typed words came first), so it counts as edited.
    expect(asks[0]).toMatchObject({ question: "quick one: spoken words from ada", surface: "main_chat", inputMode: "voice", voiceEdited: true });
    expect(asks[0]!.voiceTraceId).toBe("6f1c2b3a-1111-4222-8333-444455556666");
  });

  it("the transcript sent as it came: voiceEdited is false; the next typed question has no voice fields", async () => {
    const user = userEvent.setup();
    screenWith(true);
    const box = await input();
    await speak(user);
    await user.click(screen.getByRole("button", { name: "Send message" }));
    await waitFor(() => expect(asks).toHaveLength(1));
    expect(asks[0]).toMatchObject({ question: "spoken words from ada", inputMode: "voice", voiceEdited: false });
    await waitFor(() => expect(box.disabled).toBe(false));
    await user.type(box, "and a typed follow-up{Enter}");
    await waitFor(() => expect(asks).toHaveLength(2));
    expect(asks[1]).not.toHaveProperty("inputMode");
    expect(asks[1]).not.toHaveProperty("voiceEdited");
  });

  it("the mic is disabled while a turn is in flight; the next clip names the conversation", async () => {
    const user = userEvent.setup();
    let release!: () => void;
    hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    screenWith(true);
    await user.type(await input(), "what is the dress code{Enter}");
    await waitFor(() => expect(asks).toHaveLength(1));
    expect(mic()!.disabled).toBe(true);
    release();
    await waitFor(() => expect(mic()!.disabled).toBe(false));
    hold = null;
    await speak(user);
    expect(fake.lastForm()!.get("conversationId")).toBe(asks[0]!.conversationId);
  });
});
