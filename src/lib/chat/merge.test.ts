import { describe, expect, it } from "vitest";

import type { ChatConversation, ChatMessage } from "@/types";
import { mergeConversations } from "./merge";

/**
 * MERGING IS A UNION, AND THAT IS A DATA-SAFETY RULE RATHER THAN A PREFERENCE.
 *
 * `AppStoreProvider` writes conversation state back to IndexedDB with
 * `storage.replace()`, which deletes the whole collection and rewrites it. So a
 * merge that returned fewer conversations than the browser already held would
 * not merely display less — it would ERASE the local copy, which is this
 * phase's rollback protection.
 */

function message(id: string, createdAt: string, content = id): ChatMessage {
  return { id, role: "user", content, createdAt };
}

function conversation(
  id: string,
  updatedAt: string,
  messages: ChatMessage[],
  overrides: Partial<ChatConversation> = {},
): ChatConversation {
  return {
    id,
    title: `${id} title`,
    createdAt: messages[0]?.createdAt ?? updatedAt,
    updatedAt,
    attachedDocumentIds: [],
    messages,
    ...overrides,
  };
}

describe("nothing is ever dropped", () => {
  it("keeps a local-only conversation the account has never seen", () => {
    const local = [conversation("conv_a", "2026-09-01T10:00:00.000Z", [
      message("msg_a1", "2026-09-01T10:00:00.000Z"),
    ])];

    const merged = mergeConversations(local, []);

    expect(merged.map((entry) => entry.id)).toEqual(["conv_a"]);
    expect(merged[0].messages).toHaveLength(1);
  });

  it("adds an account conversation this browser has never seen", () => {
    const server = [conversation("conv_b", "2026-09-02T10:00:00.000Z", [
      message("msg_b1", "2026-09-02T10:00:00.000Z"),
    ])];

    const merged = mergeConversations([], server);
    expect(merged.map((entry) => entry.id)).toEqual(["conv_b"]);
  });

  it("keeps both sides when each has something the other does not", () => {
    const merged = mergeConversations(
      [conversation("conv_a", "2026-09-01T10:00:00.000Z", [])],
      [conversation("conv_b", "2026-09-02T10:00:00.000Z", [])],
    );
    expect(merged.map((entry) => entry.id).sort()).toEqual(["conv_a", "conv_b"]);
  });

  it("orders the result newest first, the way History reads it", () => {
    const merged = mergeConversations(
      [conversation("conv_old", "2026-09-01T10:00:00.000Z", [])],
      [conversation("conv_new", "2026-09-05T10:00:00.000Z", [])],
    );
    expect(merged.map((entry) => entry.id)).toEqual(["conv_new", "conv_old"]);
  });
});

describe("a conversation held on both sides", () => {
  it("unions the turns rather than choosing a side", () => {
    /* Continued on another device, and continued here before hydration. */
    const local = [
      conversation("conv_a", "2026-09-03T10:00:00.000Z", [
        message("msg_1", "2026-09-01T10:00:00.000Z"),
        message("msg_local", "2026-09-03T10:00:00.000Z"),
      ]),
    ];
    const server = [
      conversation("conv_a", "2026-09-02T10:00:00.000Z", [
        message("msg_1", "2026-09-01T10:00:00.000Z"),
        message("msg_server", "2026-09-02T10:00:00.000Z"),
      ]),
    ];

    const merged = mergeConversations(local, server);

    expect(merged).toHaveLength(1);
    expect(merged[0].messages.map((entry) => entry.id)).toEqual([
      "msg_1",
      "msg_server",
      "msg_local",
    ]);
  });

  it("prefers the LOCAL copy of a turn both sides hold", () => {
    /*
     * This browser may hold an edit that has not synced — a rating just left, a
     * form reference just attached. Preferring the server would silently undo
     * it on the next hydration.
     */
    const local = [
      conversation("conv_a", "2026-09-03T10:00:00.000Z", [
        { ...message("msg_1", "2026-09-01T10:00:00.000Z"), content: "edited here" },
      ]),
    ];
    const server = [
      conversation("conv_a", "2026-09-02T10:00:00.000Z", [
        { ...message("msg_1", "2026-09-01T10:00:00.000Z"), content: "older copy" },
      ]),
    ];

    expect(mergeConversations(local, server)[0].messages[0].content).toBe("edited here");
  });

  it("takes the later updatedAt and the earlier createdAt", () => {
    const local = [
      conversation("conv_a", "2026-09-03T10:00:00.000Z", [], {
        createdAt: "2026-08-01T10:00:00.000Z",
        title: "local title",
      }),
    ];
    const server = [
      conversation("conv_a", "2026-09-02T10:00:00.000Z", [], {
        createdAt: "2026-09-01T10:00:00.000Z",
        title: "server title",
      }),
    ];

    const merged = mergeConversations(local, server)[0];
    expect(merged.updatedAt).toBe("2026-09-03T10:00:00.000Z");
    expect(merged.createdAt).toBe("2026-08-01T10:00:00.000Z");
    expect(merged.title).toBe("local title");
  });

  it("never reorders within a side, even when timestamps tie", () => {
    /*
     * An assistant message and the question after it routinely share a
     * millisecond. Each list arrives already correctly ordered, so the merge
     * must interleave without re-sorting either.
     */
    const server = [
      conversation("conv_a", "2026-09-02T10:00:00.000Z", [
        message("msg_q", "2026-09-01T10:00:00.000Z"),
        message("msg_a", "2026-09-01T10:00:00.000Z"),
      ]),
    ];

    const merged = mergeConversations([], server);
    expect(merged[0].messages.map((entry) => entry.id)).toEqual(["msg_q", "msg_a"]);
  });

  it("is stable: merging the same inputs twice gives the same thread", () => {
    const local = [
      conversation("conv_a", "2026-09-03T10:00:00.000Z", [
        message("msg_1", "2026-09-01T10:00:00.000Z"),
        message("msg_local", "2026-09-03T10:00:00.000Z"),
      ]),
    ];
    const server = [
      conversation("conv_a", "2026-09-02T10:00:00.000Z", [
        message("msg_1", "2026-09-01T10:00:00.000Z"),
        message("msg_server", "2026-09-02T10:00:00.000Z"),
      ]),
    ];

    const once = mergeConversations(local, server);
    const twice = mergeConversations(once, server);
    expect(twice[0].messages.map((entry) => entry.id)).toEqual(
      once[0].messages.map((entry) => entry.id),
    );
  });
});

describe("an empty account never shrinks a browser", () => {
  it("returns the local history unchanged when the account has none", () => {
    /*
     * The case that would destroy data if the merge were a replace: a new
     * account, or a browser whose history has not been imported.
     */
    const local = [
      conversation("conv_a", "2026-09-01T10:00:00.000Z", [
        message("msg_a1", "2026-09-01T10:00:00.000Z"),
      ]),
      conversation("conv_b", "2026-09-02T10:00:00.000Z", [
        message("msg_b1", "2026-09-02T10:00:00.000Z"),
      ]),
    ];

    const merged = mergeConversations(local, []);
    expect(merged).toHaveLength(2);
    expect(merged.flatMap((entry) => entry.messages)).toHaveLength(2);
  });
});
