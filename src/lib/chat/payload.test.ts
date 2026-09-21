import { describe, expect, it } from "vitest";

import { DEMO_CONVERSATIONS } from "@/data/demo";
import { createId } from "@/lib/utils/id";
import {
  CONTENT_MAX_LENGTH,
  METADATA_KEYS,
  METADATA_MAX_BYTES,
  parseConversation,
  partitionConversations,
  safeMetadata,
  TITLE_MAX_LENGTH,
} from "./payload";

/**
 * WHAT IS ALLOWED TO BECOME A ROW, AND WHAT IS NOT.
 *
 * This is the validator both sides run: the browser to decide what to OFFER,
 * the route to decide what to STORE. Its job is to be strict about structure —
 * ids, order, bounds, the metadata allowlist — while preserving everything a
 * reopened conversation needs to look the way it looked.
 */

const NOW = Date.UTC(2026, 8, 21, 12, 0, 0);

function conversation(overrides: Record<string, unknown> = {}) {
  return {
    id: createId("conv"),
    title: "Coverage for Saturday",
    createdAt: "2026-09-19T14:00:00.000Z",
    updatedAt: "2026-09-19T14:05:00.000Z",
    attachedDocumentIds: [],
    /*
     * Deliberately loose: these tests hand the validator the shapes a real
     * IndexedDB record can hold, including malformed ones, so the fixture must
     * not be narrowed to a well-formed union by inference.
     */
    messages: [
      {
        id: createId("msg"),
        role: "user",
        content: "Who covers Saturday?",
        createdAt: "2026-09-19T14:00:00.000Z",
      },
      {
        id: createId("msg"),
        role: "assistant",
        content: "The schedule shows two Salon Directors on Saturday.",
        createdAt: "2026-09-19T14:00:00.000Z",
        mode: "standard",
        coverage: "grounded",
        turnId: "11111111-1111-4111-8111-111111111111",
        citations: [{ documentId: "kb_1", title: "Scheduling", page: 2 }],
      },
    ] as Record<string, unknown>[],
    ...overrides,
  };
}

describe("a real conversation round-trips", () => {
  it("accepts it and keeps the title and both timestamps", () => {
    const source = conversation();
    const parsed = parseConversation(source, NOW);

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    expect(parsed.payload.clientConversationId).toBe(source.id);
    expect(parsed.payload.title).toBe("Coverage for Saturday");
    expect(parsed.payload.createdAt).toBe("2026-09-19T14:00:00.000Z");
    expect(parsed.payload.updatedAt).toBe("2026-09-19T14:05:00.000Z");
  });

  it("numbers the turns from the ARRAY, not from their timestamps", () => {
    /*
     * The two turns above deliberately share a millisecond — an answer and the
     * question after it routinely do. Ordering by time alone can put an answer
     * before what it answered, which is the one corruption that would make
     * Sunny look like it replied before being asked.
     */
    const source = conversation();
    const parsed = parseConversation(source, NOW);
    if (!parsed.ok) throw new Error("expected a valid conversation");

    expect(parsed.payload.messages.map((message) => message.position)).toEqual([0, 1]);
    expect(parsed.payload.messages[0].role).toBe("user");
    expect(parsed.payload.messages[1].role).toBe("assistant");
    expect(parsed.payload.messages[0].createdAt).toBe(
      parsed.payload.messages[1].createdAt,
    );
  });

  it("keeps the server's turn id when it is a uuid, and drops it otherwise", () => {
    const good = parseConversation(conversation(), NOW);
    if (!good.ok) throw new Error("expected a valid conversation");
    expect(good.payload.messages[1].turnId).toBe(
      "11111111-1111-4111-8111-111111111111",
    );

    const source = conversation();
    source.messages[1].turnId = "not-a-uuid";
    const parsed = parseConversation(source, NOW);
    if (!parsed.ok) throw new Error("expected a valid conversation");
    /*
     * `turn_id` is not a foreign key — an imported thread may name an event row
     * that no longer exists — so a malformed value has to become null rather
     * than be stored as something no join could use.
     */
    expect(parsed.payload.messages[1].turnId).toBeNull();
  });

  it("keeps every field the chat surface needs to redraw a turn", () => {
    const source = conversation();
    Object.assign(source.messages[1], {
      recommendedVideoIds: ["vid_1"],
      followUpSuggestions: ["Why?"],
      formProposal: { id: "p1", templateKey: "coaching" },
      formSelection: { choices: [] },
      formInstanceRef: { instanceId: "fi_1", proposalId: "p1", templateName: "Coaching" },
      error: { kind: "model_failed", message: "…", retryable: true, question: "q" },
      feedback: { id: "fb_1", turnId: "t", rating: 4, comment: "" },
    });

    const parsed = parseConversation(source, NOW);
    if (!parsed.ok) throw new Error("expected a valid conversation");
    const metadata = parsed.payload.messages[1].metadata;

    expect(metadata.mode).toBe("standard");
    expect(metadata.coverage).toBe("grounded");
    expect(metadata.citations).toHaveLength(1);
    expect(metadata.recommendedVideoIds).toEqual(["vid_1"]);
    expect(metadata.followUpSuggestions).toEqual(["Why?"]);
    expect(metadata.formProposal).toBeDefined();
    expect(metadata.formSelection).toBeDefined();
    expect(metadata.formInstanceRef).toEqual({
      instanceId: "fi_1",
      proposalId: "p1",
      templateName: "Coaching",
    });
    expect(metadata.error).toBeDefined();
    expect(metadata.feedback).toBeDefined();
  });

  it("stores a failed turn, which is an empty string and an error", () => {
    const source = conversation();
    source.messages[1].content = "";
    source.messages[1].error = {
      kind: "model_failed",
      message: "…",
      retryable: true,
      question: "q",
    };
    delete (source.messages[1] as Record<string, unknown>).turnId;

    const parsed = parseConversation(source, NOW);
    expect(parsed.ok).toBe(true);
  });
});

describe("metadata is an allowlist, not a passthrough", () => {
  it("drops anything not on the list", () => {
    const metadata = safeMetadata({
      id: "msg_x",
      role: "assistant",
      content: "secret",
      createdAt: "2026-09-19T14:00:00.000Z",
      mode: "standard",
      /* The shapes that must never be persisted, whatever put them there. */
      accessToken: "sb_secret_value",
      authorization: "Bearer abc",
      cookie: "sb-access-token=…",
      headers: { authorization: "Bearer abc" },
      apiKey: "sk-ant-123",
      formValues: { employeeName: "Sarah" },
    });

    expect(Object.keys(metadata)).toEqual(["mode"]);
    expect(JSON.stringify(metadata)).not.toContain("Bearer");
    expect(JSON.stringify(metadata)).not.toContain("sb_secret");
    expect(JSON.stringify(metadata)).not.toContain("sk-ant");
    expect(JSON.stringify(metadata)).not.toContain("Sarah");
  });

  it("never carries the content or the ids, which have their own columns", () => {
    for (const key of ["id", "role", "content", "createdAt", "turnId"]) {
      expect(METADATA_KEYS as readonly string[]).not.toContain(key);
    }
  });

  it("refuses a message whose metadata is larger than the bound", () => {
    const source = conversation();
    source.messages[1].citations = [
      { documentId: "kb_1", title: "x".repeat(METADATA_MAX_BYTES + 100), page: 1 },
    ];

    const parsed = parseConversation(source, NOW);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.reason).toBe("malformed_record");
  });
});

describe("a malformed local record cannot poison server history", () => {
  it("declines the WHOLE conversation when one turn is malformed", () => {
    /*
     * A conversation missing its third message is not a smaller version of
     * itself — it is a record that reads as though something was never said.
     * Declining it and saying so is the honest outcome.
     */
    const source = conversation();
    source.messages[1].id = "msg-s1-2";

    const parsed = parseConversation(source, NOW);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.reason).toBe("malformed_message_id");
  });

  it.each([
    ["no messages", { messages: [] }],
    ["messages that are not an array", { messages: "all of them" }],
    ["no title", { title: "   " }],
    ["a conversation id that is not one of ours", { id: "conv-seed-1" }],
  ])("declines %s", (_label, overrides) => {
    const parsed = parseConversation(conversation(overrides), NOW);
    expect(parsed.ok).toBe(false);
  });

  it.each([
    ["null", null],
    ["a string", "conv_abcdefghij"],
    ["an array", []],
    ["a number", 7],
  ])("declines %s without throwing", (_label, value) => {
    const parsed = parseConversation(value, NOW);
    expect(parsed.ok).toBe(false);
  });

  it("declines a role it does not recognise", () => {
    const source = conversation();
    (source.messages[1] as Record<string, unknown>).role = "system";
    expect(parseConversation(source, NOW).ok).toBe(false);
  });

  it("declines content past the column bound rather than truncating it", () => {
    const source = conversation();
    source.messages[1].content = "x".repeat(CONTENT_MAX_LENGTH + 1);
    const parsed = parseConversation(source, NOW);
    expect(parsed.ok).toBe(false);
  });

  it("declines the same turn twice in one thread", () => {
    const source = conversation();
    source.messages[1].id = source.messages[0].id;
    expect(parseConversation(source, NOW).ok).toBe(false);
  });

  it("bounds an over-long title instead of refusing it", () => {
    /*
     * A title is presentation. Refusing a whole conversation because its
     * derived title ran long would cost somebody their history over a label.
     */
    const parsed = parseConversation(conversation({ title: "x".repeat(900) }), NOW);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.payload.title).toHaveLength(TITLE_MAX_LENGTH);
  });
});

describe("timestamps are preserved where valid and clamped where not", () => {
  it("keeps original times, which is the whole point of importing", () => {
    const parsed = parseConversation(
      conversation({
        createdAt: "2026-08-01T09:00:00.000Z",
        updatedAt: "2026-08-01T09:30:00.000Z",
      }),
      NOW,
    );
    if (!parsed.ok) throw new Error("expected a valid conversation");
    expect(parsed.payload.createdAt).toBe("2026-08-01T09:00:00.000Z");
    expect(parsed.payload.updatedAt).toBe("2026-08-01T09:30:00.000Z");
  });

  it("clamps a far-future timestamp so it cannot pin History forever", () => {
    const parsed = parseConversation(
      conversation({ updatedAt: "2099-01-01T00:00:00.000Z" }),
      NOW,
    );
    if (!parsed.ok) throw new Error("expected a valid conversation");
    expect(Date.parse(parsed.payload.updatedAt)).toBeLessThanOrEqual(NOW);
  });

  it("falls back rather than refusing when a timestamp is unreadable", () => {
    const parsed = parseConversation(conversation({ updatedAt: "nonsense" }), NOW);
    expect(parsed.ok).toBe(true);
  });
});

describe("partitioning a whole local history", () => {
  it("separates the six seeded threads from a real one, with reasons", () => {
    const real = conversation();
    const { eligible, declined } = partitionConversations(
      [...DEMO_CONVERSATIONS, real],
      NOW,
    );

    expect(eligible.map((payload) => payload.clientConversationId)).toEqual([real.id]);
    expect(declined).toHaveLength(6);
    for (const entry of declined) {
      expect(entry.reason).toBe("demo_seed");
      expect(entry.id).toMatch(/^conv-seed-/);
    }
  });

  it("returns nothing eligible for a history that is only seeds", () => {
    const { eligible } = partitionConversations([...DEMO_CONVERSATIONS], NOW);
    expect(eligible).toEqual([]);
  });
});
