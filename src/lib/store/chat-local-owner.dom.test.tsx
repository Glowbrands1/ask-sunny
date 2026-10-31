// @vitest-environment jsdom
import * as React from "react";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ChatConversation } from "@/types";

/**
 * ============================================================================
 * ANOTHER ACCOUNT'S CHATS IN THIS BROWSER ARE NEVER SHOWN —
 * NEXT_PUBLIC_CHAT_LOCAL_OWNER_ENABLED
 * ============================================================================
 *
 * PORTED FROM ASK BUBBLES (QA, 30 Oct 2026, production there): a manager
 * chatted, then another account used the SAME BROWSER, saw the manager's
 * chats and pressed Import, and they landed in the other account (here QA
 * counted 70 chats held by the wrong account). The local store is one per browser. With the flag, each
 * local chat carries its account's opaque key; another account's chats are
 * held back — not shown, not offered for Import, not synced — and kept in the
 * browser untouched. Nothing is deleted.
 */

const ORIGINAL = { ...process.env };

/** Everything the browser-side chat client does, captured rather than done. */
const calls = {
  saved: [] as ChatConversation[],
  deleted: [] as string[],
  cleared: 0,
  imported: [] as ChatConversation[][],
};

let serverConversations: ChatConversation[] = [];
let historyState: {
  stored: { id: string; messages: number }[];
  deleted: string[];
  clearedAt: string | null;
  ownerKey?: string;
} = { stored: [], deleted: [], clearedAt: null };
let listFails = false;
let saveFails = false;

vi.mock("@/lib/chat/client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/chat/client")>(
    "@/lib/chat/client",
  );
  return {
    ...actual,
    fetchOwnConversations: async () => {
      if (listFails) throw new actual.ChatSyncFailure("down", 503, true);
      return serverConversations;
    },
    fetchHistoryState: async () => {
      if (listFails) throw new actual.ChatSyncFailure("down", 503, true);
      return historyState;
    },
    saveOwnConversation: async (conversation: ChatConversation) => {
      if (saveFails) throw new actual.ChatSyncFailure("down", 503, true);
      calls.saved.push(conversation);
    },
    deleteOwnConversation: async (id: string) => {
      calls.deleted.push(id);
    },
    clearOwnConversations: async () => {
      calls.cleared += 1;
    },
    importConversationBatch: async (conversations: ChatConversation[]) => {
      calls.imported.push(conversations);
      return { imported: conversations.map((entry) => entry.id), declined: [] };
    },
  };
});

/** IndexedDB stands in as a plain array, so hydration has something to return. */
let localHistory: ChatConversation[] = [];
const replaced: ChatConversation[][] = [];
/** The key/value half of the same store, which survives a "reload" in a test. */
let localValues = new Map<string, unknown>();

vi.mock("@/lib/storage", async () => {
  const actual = await vi.importActual<typeof import("@/lib/storage")>("@/lib/storage");
  return {
    ...actual,
    getStorageProvider: () => ({
      name: "fake",
      isAvailable: () => true,
      list: async (collection: string) =>
        collection === "chat_conversations" ? localHistory : [],
      replace: async (collection: string, records: ChatConversation[]) => {
        if (collection === "chat_conversations") {
          replaced.push(records);
          localHistory = records;
        }
      },
      put: async () => {},
      remove: async () => {},
      /*
       * A REAL KEY/VALUE STORE, because the Clear History sweep records which
       * boundary it has carried out here — and "does it persist across a
       * session" is exactly what the tests below turn on.
       */
      getValue: async (key: string) => localValues.get(key) ?? null,
      setValue: async (key: string, value: unknown) => {
        localValues.set(key, value);
      },
      putBlob: async () => {},
      getBlob: async () => null,
      getBlobMeta: async () => null,
      removeBlob: async () => {},
      clearAll: async () => {},
    }),
  };
});

/* Retrieval is not what this file is about, and it reaches the network. */
vi.mock("@/lib/knowledge", () => ({
  getKnowledgeProvider: () => ({ listDocuments: async () => [] }),
  getLocalKnowledgeProvider: () => ({ setDocuments: () => {} }),
}));

function conversation(
  id: string,
  updatedAt = "2026-09-01T10:00:00.000Z",
  /*
   * EXPLICIT, because the Clear History rule turns on when a conversation was
   * CREATED and this helper used to pin that to a constant while varying only
   * `updatedAt`. A test that set the second argument and believed it had set
   * the creation time was describing a scenario it had not built.
   */
  createdAt = "2026-09-01T10:00:00.000Z",
): ChatConversation {
  return {
    id,
    title: `${id} title`,
    createdAt,
    updatedAt,
    attachedDocumentIds: [],
    messages: [
      /*
       * `msg_` plus the conversation's own suffix, which keeps it the shape
       * `createId` produces — a shorter id would be declined by the validator
       * and the whole conversation would drop out of the import for the wrong
       * reason.
       */
      { id: `msg_${id.slice(5)}`, role: "user", content: "hello", createdAt: updatedAt },
    ],
  };
}


type Store = ReturnType<typeof import("./app-store").useAppStore>;

async function mount() {
  const { AppStoreProvider, useAppStore } = await import("./app-store");
  const captured: { store: Store | null } = { store: null };

  function Probe() {
    captured.store = useAppStore();
    return null;
  }

  render(
    <AppStoreProvider>
      <Probe />
    </AppStoreProvider>,
  );

  await waitFor(() => expect(captured.store?.ready).toBe(true));
  /*
   * Hydration then asks the account what it holds, which is several microtask
   * hops later. Waiting on the OBSERVABLE result rather than counting ticks:
   * once the local history is reflected in `conversations`, the merge has run.
   */
  await act(async () => {
    for (let tick = 0; tick < 20; tick += 1) await Promise.resolve();
  });

  return captured as { store: Store };
}

beforeEach(() => {
  vi.resetModules();
  process.env.NEXT_PUBLIC_DEMO_MODE = "false";
  calls.saved = [];
  calls.deleted = [];
  calls.cleared = 0;
  calls.imported = [];
  serverConversations = [];
  historyState = { stored: [], deleted: [], clearedAt: null };
  listFails = false;
  saveFails = false;
  localHistory = [];
  replaced.length = 0;
  localValues = new Map();
});

afterEach(() => {
  cleanup();
  process.env = { ...ORIGINAL };
});

/* ------------------------------------------------------- no silent upload -- */

const MANAGER_KEY = "a".repeat(32);
const ASSISTANT_KEY = "b".repeat(32);
const FLAG = "NEXT_PUBLIC_CHAT_LOCAL_OWNER_ENABLED";

/** What the Salon Director's session left in this browser, stamped (flag on) or not (written before it). */
const MANAGER_CHAT = { ...conversation("conv_mvvadk9k8yp7ck2"), ownerKey: MANAGER_KEY };
const LEGACY_CHAT = conversation("conv_mvvadk9k8yp7ck3");

describe("an Assistant Salon Director signs in on the browser a Salon Director used", () => {
  it("off (production today): the manager's chats are shown and offered for Import", async () => {
    delete process.env[FLAG];
    localHistory = [MANAGER_CHAT, LEGACY_CHAT];
    historyState = { stored: [], deleted: [], clearedAt: null };
    const captured = await mount();
    expect(captured.store.conversations.map((entry) => entry.id)).toContain(MANAGER_CHAT.id);
    expect(captured.store.importableConversations.map((entry) => entry.id)).toContain(LEGACY_CHAT.id);
  });

  // Changed on purpose (Pau, 31 Oct 2026: "Keep them visible"): the legacy unstamped chat stays visible; the stamped one is hidden.
  it("on: the manager's stamped chat is never shown, offered or sent, and stays in the browser untouched", async () => {
    process.env[FLAG] = "true";
    localHistory = [MANAGER_CHAT, LEGACY_CHAT];
    historyState = { stored: [], deleted: [], clearedAt: null, ownerKey: ASSISTANT_KEY };
    const captured = await mount();
    expect(captured.store.conversations.map((entry) => entry.id)).not.toContain(MANAGER_CHAT.id);
    expect(captured.store.importableConversations.map((entry) => entry.id)).not.toContain(MANAGER_CHAT.id);
    expect(calls.saved).toEqual([]);
    expect(calls.imported).toEqual([]);
    expect(localHistory.find((entry) => entry.id === MANAGER_CHAT.id)).toEqual(MANAGER_CHAT);
  });

  it("on (case 4): a legacy unstamped chat this account does not hold stays visible as today, and is not stamped as this account's", async () => {
    process.env[FLAG] = "true";
    localHistory = [MANAGER_CHAT, LEGACY_CHAT];
    historyState = { stored: [], deleted: [], clearedAt: null, ownerKey: ASSISTANT_KEY };
    const captured = await mount();
    expect(captured.store.conversations.map((entry) => entry.id)).toEqual([LEGACY_CHAT.id]);
    expect(captured.store.importableConversations.map((entry) => entry.id)).toContain(LEGACY_CHAT.id);
    expect((localHistory.find((entry) => entry.id === LEGACY_CHAT.id) as { ownerKey?: string }).ownerKey).toBeUndefined();
  });

  it("on: a new chat the assistant starts is theirs, stamped, and kept beside the manager's", async () => {
    process.env[FLAG] = "true";
    localHistory = [MANAGER_CHAT];
    historyState = { stored: [], deleted: [], clearedAt: null, ownerKey: ASSISTANT_KEY };
    const captured = await mount();
    const id = "conv_mvvnewassist01";
    await act(async () => {
      captured.store.addConversation(conversation(id, "2026-10-30T18:45:00.000Z", "2026-10-30T18:45:00.000Z"));
    });
    await act(async () => {
      for (let tick = 0; tick < 20; tick += 1) await Promise.resolve();
    });
    const stored = new Map(localHistory.map((entry) => [entry.id, entry as { ownerKey?: string }]));
    expect(stored.get(id)?.ownerKey).toBe(ASSISTANT_KEY);
    expect(stored.get(MANAGER_CHAT.id)?.ownerKey).toBe(MANAGER_KEY);
    expect(captured.store.conversations.map((entry) => entry.id)).not.toContain(MANAGER_CHAT.id);
  });

  it("on: the manager, back on the browser, sees their own chats — and an unstamped one their account holds", async () => {
    process.env[FLAG] = "true";
    localHistory = [MANAGER_CHAT, LEGACY_CHAT];
    historyState = { stored: [{ id: LEGACY_CHAT.id, messages: 1 }], deleted: [], clearedAt: null, ownerKey: MANAGER_KEY };
    const captured = await mount();
    expect(captured.store.conversations.map((entry) => entry.id).sort()).toEqual([MANAGER_CHAT.id, LEGACY_CHAT.id].sort());
    expect((localHistory.find((entry) => entry.id === LEGACY_CHAT.id) as { ownerKey?: string }).ownerKey).toBe(MANAGER_KEY);
  });

  it("on: the account cannot be reached — nothing already in the browser is shown", async () => {
    process.env[FLAG] = "true";
    localHistory = [MANAGER_CHAT, LEGACY_CHAT];
    listFails = true;
    const captured = await mount();
    expect(captured.store.conversations).toEqual([]);
    expect(localHistory.map((entry) => entry.id)).toEqual(expect.arrayContaining([MANAGER_CHAT.id, LEGACY_CHAT.id]));
  });
});
