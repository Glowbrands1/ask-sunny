// @vitest-environment jsdom
import * as React from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { VoiceAccessProvider } from "@/features/voice/voice-access";
import { acceptVoiceNotice, installFakeMic, removeFakeMic, type FakeMic } from "@/test/fake-mic";
import { ReviewsAskBar } from "./reviews-ask-bar";
import type { ChatConversation, ChatMessage } from "@/types";
import type { ClientAskRequest } from "@/lib/ai/types";

/*
 * VOICE_INPUT_ENABLED, the extra box: the Google Reviews ask bar (it sends to /api/chat through `useInlineAsk`, like a
 * report bar, so it has the same mic as a "report" box). The mic shows only when voice is on for the person, is off
 * while the bar is busy, puts the transcript in the bar's own text, and Send is unchanged apart from saying the text
 * came from voice (and whether it was edited). Every person here is invented.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, refresh: () => {} }),
  usePathname: () => "/",
}));

vi.mock("@/lib/session/session-context", () => ({
  useSession: () => ({
    user: { name: "Ada Quill", isSalonAccount: false, title: "Salon Director", scope: {} },
    role: "salon_director",
    can: () => true,
    primaryLocationName: "Example Plaza",
    managerDisplayName: "Ada",
    demoMode: true,
    brand: { knowledgeScopeId: "stc-core" },
  }),
}));

let conversations: ChatConversation[] = [];
let notify: (() => void) | null = null;
function useFakeStore() {
  const [, force] = React.useReducer((n: number) => n + 1, 0);
  React.useEffect(() => {
    notify = force;
    return () => {
      notify = null;
    };
  }, [force]);
  return {
    forms: [],
    documents: [{ id: "doc-1" }],
    videos: [],
    conversations,
    addConversation(conversation: ChatConversation) {
      conversations = [conversation, ...conversations];
      notify?.();
    },
    appendConversationMessages(id: string, messages: ChatMessage[]) {
      conversations = conversations.map((entry) => (entry.id === id ? { ...entry, messages: [...entry.messages, ...messages] } : entry));
      notify?.();
    },
    patchConversationMessage() {},
    updateConversation() {},
  };
}
vi.mock("@/lib/store/app-store", () => ({ useAppStore: () => useFakeStore(), useOptionalAppStore: () => useFakeStore() }));

const HINT = "Voice turns your recording into text.";
const asks: ClientAskRequest[] = [];
let hold: Promise<void> | null = null;
vi.mock("@/lib/ai", () => ({
  getAIProvider: () => ({
    name: "fake",
    connected: true,
    titleForConversation: (first: string) => first.slice(0, 20),
    async ask(request: ClientAskRequest) {
      asks.push(request);
      if (hold) await hold;
      return { content: `Answer ${asks.length}`, citations: [], coverage: "not_applicable" as const, recommendedVideoIds: [], followUpSuggestions: [] };
    },
  }),
}));

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

let fake: FakeMic;
beforeEach(() => {
  conversations = [];
  asks.length = 0;
  hold = null;
  window.localStorage.clear();
  fake = installFakeMic();
  acceptVoiceNotice("user-ada");
});
afterEach(() => {
  cleanup();
  removeFakeMic();
});

const band = (enabled = true) =>
  render(
    <VoiceAccessProvider enabled={enabled} userKey="user-ada">
      <ReviewsAskBar oldestOpen={null} />
    </VoiceAccessProvider>,
  );
const box = () => screen.getByRole("textbox") as HTMLTextAreaElement;
const send = () => screen.getByRole("button", { name: "Ask Sunny about reviews" });
const mic = () => screen.queryByRole("button", { name: "Speak your message" }) as HTMLButtonElement | null;

async function speak(user: ReturnType<typeof userEvent.setup>) {
  await user.click(mic()!);
  const stop = await screen.findByRole("button", { name: "Stop recording" });
  // Held for more than half a second: a shorter clip is "I did not hear anything".
  await new Promise((resolve) => setTimeout(resolve, 600));
  await user.click(stop);
  await screen.findByText("Check the words, then press Send");
}

describe("the Google Reviews ask bar", () => {
  it("no mic when voice is off", () => {
    band(false);
    expect(mic()).toBeNull();
    expect(screen.queryByText(HINT)).toBeNull();
  });

  it("a mic when on; the transcript lands in the bar's text; Send says it came from voice, unedited", async () => {
    const user = userEvent.setup();
    band();
    expect(mic()).not.toBeNull();
    expect(screen.getByText(HINT)).toBeTruthy();
    await speak(user);
    expect(box().value).toBe("spoken words from ada");
    expect(fake.lastForm()!.get("surface")).toBe("report");
    await user.click(send());
    await waitFor(() => expect(asks).toHaveLength(1));
    expect(asks[0]).toMatchObject({ question: "spoken words from ada", inputMode: "voice", voiceTraceId: "6f1c2b3a-1111-4222-8333-444455556666", voiceEdited: false });
  });

  it("edited before Send: voiceEdited is true; a typed question sends no voice fields", async () => {
    const user = userEvent.setup();
    band();
    await speak(user);
    await user.type(box(), " please");
    await user.click(send());
    await waitFor(() => expect(asks).toHaveLength(1));
    expect(asks[0]).toMatchObject({ question: "spoken words from ada please", inputMode: "voice", voiceEdited: true });
    await user.type(box(), "a typed follow-up");
    await user.click(send());
    await waitFor(() => expect(asks).toHaveLength(2));
    expect(asks[1]).not.toHaveProperty("inputMode");
    expect(asks[1]).not.toHaveProperty("voiceTraceId");
  });

  it("the mic is disabled while the bar is busy, and the follow-up carries the conversation", async () => {
    const user = userEvent.setup();
    let release!: () => void;
    hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    band();
    await user.type(box(), "what is the dress code");
    await user.click(send());
    await waitFor(() => expect(asks).toHaveLength(1));
    expect(mic()!.disabled).toBe(true);
    release();
    await waitFor(() => expect(mic()!.disabled).toBe(false));
    hold = null;
    await speak(user);
    expect(fake.lastForm()!.get("conversationId")).toBe(asks[0]!.conversationId);
  });
});
