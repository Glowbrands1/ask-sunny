import { describe, expect, it, vi } from "vitest";

import type { ChatConversation } from "@/types";
import { ChatSyncFailure } from "./client";
import { createConversationSync } from "./sync";

/**
 * A FAILED SAVE MUST COST NOTHING THAT WAS ON SCREEN.
 *
 * The queue never writes to React state or to IndexedDB — the thread is already
 * in both before it is ever called — so the worst outcome of a total outage is
 * the product behaving exactly as it did before this phase. What these tests
 * hold is the rest of the contract: retries converge, a hopeless request is not
 * retried forever, and a person is told when the account's copy is stale.
 */

function conversation(id: string, messages = 1): ChatConversation {
  return {
    id,
    title: `${id} title`,
    createdAt: "2026-09-01T10:00:00.000Z",
    updatedAt: `2026-09-01T10:0${messages}:00.000Z`,
    attachedDocumentIds: [],
    messages: Array.from({ length: messages }, (_unused, index) => ({
      id: `msg_${index}`,
      role: "user" as const,
      content: `turn ${index}`,
      createdAt: "2026-09-01T10:00:00.000Z",
    })),
  };
}

/** Backoff without the wait. */
const instant = async () => {};

describe("saving a conversation", () => {
  it("sends it once and reports it synced", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const sync = createConversationSync({ save, delay: instant });

    sync.queue(conversation("conv_a"));
    await sync.settled();

    expect(save).toHaveBeenCalledTimes(1);
    expect(sync.status("conv_a")).toBe("synced");
    expect(sync.hasFailures()).toBe(false);
  });

  it("coalesces rapid changes into the LATEST snapshot", async () => {
    /*
     * A fast conversation should produce one save per pause, not one per state
     * change — and the one that goes must be the newest, or the account's copy
     * would be stale the moment it was written.
     */
    const waiting: (() => void)[] = [];
    const save = vi
      .fn()
      .mockImplementation(
        () => new Promise<void>((resolve) => void waiting.push(resolve)),
      );
    const sync = createConversationSync({ save, delay: instant });

    /* The first save goes out immediately; the next two collapse behind it. */
    sync.queue(conversation("conv_a", 1));
    sync.queue(conversation("conv_a", 2));
    sync.queue(conversation("conv_a", 3));

    await vi.waitFor(() => expect(waiting).toHaveLength(1));
    waiting.shift()!();

    await vi.waitFor(() => expect(waiting).toHaveLength(1));
    expect(save).toHaveBeenCalledTimes(2);
    /* The second send carries the newest state, not the one queued next. */
    expect(save.mock.calls[1][0].messages).toHaveLength(3);

    waiting.shift()!();
    await sync.settled();
    expect(save).toHaveBeenCalledTimes(2);
  });

  it("never runs two saves for one conversation at the same time", async () => {
    let inFlight = 0;
    let peak = 0;
    const save = vi.fn().mockImplementation(async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await Promise.resolve();
      inFlight -= 1;
    });

    const sync = createConversationSync({ save, delay: instant });
    sync.queue(conversation("conv_a", 1));
    sync.queue(conversation("conv_a", 2));
    sync.queue(conversation("conv_b", 1));
    await sync.settled();

    expect(peak).toBe(1);
  });
});

describe("retries converge rather than accumulate", () => {
  it("retries a 503 and succeeds without the caller doing anything", async () => {
    const save = vi
      .fn()
      .mockRejectedValueOnce(new ChatSyncFailure("down", 503, true))
      .mockRejectedValueOnce(new ChatSyncFailure("down", 503, true))
      .mockResolvedValue(undefined);

    const sync = createConversationSync({ save, delay: instant });
    sync.queue(conversation("conv_a"));
    await sync.settled();

    expect(save).toHaveBeenCalledTimes(3);
    expect(sync.status("conv_a")).toBe("synced");
    /*
     * Every attempt sent the SAME thread. The server matches each turn on its
     * client id, so three attempts leave one copy — which is what makes
     * retrying safe at all, and is asserted end to end against the route in
     * `import-safety.test.ts`.
     */
    for (const call of save.mock.calls) {
      expect(call[0].messages.map((message: { id: string }) => message.id)).toEqual([
        "msg_0",
      ]);
    }
  });

  it("gives up after the attempt budget and says so", async () => {
    const save = vi.fn().mockRejectedValue(new ChatSyncFailure("down", 503, true));
    const sync = createConversationSync({ save, delay: instant, maxAttempts: 3 });

    sync.queue(conversation("conv_a"));
    await sync.settled();

    expect(save).toHaveBeenCalledTimes(3);
    expect(sync.status("conv_a")).toBe("error");
    expect(sync.hasFailures()).toBe(true);
  });

  it("does NOT retry a refusal, which would be an invisible loop", async () => {
    const save = vi.fn().mockRejectedValue(new ChatSyncFailure("refused", 400, false));
    const sync = createConversationSync({ save, delay: instant });

    sync.queue(conversation("conv_a"));
    await sync.settled();

    expect(save).toHaveBeenCalledTimes(1);
    expect(sync.status("conv_a")).toBe("error");
  });

  it("does not retry after the session has ended", async () => {
    const save = vi.fn().mockRejectedValue(new ChatSyncFailure("signed out", 401, false));
    const sync = createConversationSync({ save, delay: instant });

    sync.queue(conversation("conv_a"));
    await sync.settled();

    expect(save).toHaveBeenCalledTimes(1);
  });

  it("re-arms what failed when a person presses Try again", async () => {
    const save = vi
      .fn()
      .mockRejectedValueOnce(new ChatSyncFailure("down", 503, false))
      .mockResolvedValue(undefined);
    const sync = createConversationSync({ save, delay: instant });

    sync.queue(conversation("conv_a"));
    await sync.settled();
    expect(sync.status("conv_a")).toBe("error");

    sync.retryFailed();
    await sync.settled();

    expect(sync.status("conv_a")).toBe("synced");
    expect(sync.hasFailures()).toBe(false);
  });

  it("sends the newest snapshot when one arrives during a retry", async () => {
    const save = vi
      .fn()
      .mockRejectedValueOnce(new ChatSyncFailure("down", 503, true))
      .mockResolvedValue(undefined);

    const sync = createConversationSync({ save, delay: instant });
    sync.queue(conversation("conv_a", 1));
    /* The person keeps typing while the first attempt is failing. */
    sync.queue(conversation("conv_a", 4));
    await sync.settled();

    expect(save.mock.calls.at(-1)![0].messages).toHaveLength(4);
    expect(sync.status("conv_a")).toBe("synced");
  });
});

describe("what a surface can render from", () => {
  it("notifies subscribers as state moves", async () => {
    const listener = vi.fn();
    const sync = createConversationSync({
      save: vi.fn().mockResolvedValue(undefined),
      delay: instant,
    });
    sync.subscribe(listener);

    sync.queue(conversation("conv_a"));
    await sync.settled();

    expect(listener).toHaveBeenCalled();
  });

  it("forgets a conversation that no longer exists locally", async () => {
    const sync = createConversationSync({
      save: vi.fn().mockRejectedValue(new ChatSyncFailure("down", 400, false)),
      delay: instant,
    });

    sync.queue(conversation("conv_a"));
    await sync.settled();
    expect(sync.hasFailures()).toBe(true);

    sync.forget("conv_a");
    expect(sync.status("conv_a")).toBeUndefined();
    expect(sync.hasFailures()).toBe(false);
  });

  it("treats an unexpected error as retryable rather than giving up", async () => {
    /* A thrown TypeError is a bug or a transient runtime fault, not a refusal. */
    const save = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("boom"))
      .mockResolvedValue(undefined);
    const sync = createConversationSync({ save, delay: instant });

    sync.queue(conversation("conv_a"));
    await sync.settled();

    expect(save).toHaveBeenCalledTimes(2);
    expect(sync.status("conv_a")).toBe("synced");
  });
});
