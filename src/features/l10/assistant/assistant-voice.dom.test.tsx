// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * VOICE_INPUT_ENABLED, box D: the L10 Leadership Assistant (one panel for every L10 tab: stc-dm and the three SD
 * L10s). The mic shows only when voice is on for the person, sits between the paperclip and "Deep think", is off while
 * an answer is running, appends the transcript to the draft without opening the @ list, and Send posts exactly what
 * it posted before (nothing new reaches /api/l10/assistant). Every person here is invented.
 */
vi.mock("@/features/l10/actions", () => ({ meetingPeopleAction: async () => [{ id: "p1", name: "Ivo Marchetti" }] }));

import { VoiceAccessProvider } from "@/features/voice/voice-access";
import { acceptVoiceNotice, installFakeMic, removeFakeMic, type FakeMic } from "@/test/fake-mic";
import { AssistantPanel } from "./AssistantPanel";

const HINT = "Voice sends your recording to AssemblyAI to make text.";
const SCOPE = "user-ada:stc-dm";
let fake: FakeMic;
let posts: Record<string, unknown>[];
let answer: () => Response | Promise<Response>;

beforeEach(() => {
  window.localStorage.clear();
  fake = installFakeMic();
  acceptVoiceNotice("user-ada");
  posts = [];
  answer = () => new Response(JSON.stringify({ error: "x" }), { status: 500 });
  const voice = fake.fetch.getMockImplementation() as (url: string, init?: RequestInit) => Promise<Response>;
  fake.fetch.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url === "/api/chat/voice") return voice(url, init);
    if (init?.method === "POST") {
      posts.push(JSON.parse(String(init.body)));
      return answer();
    }
    return new Response(JSON.stringify({ configured: true }), { status: 200 });
  });
});
afterEach(() => {
  cleanup();
  removeFakeMic();
});

async function openPanel(enabled = true, meetingKey = "stc-dm") {
  render(
    <VoiceAccessProvider enabled={enabled} userKey="user-ada">
      <AssistantPanel open onClose={() => {}} meetingKey={meetingKey} scope={SCOPE} />
    </VoiceAccessProvider>,
  );
  await act(async () => {
    await Promise.resolve();
  });
}

const box = () => screen.getByLabelText("Message the Leadership Assistant") as HTMLTextAreaElement;
const mic = () => screen.queryByRole("button", { name: "Speak your message" }) as HTMLButtonElement | null;

async function speak(user: ReturnType<typeof userEvent.setup>) {
  await user.click(mic()!);
  const stop = await screen.findByRole("button", { name: "Stop recording" });
  await new Promise((resolve) => setTimeout(resolve, 600));
  await user.click(stop);
  await screen.findByText("Check the words, then press Send");
}

describe("box D: the L10 Leadership Assistant", () => {
  it("no mic when voice is off", async () => {
    await openPanel(false);
    expect(mic()).toBeNull();
    expect(screen.queryByText(HINT)).toBeNull();
    expect(screen.getByRole("button", { name: "Attach images or PDFs" })).toBeTruthy();
  });

  it("a mic between the paperclip and Deep think, styled like its neighbours", async () => {
    await openPanel();
    const row = mic()!.parentElement!;
    const buttons = [...row.querySelectorAll("button")];
    const at = buttons.indexOf(mic()!);
    expect(buttons[at - 1]!.getAttribute("aria-label")).toBe("Attach images or PDFs");
    expect(buttons[at + 1]!.textContent).toContain("Deep think");
    expect(mic()!.className).toContain("size-11");
    expect(mic()!.className).toContain("focus-visible:outline-bronze");
  });

  it("the transcript lands in the draft (no @ list), with the meeting key; Send posts what it always posted", async () => {
    const user = userEvent.setup();
    await openPanel(true, "stc-sd-two");
    await user.type(box(), "notes:");
    expect(screen.getByText(HINT)).toBeTruthy();
    await speak(user);
    expect(box().value).toBe("notes: spoken words from ada");
    expect(document.activeElement).toBe(box());
    expect(screen.queryByRole("listbox")).toBeNull();
    const form = fake.lastForm()!;
    expect(form.get("surface")).toBe("l10");
    expect(form.get("meetingKey")).toBe("stc-sd-two");
    expect(form.get("conversationId")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Send message" }));
    await waitFor(() => expect(posts).toHaveLength(1));
    // Only the fields this panel always sent (messageId is left out of the JSON when it is undefined).
    for (const key of Object.keys(posts[0]!)) expect(["deep", "id", "key", "messageId", "messages", "trigger"]).toContain(key);
    expect(posts[0]).toMatchObject({ key: "stc-sd-two", deep: false });
    expect(JSON.stringify(posts[0])).not.toMatch(/inputMode|voiceTraceId|voiceEdited/);
    const parts = (posts[0]!.messages as { parts: { type: string; text?: string }[] }[]).at(-1)!.parts;
    expect(parts).toEqual([{ type: "text", text: "notes: spoken words from ada" }]);
  });

  it("the mic is disabled while an answer is running", async () => {
    const user = userEvent.setup();
    answer = () => new Promise<Response>(() => undefined);
    await openPanel();
    await user.type(box(), "which rocks are at risk{Enter}");
    await waitFor(() => expect(posts).toHaveLength(1));
    await waitFor(() => expect(screen.getByRole("button", { name: "Stop generating" })).toBeTruthy());
    expect(mic()!.disabled).toBe(true);
  });
});
