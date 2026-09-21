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
let historyState: {
  stored: { id: string; messages: number }[];
  deleted: string[];
  clearedAt: string | null;
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

describe("hydration uploads nothing", () => {
  it("saves nothing when a browser full of history loads", async () => {
    localHistory = [LOCAL_OLD, SEED, conversation("conv_mfxlocal0002")];

    const captured = await mount();

    expect(calls.saved).toEqual([]);
    expect(calls.imported).toEqual([]);
    /*
     * TWO, NOT THREE: the seeded thread this browser was given by an earlier
     * build is removed on hydration by `purgeDemoRecords`, which is a separate
     * fix on `main` and is why it is not in the list. The real conversations
     * are both still here, and neither was sent anywhere.
     */
    expect(captured.store.conversations.map((entry) => entry.id)).toEqual([
      LOCAL_OLD.id,
      "conv_mfxlocal0002",
    ]);
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

  it("never sends a seeded demo thread a browser was given by an earlier build", async () => {
    /*
     * A DEFECT THAT WAS REAL, PINNED FROM BOTH SIDES.
     *
     * The store used to seed `DEMO_CONVERSATIONS` into state in BOTH modes, so
     * a browser with nothing stored still held six fabricated threads — and an
     * early version of the sync effect, which marked only the STORED
     * conversations as pre-existing, tried to send every one of them. Nothing
     * would have been stored (the route refuses them, non-retryably), but an
     * attempt to upload local content nobody approved is exactly what this
     * phase exists to make impossible, and "the server would have said no" is
     * not the standard.
     *
     * `main` has since removed the seeds at the root — they are not compiled
     * into a production build and `purgeDemoRecords` takes the copies out of
     * browsers that already have them. This asserts BOTH halves hold: the seed
     * leaves the visible history, and nothing about it is ever sent.
     */
    localHistory = [SEED, LOCAL_OLD];
    const captured = await mount();

    expect(captured.store.conversations.map((entry) => entry.id)).not.toContain(
      "conv-seed-1",
    );
    expect(calls.saved).toEqual([]);

    /* And still nothing after an unrelated state change re-runs the effect. */
    await act(async () => {
      captured.store.saveForm({ id: "form-seed-check" } as never);
    });
    expect(calls.saved).toEqual([]);
    expect(JSON.stringify(calls)).not.toContain("conv-seed");
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
    historyState = {
      stored: [{ id: LOCAL_OLD.id, messages: LOCAL_OLD.messages.length }],
      deleted: [],
      clearedAt: null,
    };
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
    historyState = {
      stored: [{ id: "conv_mfxotherdev", messages: 1 }],
      deleted: [],
      clearedAt: null,
    };

    const captured = await mount();

    expect(captured.store.conversations.map((entry) => entry.id)).toEqual([
      "conv_mfxotherdev",
      LOCAL_OLD.id,
    ]);
  });

  it("lets it be continued from here", async () => {
    serverConversations = [conversation("conv_mfxotherdev", "2026-09-05T10:00:00.000Z")];
    historyState = {
      stored: [{ id: "conv_mfxotherdev", messages: 1 }],
      deleted: [],
      clearedAt: null,
    };
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
    historyState = {
      stored: [{ id: "conv_mfxotherdev", messages: 1 }],
      deleted: [],
      clearedAt: null,
    };
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

/* ------------------------------------------------- the wrong-clock case -- */

describe("a browser whose clock was wrong cannot defeat Clear History", () => {
  /*
   * Every instant is derived from the clock and sits in the PAST, so nothing is
   * clamped on the way through and the scenario means the same thing whenever
   * the suite runs.
   */
  const day = 24 * 60 * 60 * 1000;
  const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();

  /** T — the authoritative server instant of the clear. */
  const CLEARED_AT = iso(10 * day);

  /**
   * Device B's clock was a day fast when this was created, so its local
   * createdAt lands AFTER the clear even though the conversation is older.
   */
  const STALE = conversation("conv_mfxstaleclk1", iso(9 * day), iso(9 * day));

  it("removes it from history, from IndexedDB, and from the import offer", async () => {
    localHistory = [STALE];
    historyState = { stored: [], deleted: [], clearedAt: CLEARED_AT };

    const captured = await mount();

    /* The stamp really does claim to post-date the clear. */
    expect(Date.parse(STALE.createdAt)).toBeGreaterThan(Date.parse(CLEARED_AT));

    await waitFor(() =>
      expect(captured.store.conversations.map((entry) => entry.id)).toEqual([]),
    );
    expect(captured.store.importableConversations).toEqual([]);
    /* And the persist effect takes it out of this browser's own copy. */
    await waitFor(() => expect(localHistory.map((entry) => entry.id)).toEqual([]));
    expect(calls.saved).toEqual([]);
    expect(calls.imported).toEqual([]);
  });

  it("still lets a conversation started after the clear work normally", async () => {
    localHistory = [STALE];
    historyState = { stored: [], deleted: [], clearedAt: CLEARED_AT };

    const captured = await mount();
    await waitFor(() => expect(captured.store.conversations).toHaveLength(0));

    const fresh = conversation("conv_mfxafterclk1", iso(1 * day), iso(1 * day));
    await act(async () => {
      captured.store.addConversation(fresh);
    });

    /* Shown, and synced to the account without anybody being asked. */
    expect(captured.store.conversations.map((entry) => entry.id)).toEqual([fresh.id]);
    await waitFor(() =>
      expect(calls.saved.map((entry) => entry.id)).toContain(fresh.id),
    );
  });

  it("does not re-sweep a post-clear conversation on the NEXT load", async () => {
    /*
     * THE REASON THE APPLIED BOUNDARY IS REMEMBERED. On the visit after the
     * sweep, a conversation had after the clear IS on disk at hydration — and
     * if the sweep ran again it would be destroyed, losing work somebody did
     * after clearing.
     */
    localHistory = [STALE];
    historyState = { stored: [], deleted: [], clearedAt: CLEARED_AT };

    /* Session one: the sweep runs, the stale conversation goes. */
    const first = await mount();
    await waitFor(() => expect(first.store.conversations).toHaveLength(0));

    const hadAfterClear = conversation("conv_mfxafterclk2", iso(1 * day), iso(1 * day));
    await act(async () => {
      first.store.addConversation(hadAfterClear);
    });
    await waitFor(() => expect(localHistory).toHaveLength(1));

    cleanup();

    /*
     * Session two: same browser, same boundary, and the conversation had after
     * the clear is now a pre-existing local record. It must survive.
     */
    const second = await mount();
    await waitFor(() =>
      expect(second.store.conversations.map((entry) => entry.id)).toEqual([
        hadAfterClear.id,
      ]),
    );
    expect(localHistory.map((entry) => entry.id)).toEqual([hadAfterClear.id]);
  });

  it("re-arms for a SECOND clear, because the boundary value changes", async () => {
    localHistory = [STALE];
    historyState = { stored: [], deleted: [], clearedAt: CLEARED_AT };

    const first = await mount();
    await waitFor(() => expect(first.store.conversations).toHaveLength(0));

    const hadAfterFirstClear = conversation("conv_mfxafterclk3", iso(1 * day), iso(1 * day));
    await act(async () => {
      first.store.addConversation(hadAfterFirstClear);
    });
    await waitFor(() => expect(localHistory).toHaveLength(1));

    cleanup();

    /* A second clear, on another device, at a later instant. */
    historyState = { stored: [], deleted: [], clearedAt: iso(12 * 60 * 60 * 1000) };

    const second = await mount();
    await waitFor(() => expect(second.store.conversations).toEqual([]));
  });

  it("suppresses nothing when the account could not be reached", async () => {
    /* An outage must never be able to imitate a clear. */
    localHistory = [STALE];
    listFails = true;

    const captured = await mount();

    expect(captured.store.conversations.map((entry) => entry.id)).toEqual([STALE.id]);
    expect(localHistory.map((entry) => entry.id)).toEqual([STALE.id]);
  });
});
