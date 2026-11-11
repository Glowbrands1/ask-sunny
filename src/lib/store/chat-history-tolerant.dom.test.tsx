// @vitest-environment jsdom
import * as React from "react";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ChatConversation } from "@/types";

/**
 * ============================================================================
 * A FRESH BROWSER SHOWS THE ACCOUNT'S CHATS EVEN WHEN THE HISTORY STATE FAILS —
 * NEXT_PUBLIC_CHAT_HISTORY_TOLERANT_ENABLED
 * ============================================================================
 *
 * QA, 31 Oct 2026 (Sunny tester, Pau's Admin login): the chats were on the
 * account — GET /api/chat/conversations returned them — but in a freshly
 * signed-in browser History said "No conversations yet". GET
 * /api/chat/conversations/import answered 503 on every fresh load, and the two
 * reads were awaited together, so either failing left local chats only.
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
} = { stored: [], deleted: [], clearedAt: null };
let listFails = false;
let stateFails = false;
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
      if (listFails || stateFails) throw new actual.ChatSyncFailure("down", 503, true);
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
  stateFails = false;
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

const FLAG = "NEXT_PUBLIC_CHAT_HISTORY_TOLERANT_ENABLED";
const ON_ACCOUNT = [conversation("conv_mvw6gt7x23c8omq"), conversation("conv_mvw6gt7x23c8omr")];

describe("a freshly signed-in browser, the history state answering 503", () => {
  it("off (production today): no conversations", async () => {
    delete process.env[FLAG];
    serverConversations = ON_ACCOUNT;
    stateFails = true;
    const captured = await mount();
    expect(captured.store.conversations).toEqual([]);
  });

  it("on: the account's own chats are in History, nothing offered for Import, nothing sent", async () => {
    process.env[FLAG] = "true";
    serverConversations = ON_ACCOUNT;
    stateFails = true;
    const captured = await mount();
    expect(captured.store.conversations.map((entry) => entry.id).sort()).toEqual(ON_ACCOUNT.map((entry) => entry.id).sort());
    expect(captured.store.importableConversations).toEqual([]);
    expect(calls.saved).toEqual([]);
    expect(calls.imported).toEqual([]);
  });

  it("on: the list failing too is still local chats only, as before", async () => {
    process.env[FLAG] = "true";
    serverConversations = ON_ACCOUNT;
    listFails = true;
    localHistory = [conversation("conv_mfxlocal0009")];
    const captured = await mount();
    expect(captured.store.conversations.map((entry) => entry.id)).toEqual(["conv_mfxlocal0009"]);
  });

  it("on: both reads answering is the ordinary merge", async () => {
    process.env[FLAG] = "true";
    serverConversations = ON_ACCOUNT;
    historyState = { stored: ON_ACCOUNT.map((entry) => ({ id: entry.id, messages: 1 })), deleted: [], clearedAt: null };
    const captured = await mount();
    expect(captured.store.conversations).toHaveLength(2);
  });
});
