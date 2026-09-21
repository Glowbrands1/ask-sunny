// @vitest-environment jsdom
import * as React from "react";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ChatConversation } from "@/types";

/**
 * ============================================================================
 * LOADING A PAGE IS NOT AN UPLOAD
 * ============================================================================
 *
 * The rule the whole import design rests on, tested where it is actually
 * enforced: in the store, which is the single shared persistence path both
 * conversation-creating surfaces write through.
 *
 * Conversations already in a browser predate any promise that Ask Sunny would
 * keep them, and they contain what managers asked about named employees. They
 * go to the account when somebody presses Import, and at no other moment —
 * INCLUDING when one of them is continued, since syncing it then would send
 * every earlier turn in it as a side effect of typing.
 *
 * A conversation started after this build loaded is ordinary service and syncs
 * without anybody being asked anything.
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
let storedIds: string[] = [];
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
    fetchStoredConversationIds: async () => {
      if (listFails) throw new actual.ChatSyncFailure("down", 503, true);
      return storedIds;
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
      getValue: async () => null,
      setValue: async () => {},
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

function conversation(id: string, updatedAt = "2026-09-01T10:00:00.000Z"): ChatConversation {
  return {
    id,
    title: `${id} title`,
    createdAt: "2026-09-01T10:00:00.000Z",
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

const LOCAL_OLD = conversation("conv_mfxlocal0001");
const SEED = {
  ...conversation("conv-seed-1"),
  messages: [
    { id: "msg-s1-1", role: "user" as const, content: "seeded", createdAt: "2026-09-01T10:00:00.000Z" },
  ],
};

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
  storedIds = [];
  listFails = false;
  saveFails = false;
  localHistory = [];
  replaced.length = 0;
});

afterEach(() => {
  cleanup();
  process.env = { ...ORIGINAL };
});

/* ------------------------------------------------------- no silent upload -- */

describe("hydration uploads nothing", () => {
  it("saves nothing when a browser full of history loads", async () => {
    localHistory = [LOCAL_OLD, SEED, conversation("conv_mfxlocal0002")];

    const captured = await mount();

    expect(calls.saved).toEqual([]);
    expect(calls.imported).toEqual([]);
    expect(captured.store.conversations).toHaveLength(3);
  });

  it("saves nothing when the person CONTINUES a pre-existing conversation", async () => {
    /*
     * The subtle half of the rule. Continuing an old thread must not push its
     * historical turns to the account as a side effect of typing — that is
     * still an upload the person never approved.
     */
    localHistory = [LOCAL_OLD];
    const captured = await mount();

    await act(async () => {
      captured.store.appendConversationMessages(LOCAL_OLD.id, [
        {
          id: "msg_mfxnew0000001",
          role: "user",
          content: "one more thing",
          createdAt: "2026-09-20T10:00:00.000Z",
        },
      ]);
    });

    expect(calls.saved).toEqual([]);
  });

  it("never queues a seeded demo thread, even on a browser that stored nothing", async () => {
    /*
     * THE DEFECT THIS PINS, because it was real and it was mine. A browser with
     * no stored history still holds `DEMO_CONVERSATIONS` in React state — the
     * initial state is the seeded set in both modes — so an implementation that
     * marked only the STORED conversations as pre-existing left six fabricated
     * threads looking brand new, and the sync effect tried to send all six.
     *
     * Nothing would have been stored: the route refuses them and the failure is
     * not retryable. But an attempt to upload somebody's local content that
     * nobody approved is the thing this phase is built to make impossible, and
     * "the server would have said no" is not the standard.
     */
    localHistory = [];
    const captured = await mount();

    expect(captured.store.conversations.map((entry) => entry.id)).toContain(
      "conv-seed-1",
    );
    expect(calls.saved).toEqual([]);

    /* And still nothing after an unrelated state change re-runs the effect. */
    await act(async () => {
      captured.store.saveForm({ id: "form-seed-check" } as never);
    });
    expect(calls.saved).toEqual([]);
  });

  it("offers the real conversation for import and never the seeded one", async () => {
    localHistory = [LOCAL_OLD, SEED];
    const captured = await mount();

    await waitFor(() =>
      expect(captured.store.importableConversations.map((entry) => entry.id)).toEqual([
        LOCAL_OLD.id,
      ]),
    );
  });

  it("offers nothing when the account could not be asked", async () => {
    /*
     * A prompt offering to import conversations that may already be on the
     * account would ask somebody to approve something nobody can describe
     * correctly.
     */
    localHistory = [LOCAL_OLD];
    listFails = true;
    const captured = await mount();

    expect(captured.store.importableConversations).toEqual([]);
  });

  it("offers nothing that the account already holds", async () => {
    localHistory = [LOCAL_OLD];
    storedIds = [LOCAL_OLD.id];
    serverConversations = [LOCAL_OLD];
    const captured = await mount();

    expect(captured.store.importableConversations).toEqual([]);
  });
});

/* ------------------------------------------------------------ the import -- */

describe("importing is explicit and one-way", () => {
  it("sends the eligible conversations only when asked", async () => {
    localHistory = [LOCAL_OLD, SEED];
    const captured = await mount();

    await waitFor(() =>
      expect(captured.store.importableConversations).toHaveLength(1),
    );
    expect(calls.imported).toEqual([]);

    await act(async () => {
      await captured.store.importLocalConversations();
    });

    expect(calls.imported).toHaveLength(1);
    expect(calls.imported[0].map((entry) => entry.id)).toEqual([LOCAL_OLD.id]);
  });

  it("leaves the local copy exactly where it was", async () => {
    localHistory = [LOCAL_OLD];
    const captured = await mount();
    await waitFor(() =>
      expect(captured.store.importableConversations).toHaveLength(1),
    );

    await act(async () => {
      await captured.store.importLocalConversations();
    });

    expect(captured.store.conversations.map((entry) => entry.id)).toContain(LOCAL_OLD.id);
    expect(localHistory.map((entry) => entry.id)).toContain(LOCAL_OLD.id);
  });

  it("lets an imported conversation sync normally afterwards", async () => {
    localHistory = [LOCAL_OLD];
    const captured = await mount();
    await waitFor(() =>
      expect(captured.store.importableConversations).toHaveLength(1),
    );

    await act(async () => {
      await captured.store.importLocalConversations();
    });

    await act(async () => {
      captured.store.appendConversationMessages(LOCAL_OLD.id, [
        {
          id: "msg_mfxnew0000002",
          role: "user",
          content: "continued",
          createdAt: "2026-09-20T10:00:00.000Z",
        },
      ]);
    });

    await waitFor(() => expect(calls.saved.length).toBeGreaterThan(0));
    expect(calls.saved.at(-1)!.id).toBe(LOCAL_OLD.id);
  });

  it("stops offering the import once it has run", async () => {
    localHistory = [LOCAL_OLD];
    const captured = await mount();
    await waitFor(() =>
      expect(captured.store.importableConversations).toHaveLength(1),
    );

    await act(async () => {
      await captured.store.importLocalConversations();
    });

    expect(captured.store.importableConversations).toEqual([]);
  });
});

/* ---------------------------------------------------------- new chat sync -- */

describe("a conversation started now is ordinary service", () => {
  it("saves it to the account without asking", async () => {
    const captured = await mount();

    await act(async () => {
      captured.store.addConversation(conversation("conv_mfxbrandnew1"));
    });

    await waitFor(() => expect(calls.saved.map((entry) => entry.id)).toContain("conv_mfxbrandnew1"));
  });

  it("saves it again when it is continued", async () => {
    const captured = await mount();

    await act(async () => {
      captured.store.addConversation(conversation("conv_mfxbrandnew2"));
    });
    await waitFor(() => expect(calls.saved).toHaveLength(1));

    await act(async () => {
      captured.store.appendConversationMessages("conv_mfxbrandnew2", [
        {
          id: "msg_mfxnew0000003",
          role: "assistant",
          content: "an answer",
          createdAt: "2026-09-20T10:05:00.000Z",
        },
      ]);
    });

    await waitFor(() => expect(calls.saved.length).toBe(2));
    expect(calls.saved.at(-1)!.messages).toHaveLength(2);
  });

  it("does not re-save a conversation nothing changed on", async () => {
    const captured = await mount();

    await act(async () => {
      captured.store.addConversation(conversation("conv_mfxbrandnew3"));
    });
    await waitFor(() => expect(calls.saved).toHaveLength(1));

    /* An unrelated state change must not re-send every thread. */
    await act(async () => {
      captured.store.saveForm({ id: "form-1" } as never);
    });

    expect(calls.saved).toHaveLength(1);
  });
});

/* -------------------------------------------------------- cross-device --- */

describe("the same account sees the same history", () => {
  it("merges a conversation created on another browser into this one", async () => {
    localHistory = [LOCAL_OLD];
    serverConversations = [conversation("conv_mfxotherdev", "2026-09-05T10:00:00.000Z")];
    storedIds = ["conv_mfxotherdev"];

    const captured = await mount();

    expect(captured.store.conversations.map((entry) => entry.id)).toEqual([
      "conv_mfxotherdev",
      LOCAL_OLD.id,
    ]);
  });

  it("lets it be continued from here", async () => {
    serverConversations = [conversation("conv_mfxotherdev", "2026-09-05T10:00:00.000Z")];
    storedIds = ["conv_mfxotherdev"];
    const captured = await mount();

    await act(async () => {
      captured.store.appendConversationMessages("conv_mfxotherdev", [
        {
          id: "msg_mfxnew0000004",
          role: "user",
          content: "continuing from device B",
          createdAt: "2026-09-20T10:00:00.000Z",
        },
      ]);
    });

    await waitFor(() => expect(calls.saved.length).toBeGreaterThan(0));
    expect(calls.saved.at(-1)!.id).toBe("conv_mfxotherdev");
    expect(calls.saved.at(-1)!.messages).toHaveLength(2);
  });
});

/* --------------------------------------------------------- failure modes -- */

describe("a server failure never destroys local history", () => {
  it("keeps every local conversation when the account cannot be read", async () => {
    localHistory = [LOCAL_OLD, conversation("conv_mfxlocal0003")];
    listFails = true;

    const captured = await mount();

    expect(captured.store.conversations).toHaveLength(2);
    /*
     * And the IndexedDB rewrite that follows must not have been handed a
     * shorter list — `storage.replace` deletes the collection first.
     */
    for (const write of replaced) expect(write.length).toBeGreaterThanOrEqual(2);
  });

  it("keeps the thread and reports the failure when a save gives up", async () => {
    saveFails = true;
    const captured = await mount();

    await act(async () => {
      captured.store.addConversation(conversation("conv_mfxbrandnew4"));
    });

    /* Four attempts with real backoff: 0.5s + 1s + 2s before it gives up. */
    await waitFor(() => expect(captured.store.conversationSyncFailed).toBe(true), {
      timeout: 10_000,
    });
    expect(captured.store.conversations.map((entry) => entry.id)).toContain(
      "conv_mfxbrandnew4",
    );
    expect(localHistory.map((entry) => entry.id)).toContain("conv_mfxbrandnew4");
  });
});

/* -------------------------------------------------------------- deleting -- */

describe("deleting and clearing reach the account", () => {
  it("deletes an account conversation from the account first", async () => {
    serverConversations = [conversation("conv_mfxotherdev")];
    storedIds = ["conv_mfxotherdev"];
    const captured = await mount();

    await act(async () => {
      await captured.store.removeConversation("conv_mfxotherdev");
    });

    expect(calls.deleted).toEqual(["conv_mfxotherdev"]);
    expect(captured.store.conversations.map((entry) => entry.id)).not.toContain(
      "conv_mfxotherdev",
    );
  });

  it("does not call the account for a conversation that was never on it", async () => {
    localHistory = [LOCAL_OLD];
    const captured = await mount();

    await act(async () => {
      await captured.store.removeConversation(LOCAL_OLD.id);
    });

    expect(calls.deleted).toEqual([]);
    expect(captured.store.conversations).toHaveLength(0);
  });

  it("clears the account before clearing the browser", async () => {
    localHistory = [LOCAL_OLD];
    const captured = await mount();

    await act(async () => {
      await captured.store.clearConversations();
    });

    expect(calls.cleared).toBe(1);
    expect(captured.store.conversations).toEqual([]);
  });
});

/* ------------------------------------------------------------ demo mode -- */

describe("demo mode touches no server at all", () => {
  it("saves nothing, offers no import, and says history is local", async () => {
    process.env.NEXT_PUBLIC_DEMO_MODE = "true";
    vi.resetModules();

    localHistory = [LOCAL_OLD];
    const captured = await mount();

    await act(async () => {
      captured.store.addConversation(conversation("conv_mfxdemo00001"));
    });

    expect(calls.saved).toEqual([]);
    expect(calls.imported).toEqual([]);
    expect(captured.store.importableConversations).toEqual([]);
    expect(captured.store.accountHistory).toBe(false);
  });
});
