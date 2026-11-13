// Copied from the Leadership Hub (src/lib/assistant/storage.ts); keep in step with it.
import type { UIMessage } from "ai";

/**
 * The DM L10 assistant's memory: this browser only, as in the Hub. Every key is scoped by `scope`, which Ask Sunny sets
 * to "<verified Ask Sunny user id>:<meeting key>" (see L10Frame), so two people on one browser, or two meetings, never
 * share a chat. The prefix (`l10-hub-assistant:`) cannot collide with Ask Sunny's own chat storage or the Hub's
 * (`lh-assistant:`, a different origin anyway): this history is not shared with the Hub's.
 */
const PREFIX = "l10-hub-assistant";
const KEY = (userId: string) => `${PREFIX}:v1:${userId}`;
const MAX_BYTES = 2_000_000;

export function loadConversation(userId = "local"): UIMessage[] {
  try {
    const raw = window.localStorage.getItem(KEY(userId));
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as UIMessage[]) : [];
  } catch {
    return [];
  }
}

/** Attachments (data URLs) are dropped from the stored copy to stay under the quota. */
export function saveConversation(messages: UIMessage[], userId = "local") {
  try {
    const slim = messages.map((m) => ({ ...m, parts: m.parts.map((p) => (p.type === "file" ? { ...p, url: "" } : p)) }));
    const json = JSON.stringify(slim);
    if (json.length > MAX_BYTES) return;
    window.localStorage.setItem(KEY(userId), json);
  } catch {
    /* storage unavailable or full: the chat still works */
  }
}

export function clearConversation(userId = "local") {
  try {
    window.localStorage.removeItem(KEY(userId));
  } catch {
    /* ignore */
  }
}

/* ── Chat history (this browser only) ─────────────────────── */

export interface SavedChat {
  id: string;
  title: string;
  updatedAt: string;
  messages: UIMessage[];
}
export type ChatSummary = Omit<SavedChat, "messages"> & { count: number };

const HISTORY_KEY = (userId: string) => `${PREFIX}:history:v1:${userId}`;
const CURRENT_ID_KEY = (userId: string) => `${PREFIX}:current-id:v1:${userId}`;
const MAX_CHATS = 40;
const HISTORY_MAX_BYTES = 3_000_000;

function readHistory(userId: string): SavedChat[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(HISTORY_KEY(userId)) ?? "[]");
    return Array.isArray(parsed) ? (parsed as SavedChat[]) : [];
  } catch {
    return [];
  }
}

function writeHistory(chats: SavedChat[], userId: string) {
  try {
    let keep = chats.slice(0, MAX_CHATS);
    // Oldest chats go first when the browser's storage would overflow.
    while (keep.length > 1 && JSON.stringify(keep).length > HISTORY_MAX_BYTES) keep = keep.slice(0, -1);
    window.localStorage.setItem(HISTORY_KEY(userId), JSON.stringify(keep));
  } catch {
    /* storage unavailable or full: the chat still works */
  }
}

const newId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`).slice(0, 18);

/** The id of the conversation on screen, created on first use. */
export function currentChatId(userId = "local"): string {
  try {
    const existing = window.localStorage.getItem(CURRENT_ID_KEY(userId));
    if (existing) return existing;
    const id = newId();
    window.localStorage.setItem(CURRENT_ID_KEY(userId), id);
    return id;
  } catch {
    return newId();
  }
}

/** A new conversation: the current one stays in history; the screen starts empty. */
export function startNewChat(userId = "local"): string {
  clearConversation(userId);
  const id = newId();
  try {
    window.localStorage.setItem(CURRENT_ID_KEY(userId), id);
  } catch {
    /* ignore */
  }
  return id;
}

/** "Which rocks are off track…" from the first thing the person asked. */
export function chatTitle(messages: UIMessage[]): string {
  const first = messages.find((m) => m.role === "user");
  const text = first?.parts.map((p) => (p.type === "text" ? p.text : "")).join(" ").replace(/\s+/g, " ").trim() ?? "";
  if (!text) return "New chat";
  return text.length > 70 ? `${text.slice(0, 67)}…` : text;
}

/** Saves (or updates) a conversation in history, newest first. Attachments are dropped from the stored copy. */
export function saveToHistory(id: string, messages: UIMessage[], userId = "local", now = new Date()) {
  if (!messages.some((m) => m.role === "user")) return;
  const slim = messages.map((m) => ({ ...m, parts: m.parts.map((p) => (p.type === "file" ? { ...p, url: "" } : p)) }));
  const rest = readHistory(userId).filter((c) => c.id !== id);
  writeHistory([{ id, title: chatTitle(messages), updatedAt: now.toISOString(), messages: slim }, ...rest], userId);
}

export function listHistory(userId = "local"): ChatSummary[] {
  return readHistory(userId).map(({ messages, ...c }) => ({ ...c, count: messages.length }));
}

/** Puts a saved conversation back on screen. Returns false when it no longer exists. */
export function openFromHistory(id: string, userId = "local"): boolean {
  const chat = readHistory(userId).find((c) => c.id === id);
  if (!chat) return false;
  saveConversation(chat.messages, userId);
  try {
    window.localStorage.setItem(CURRENT_ID_KEY(userId), id);
  } catch {
    /* ignore */
  }
  return true;
}

export function deleteFromHistory(id: string, userId = "local") {
  writeHistory(readHistory(userId).filter((c) => c.id !== id), userId);
  try {
    if (window.localStorage.getItem(CURRENT_ID_KEY(userId)) === id) startNewChat(userId);
  } catch {
    /* ignore */
  }
}
