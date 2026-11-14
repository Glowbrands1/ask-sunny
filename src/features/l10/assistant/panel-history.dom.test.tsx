// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AssistantPanel } from "./AssistantPanel";
import { currentChatId, saveToHistory } from "./storage";

/* The panel's History, as in the Hub: the list opens, a chat can be deleted, and storage failures never break it. */
const SCOPE = "sunny-user-1:stc-dm";

beforeEach(() => {
  window.localStorage.clear();
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ configured: true }), { status: 200 })));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function openPanel() {
  render(<AssistantPanel open onClose={() => {}} meetingKey="stc-dm" scope={SCOPE} />);
  await act(async () => {
    await Promise.resolve();
  });
}

describe("the assistant panel's chat history", () => {
  it("lists this person's chats and deletes one", async () => {
    saveToHistory(currentChatId(SCOPE), [{ id: "u", role: "user", parts: [{ type: "text", text: "Which rocks are off track?" }] }], SCOPE);
    await openPanel();
    fireEvent.click(screen.getByRole("button", { name: "Chat history" }));
    const history = within(screen.getByRole("region", { name: "Chat history" }));
    expect(history.getByRole("button", { name: /^Which rocks are off track\?/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Delete chat: Which rocks are off track?" }));
    expect(document.body.textContent).toContain("No saved chats yet.");
  });

  it("still opens, and its History still shows, when the browser's storage throws", async () => {
    for (const m of ["getItem", "setItem", "removeItem"] as const) {
      vi.spyOn(Storage.prototype, m).mockImplementation(() => {
        throw new Error("blocked");
      });
    }
    await openPanel();
    expect(screen.getByRole("dialog", { name: "Leadership Assistant" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "New chat" }));
    fireEvent.click(screen.getByRole("button", { name: "Chat history" }));
    expect(document.body.textContent).toContain("No saved chats yet.");
  });
});
