// @vitest-environment jsdom
import * as React from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AppStoreProvider, useAppStore } from "./app-store";
import type { ChatConversation, ChatMessage } from "@/types";

/**
 * ============================================================================
 * REMEDIATION FINDING 2 — A MESSAGE PATCH MUST NOT REWRITE THE CONVERSATION
 * ============================================================================
 *
 * THE RACE. Callers persisted a message change as
 * `updateConversation(id, { messages: activeConversation.messages.map(...) })`
 * — mapping over an array captured when the callback was created. `setState`
 * is functional and safe; the PATCH was a snapshot. Any turn added between the
 * capture and the write was silently erased by it.
 *
 * The window is not theoretical: creating a form from chat awaits a network
 * call and then an assistant draft that may run for up to two minutes. A
 * manager who types while waiting — which is what people do while waiting —
 * lost it the moment the form reference landed.
 */

vi.mock("@/lib/utils/client-store", () => ({
  createClientStore: () => ({
    ready: true,
    available: false,
    read: async () => null,
    write: async () => {},
    clearAll: async () => {},
  }),
}));

function turn(id: string, role: "user" | "assistant", content: string): ChatMessage {
  return { id, role, content, createdAt: "2026-09-07T12:00:00Z" };
}

const SEED: ChatConversation = {
  id: "conv-1",
  title: "Coaching",
  createdAt: "2026-09-07T12:00:00Z",
  updatedAt: "2026-09-07T12:00:00Z",
  attachedDocumentIds: [],
  messages: [turn("m1", "user", "Sarah was late."), turn("m2", "assistant", "Proposal.")],
};

type Store = ReturnType<typeof useAppStore>;

function harness() {
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

  act(() => {
    captured.store!.addConversation(SEED);
  });

  return captured;
}

function conversation(captured: { store: Store | null }) {
  return captured.store!.conversations.find((entry) => entry.id === "conv-1")!;
}

afterEach(cleanup);

describe("F2. patching one message leaves everything else alone", () => {
  it("does not erase a turn added after the patch was decided on", async () => {
    const captured = harness();

    /*
     * The exact sequence: a long-running Create draft captures the callback,
     * the manager sends another message, and only then does the reference land.
     */
    const staleStore = captured.store!;

    act(() => {
      staleStore.appendConversationMessages("conv-1", [
        turn("m3", "user", "Actually it was twice."),
      ]);
    });

    act(() => {
      // Called through the STALE reference, as a real in-flight callback would
      // be — the store's own updater is what makes it safe.
      staleStore.patchConversationMessage("conv-1", "m2", {
        formInstanceRef: {
          instanceId: "inst-42",
          proposalId: "prop-1",
          templateName: "Coaching Form",
        },
      });
    });

    const after = conversation(captured);
    expect(after.messages.map((message) => message.id)).toEqual(["m1", "m2", "m3"]);
    expect(after.messages[2]!.content).toBe("Actually it was twice.");
    expect(after.messages[1]!.formInstanceRef!.instanceId).toBe("inst-42");
  });

  it("patches only the target message", () => {
    const captured = harness();

    act(() => {
      captured.store!.patchConversationMessage("conv-1", "m2", {
        formInstanceRef: {
          instanceId: "inst-42",
          proposalId: "prop-1",
          templateName: "Coaching Form",
        },
      });
    });

    const after = conversation(captured);
    expect(after.messages[0]!.formInstanceRef).toBeUndefined();
    expect(after.messages[0]!.content).toBe("Sarah was late.");
  });

  it("is a no-op when the message is gone, rather than resurrecting it", () => {
    // The thread was cleared while the request was in flight. Writing nothing
    // is the right answer; re-adding a message nobody can see is not.
    const captured = harness();

    act(() => {
      captured.store!.patchConversationMessage("conv-1", "m-deleted", {
        formInstanceRef: {
          instanceId: "inst-42",
          proposalId: "prop-1",
          templateName: "Coaching Form",
        },
      });
    });

    const after = conversation(captured);
    expect(after.messages.map((message) => message.id)).toEqual(["m1", "m2"]);
  });

  it("is a no-op for a conversation that no longer exists", () => {
    const captured = harness();
    // Counted rather than asserted at 1: with no storage the provider seeds the
    // demo conversations, and this is about the patch changing nothing.
    const before = captured.store!.conversations.length;

    act(() => {
      captured.store!.patchConversationMessage("conv-gone", "m2", { content: "x" });
    });

    expect(captured.store!.conversations).toHaveLength(before);
    expect(conversation(captured).messages).toHaveLength(2);
  });
});

describe("F2. appending turns cannot overwrite either", () => {
  it("adds to current state rather than rewriting from a snapshot", () => {
    const captured = harness();
    const staleStore = captured.store!;

    act(() => {
      staleStore.patchConversationMessage("conv-1", "m2", {
        formInstanceRef: {
          instanceId: "inst-42",
          proposalId: "prop-1",
          templateName: "Coaching Form",
        },
      });
    });

    act(() => {
      // A send that began before the patch, completing after it. Rewriting the
      // array from its own `history` snapshot would drop the reference.
      staleStore.appendConversationMessages("conv-1", [turn("m3", "assistant", "Answer.")]);
    });

    const after = conversation(captured);
    expect(after.messages).toHaveLength(3);
    expect(after.messages[1]!.formInstanceRef!.instanceId).toBe("inst-42");
  });

  it("ignores an empty append", () => {
    const captured = harness();
    act(() => {
      captured.store!.appendConversationMessages("conv-1", []);
    });
    expect(conversation(captured).messages).toHaveLength(2);
  });
});
