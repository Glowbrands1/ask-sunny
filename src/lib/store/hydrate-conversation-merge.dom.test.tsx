// @vitest-environment jsdom
import * as React from "react";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { sendAfterHydrateEnabled } from "@/lib/config/chat-quality-flags";
import { createId } from "@/lib/utils/id";
import type { ChatConversation, ChatMessage } from "@/types";

/**
 * A question sent while hydration is still waiting on `listDocuments`.
 *
 * The replace at the end of that wait used to throw the conversation away.
 * With SEND_AFTER_HYDRATE_ENABLED the snapshot is merged under it, so the
 * question and the reply are still there, and the reply is not dropped when
 * the account fetch is a snapshot from before the save. Off, the replace
 * stands and an append to the missing id stays silent.
 */

const ORIGINAL = { ...process.env };

const calls = {
  saved: [] as ChatConversation[],
};

let serverConversations: ChatConversation[] = [];
let localHistory: ChatConversation[] = [];

const documents = vi.hoisted(() => {
  let release: () => void = () => {};
  let pending = Promise.resolve();
  return {
    hold() {
      pending = new Promise<void>((resolve) => {
        release = resolve;
      });
    },
    release() {
      release();
    },
    wait() {
      return pending;
    },
  };
});

vi.mock("@/lib/chat/client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/chat/client")>(
    "@/lib/chat/client",
  );
  return {
    ...actual,
    fetchOwnConversations: async () => serverConversations,
    fetchHistoryState: async () => ({
      stored: serverConversations.map((entry) => ({
        id: entry.id,
        messages: entry.messages.length,
      })),
      deleted: [],
      clearedAt: null,
    }),
    saveOwnConversation: async (conversation: ChatConversation) => {
      calls.saved.push(conversation);
    },
    deleteOwnConversation: async () => {},
    clearOwnConversations: async () => {},
    importConversationBatch: async () => ({ imported: [], declined: [] }),
  };
});

vi.mock("@/lib/storage", async () => {
  const actual = await vi.importActual<typeof import("@/lib/storage")>("@/lib/storage");
  return {
    ...actual,
    getStorageProvider: () => ({
      name: "fake",
      isAvailable: () => true,
      list: async (collection: string) =>
        collection === "chat_conversations" ? localHistory : [],
      replace: async () => {},
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

vi.mock("@/lib/knowledge", () => ({
  getKnowledgeProvider: () => ({
    listDocuments: () => documents.wait().then(() => []),
  }),
  getLocalKnowledgeProvider: () => ({ setDocuments: () => {} }),
}));

function turn(
  id: string,
  role: "user" | "assistant",
  content: string,
  createdAt: string,
): ChatMessage {
  return { id, role, content, createdAt };
}

function conversation(
  id: string,
  title: string,
  messages: ChatMessage[],
  updatedAt: string,
): ChatConversation {
  return {
    id,
    title,
    createdAt: messages[0]?.createdAt ?? updatedAt,
    updatedAt,
    attachedDocumentIds: [],
    messages,
  };
}

const STORED_AT = "2026-10-01T10:00:00.000Z";
const ASKED_AT = "2026-10-24T12:00:00.000Z";
const ANSWERED_AT = "2026-10-24T12:00:01.000Z";

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

  return captured as { store: Store };
}

function byId(store: Store, id: string) {
  return store.conversations.find((entry) => entry.id === id);
}

beforeEach(() => {
  vi.resetModules();
  process.env.NEXT_PUBLIC_DEMO_MODE = "false";
  delete process.env.SEND_AFTER_HYDRATE_ENABLED;
  delete process.env.NEXT_PUBLIC_SEND_AFTER_HYDRATE_ENABLED;
  calls.saved = [];
  serverConversations = [];
  localHistory = [];
  documents.hold();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "trace").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  process.env = { ...ORIGINAL };
});

describe("the flag", () => {
  it("defaults off, and either spelling turns it on", () => {
    expect(sendAfterHydrateEnabled()).toBe(false);
    process.env.SEND_AFTER_HYDRATE_ENABLED = "1";
    expect(sendAfterHydrateEnabled()).toBe(true);
    process.env.SEND_AFTER_HYDRATE_ENABLED = "false";
    expect(sendAfterHydrateEnabled()).toBe(false);
    delete process.env.SEND_AFTER_HYDRATE_ENABLED;
    process.env.NEXT_PUBLIC_SEND_AFTER_HYDRATE_ENABLED = "on";
    expect(sendAfterHydrateEnabled()).toBe(true);
  });
});

describe("hydration merges a conversation created while documents load", () => {
  const storedId = createId("conv");
  const stored = conversation(
    storedId,
    "Weekend coverage",
    [turn(createId("msg"), "user", "Who covers Saturday?", STORED_AT)],
    STORED_AT,
  );

  async function settle(captured: { store: Store }) {
    await act(async () => {
      documents.release();
    });
    await waitFor(() => expect(captured.store.ready).toBe(true));
    await waitFor(() => expect(captured.store.accountConversationIds).not.toBeNull());
  }

  it("keeps the question and the reply, and syncs them, when the flag is on", async () => {
    process.env.SEND_AFTER_HYDRATE_ENABLED = "1";
    localHistory = [stored];
    const createdId = createId("conv");
    const question = turn(createId("msg"), "user", "How do I request time off?", ASKED_AT);
    const reply = turn(
      createId("msg"),
      "assistant",
      "Request time off through the schedule.",
      ANSWERED_AT,
    );
    const created = conversation(createdId, "How do I request time off?", [question], ASKED_AT);

    /*
     * The account fetch is the snapshot from before the reply was saved:
     * the question is there, the answer is not. That is conv 0e874039, and
     * it is the t80g case when the reply had already been saved but this
     * fetch left before it. The local reply has to survive that merge.
     */
    serverConversations = [
      conversation(createdId, created.title, [question], ASKED_AT),
    ];

    const captured = await mount();
    expect(captured.store.ready).toBe(false);

    act(() => {
      captured.store.addConversation(created);
      captured.store.appendConversationMessages(createdId, [reply]);
    });

    await settle(captured);

    expect(byId(captured.store, storedId)?.messages.map((message) => message.content)).toEqual([
      "Who covers Saturday?",
    ]);
    expect(byId(captured.store, createdId)?.messages.map((message) => message.content)).toEqual([
      "How do I request time off?",
      "Request time off through the schedule.",
    ]);

    await waitFor(() => {
      expect(
        calls.saved.some(
          (entry) =>
            entry.id === createdId &&
            entry.messages.some((message) => message.content === "Request time off through the schedule."),
        ),
      ).toBe(true);
    });
    expect(calls.saved.some((entry) => entry.id === storedId)).toBe(false);
  });

  it("keeps the same conversation when only the public spelling is set", async () => {
    process.env.NEXT_PUBLIC_SEND_AFTER_HYDRATE_ENABLED = "1";
    localHistory = [stored];
    const createdId = createId("conv");
    const created = conversation(
      createdId,
      "How do I request time off?",
      [turn(createId("msg"), "user", "How do I request time off?", ASKED_AT)],
      ASKED_AT,
    );

    const captured = await mount();
    act(() => {
      captured.store.addConversation(created);
    });
    await settle(captured);

    expect(byId(captured.store, createdId)?.messages[0]?.content).toBe(
      "How do I request time off?",
    );
    expect(byId(captured.store, storedId)).toBeTruthy();
  });

  it("prefers the stored copy of a shared turn and still keeps the new one", async () => {
    process.env.SEND_AFTER_HYDRATE_ENABLED = "1";
    const sharedId = createId("msg");
    const onDisk = conversation(
      storedId,
      "Weekend coverage",
      [turn(sharedId, "user", "stored wording", STORED_AT)],
      STORED_AT,
    );
    localHistory = [onDisk];
    const reply = turn(createId("msg"), "assistant", "the reply", ANSWERED_AT);

    const captured = await mount();
    act(() => {
      captured.store.addConversation(
        conversation(
          storedId,
          "Weekend coverage",
          [turn(sharedId, "user", "edited wording", ASKED_AT), reply],
          ANSWERED_AT,
        ),
      );
    });
    await settle(captured);

    const messages = byId(captured.store, storedId)?.messages ?? [];
    expect(messages.map((message) => message.content)).toEqual(["stored wording", "the reply"]);
    expect(captured.store.conversations.filter((entry) => entry.id === storedId)).toHaveLength(1);
  });

  it("replaces the list and stays quiet when the flag is off", async () => {
    localHistory = [stored];
    const createdId = createId("conv");
    const created = conversation(
      createdId,
      "How do I request time off?",
      [turn(createId("msg"), "user", "How do I request time off?", ASKED_AT)],
      ASKED_AT,
    );

    const captured = await mount();
    act(() => {
      captured.store.addConversation(created);
      captured.store.appendConversationMessages(createdId, [
        turn(createId("msg"), "assistant", "Request time off through the schedule.", ANSWERED_AT),
      ]);
    });
    await settle(captured);

    expect(byId(captured.store, createdId)).toBeUndefined();
    expect(captured.store.conversations.map((entry) => entry.id)).toEqual([storedId]);

    act(() => {
      captured.store.appendConversationMessages(createdId, [
        turn(createId("msg"), "assistant", "Request time off through the schedule.", ANSWERED_AT),
      ]);
    });

    expect(byId(captured.store, createdId)).toBeUndefined();
    expect(vi.mocked(console.warn).mock.calls.flat().join(" ")).not.toContain("dropped");
    expect(vi.mocked(console.trace)).not.toHaveBeenCalled();
    expect(calls.saved.some((entry) => entry.id === createdId)).toBe(false);
  });

  it("shows a reply the account fetch already has, flag off, because that merge is a union", async () => {
    /*
     * t80g is not a hole in the account merge. A reply that is already in
     * the snapshot comes back onto the screen. It stays missing only when
     * that snapshot was taken before the save and the local copy was wiped
     * first — the case the flag-on test keeps.
     */
    localHistory = [stored];
    const createdId = createId("conv");
    const question = turn(createId("msg"), "user", "How do I request time off?", ASKED_AT);
    const reply = turn(
      createId("msg"),
      "assistant",
      "Request time off through the schedule.",
      ANSWERED_AT,
    );
    serverConversations = [
      conversation(createdId, "How do I request time off?", [question, reply], ANSWERED_AT),
    ];

    const captured = await mount();
    act(() => {
      captured.store.addConversation(
        conversation(createdId, "How do I request time off?", [question, reply], ANSWERED_AT),
      );
    });
    await settle(captured);

    expect(byId(captured.store, createdId)?.messages.map((message) => message.content)).toEqual([
      "How do I request time off?",
      "Request time off through the schedule.",
    ]);
  });
});

describe("an append to an unknown conversation", () => {
  it("warns when the flag is on and stays silent when it is off", async () => {
    localHistory = [
      conversation(
        createId("conv"),
        "Weekend coverage",
        [turn(createId("msg"), "user", "Who covers Saturday?", STORED_AT)],
        STORED_AT,
      ),
    ];

    process.env.SEND_AFTER_HYDRATE_ENABLED = "1";
    const on = await mount();
    await act(async () => {
      documents.release();
    });
    await waitFor(() => expect(on.store.ready).toBe(true));

    const missing = createId("conv");
    await act(async () => {
      on.store.appendConversationMessages(missing, [
        turn(createId("msg"), "assistant", "Request time off through the schedule.", ANSWERED_AT),
      ]);
    });
    expect(vi.mocked(console.warn)).toHaveBeenCalledWith(
      `[chat] append dropped: conversation ${missing} is not in the store`,
    );
    expect(vi.mocked(console.trace)).toHaveBeenCalledWith(
      `[chat] append dropped: conversation ${missing} is not in the store`,
    );

    const known = on.store.conversations[0]!;
    vi.mocked(console.warn).mockClear();
    vi.mocked(console.trace).mockClear();
    await act(async () => {
      on.store.appendConversationMessages(known.id, []);
      on.store.appendConversationMessages(known.id, [
        turn(createId("msg"), "user", "one more", ANSWERED_AT),
      ]);
      on.store.patchConversationMessage(missing, createId("msg"), { content: "x" });
    });
    expect(vi.mocked(console.warn)).toHaveBeenCalledWith(
      expect.stringContaining(`[chat] patch dropped: conversation ${missing} is not in the store`),
    );
    expect(vi.mocked(console.warn).mock.calls.flat().join(" ")).not.toContain(known.id);

    cleanup();
    vi.mocked(console.warn).mockClear();
    vi.mocked(console.trace).mockClear();
    documents.hold();
    delete process.env.SEND_AFTER_HYDRATE_ENABLED;
    vi.resetModules();

    const off = await mount();
    await act(async () => {
      documents.release();
    });
    await waitFor(() => expect(off.store.ready).toBe(true));
    await act(async () => {
      off.store.appendConversationMessages(createId("conv"), [
        turn(createId("msg"), "assistant", "nope", ANSWERED_AT),
      ]);
      off.store.patchConversationMessage(createId("conv"), createId("msg"), { content: "x" });
    });
    expect(vi.mocked(console.warn).mock.calls.flat().join(" ")).not.toContain("dropped");
    expect(vi.mocked(console.trace)).not.toHaveBeenCalled();
  });
});
