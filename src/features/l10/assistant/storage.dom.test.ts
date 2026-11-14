// @vitest-environment jsdom
import type { UIMessage } from "ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { currentChatId, deleteFromHistory, listHistory, loadConversation, openFromHistory, saveConversation, saveToHistory, startNewChat } from "./storage";

/* The DM L10 assistant's chat history: the Hub's storage.ts, scoped per Ask Sunny user and meeting. */
const A = "sunny-user-1:stc-dm";
const B = "sunny-user-2:stc-dm";
const msg = (role: "user" | "assistant", text: string, id = `${role}-${text}`): UIMessage => ({ id, role, parts: [{ type: "text", text }] });

beforeEach(() => window.localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe("chat history (this browser only)", () => {
  it("saves a chat, lists it newest first with its title, opens it and deletes it", () => {
    const id = currentChatId(A);
    saveToHistory(id, [msg("user", "Which rocks are off track?"), msg("assistant", "Two of them.")], A, new Date("2026-11-13T10:00:00Z"));
    expect(listHistory(A)).toEqual([{ id, title: "Which rocks are off track?", updatedAt: "2026-11-13T10:00:00.000Z", count: 2 }]);

    const next = startNewChat(A);
    expect(next).not.toBe(id);
    expect(loadConversation(A)).toEqual([]);
    expect(listHistory(A).map((c) => c.id)).toEqual([id]); // the old chat stays in History

    expect(openFromHistory(id, A)).toBe(true);
    expect(currentChatId(A)).toBe(id);
    expect(loadConversation(A).map((m) => m.id)).toEqual(["user-Which rocks are off track?", "assistant-Two of them."]);

    deleteFromHistory(id, A);
    expect(listHistory(A)).toEqual([]);
    expect(currentChatId(A)).not.toBe(id); // deleting the chat on screen starts a new one
    expect(openFromHistory(id, A)).toBe(false);
  });

  it("a chat with no question is not saved, and attachments are dropped from the stored copy", () => {
    saveToHistory("c0", [msg("assistant", "Hello")], A);
    expect(listHistory(A)).toEqual([]);
    const withFile: UIMessage = { id: "u1", role: "user", parts: [{ type: "text", text: "see this" }, { type: "file", mediaType: "image/png", url: "data:image/png;base64,AAAA" }] };
    saveConversation([withFile], A);
    expect((loadConversation(A)[0].parts[1] as { url: string }).url).toBe("");
  });

  it("is per Ask Sunny user and meeting: one person never sees another's chats", () => {
    saveToHistory(currentChatId(A), [msg("user", "Mine")], A);
    expect(listHistory(B)).toEqual([]);
    expect(listHistory("sunny-user-1:bcs-dm")).toEqual([]);
    // Its keys cannot collide with Ask Sunny's own chat or the Hub's.
    expect(Object.keys(window.localStorage).every((k) => k.startsWith("l10-hub-assistant:"))).toBe(true);
  });

  it("storage that throws (private window, full, blocked) never breaks the chat", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(loadConversation(A)).toEqual([]);
    expect(listHistory(A)).toEqual([]);
    expect(typeof currentChatId(A)).toBe("string");
    expect(() => saveConversation([msg("user", "q")], A)).not.toThrow();
    expect(() => saveToHistory("x", [msg("user", "q")], A)).not.toThrow();
    expect(typeof startNewChat(A)).toBe("string");
    expect(openFromHistory("x", A)).toBe(false);
    expect(() => deleteFromHistory("x", A)).not.toThrow();
  });
});
