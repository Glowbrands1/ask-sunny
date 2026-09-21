import { describe, expect, it } from "vitest";

import { DEMO_CONVERSATIONS } from "@/data/demo";
import { createId } from "@/lib/utils/id";
import {
  DEMO_SEED_CONVERSATION_IDS,
  isClientConversationId,
  isClientMessageId,
} from "./client-ids";

/**
 * ============================================================================
 * THE SIX FABRICATED CONVERSATIONS MUST NEVER REACH SUPABASE
 * ============================================================================
 *
 * The audit established what makes this urgent rather than tidy: the app store
 * seeds conversation state with `DEMO_CONVERSATIONS` in BOTH modes, and the
 * `chat_conversations` persist effect is the only collection effect with no
 * demo-mode guard. So `conv-seed-1 … conv-seed-6` and their `msg-s*` turns have
 * been written into the IndexedDB of every real person who has ever opened Ask
 * Sunny in production.
 *
 * Nobody asked them. Sunny never answered them. Importing one would put
 * invented history into a real person's account where it would be
 * indistinguishable from the real thing — and the person it would mislead most
 * is whoever later reads their own history looking for something they actually
 * said.
 *
 * These tests assert against the SEED DATA ITSELF rather than against a
 * hand-written list, so a seventh seeded conversation added to
 * `data/demo/chat.ts` tomorrow fails here rather than shipping.
 */

describe("the seeded demo conversations are not importable", () => {
  it("has six of them to check, exactly as the audit found", () => {
    /*
     * A test that found zero seeds would pass every assertion below while
     * proving nothing at all.
     */
    expect(DEMO_CONVERSATIONS).toHaveLength(6);
    expect(DEMO_SEED_CONVERSATION_IDS).toHaveLength(6);
  });

  it("names every seeded id that actually exists in the demo data", () => {
    expect([...DEMO_SEED_CONVERSATION_IDS].sort()).toEqual(
      DEMO_CONVERSATIONS.map((conversation) => conversation.id).sort(),
    );
  });

  it.each(DEMO_SEED_CONVERSATION_IDS)("rejects %s", (id) => {
    expect(isClientConversationId(id)).toBe(false);
  });

  it("rejects every seeded conversation id read from the demo data", () => {
    for (const conversation of DEMO_CONVERSATIONS) {
      expect(
        isClientConversationId(conversation.id),
        `${conversation.id} must never be importable`,
      ).toBe(false);
    }
  });

  it("rejects every seeded MESSAGE id too", () => {
    const seedMessageIds = DEMO_CONVERSATIONS.flatMap((conversation) =>
      conversation.messages.map((message) => message.id),
    );

    /* The seeds do carry messages, so this is not vacuous either. */
    expect(seedMessageIds.length).toBeGreaterThan(0);

    for (const id of seedMessageIds) {
      expect(isClientMessageId(id), `${id} must never be importable`).toBe(false);
    }
  });

  it("rejects them even if the named list is emptied, because the shape fails too", () => {
    /*
     * The exact-match list is belt and braces. The structural rules are the
     * belt: a seed id carries hyphens, and `createId` produces lowercase base36
     * only. This asserts the belt holds on its own, so loosening one rule
     * cannot silently disarm both.
     */
    for (const id of DEMO_SEED_CONVERSATION_IDS) {
      expect(/^conv_[0-9a-z]{9,32}$/.test(id)).toBe(false);
    }
  });
});

describe("ids this application actually mints are accepted", () => {
  it("accepts a freshly created conversation id", () => {
    expect(isClientConversationId(createId("conv"))).toBe(true);
  });

  it("accepts a freshly created message id", () => {
    expect(isClientMessageId(createId("msg"))).toBe(true);
  });

  it("accepts a thousand of them in a row", () => {
    /*
     * `createId` appends a counter that grows with the session and six random
     * base36 characters that can occasionally be shorter. A validator too tight
     * on length would reject a real id somewhere in a long conversation, and
     * the person would be told their own history is not importable.
     */
    for (let index = 0; index < 1000; index += 1) {
      expect(isClientConversationId(createId("conv"))).toBe(true);
      expect(isClientMessageId(createId("msg"))).toBe(true);
    }
  });

  it("keeps the two prefixes apart", () => {
    expect(isClientConversationId(createId("msg"))).toBe(false);
    expect(isClientMessageId(createId("conv"))).toBe(false);
  });
});

describe("anything else fails closed", () => {
  const NOW = Date.UTC(2026, 8, 21);

  it.each([
    ["an empty string", ""],
    ["a bare prefix", "conv_"],
    ["a hyphenated id", "conv-abcdefghij"],
    ["uppercase, which base36 never produces", "conv_ABCDEFGHIJ"],
    ["a path traversal", "conv_../../etc/passwd"],
    ["a SQL fragment", "conv_1' or '1'='1"],
    ["a uuid", "conv_11111111-1111-4111-8111-111111111111"],
    ["too short to carry a timestamp", "conv_abc"],
    ["a timestamp before Ask Sunny existed", `conv_${(0).toString(36).padStart(8, "0")}1abcdef`],
  ])("rejects %s", (_label, value) => {
    expect(isClientConversationId(value, NOW)).toBe(false);
    expect(isClientMessageId(String(value).replace("conv", "msg"), NOW)).toBe(false);
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["a number", 12345],
    ["an object", { id: "conv_abcdefghij" }],
    ["an array", ["conv_abcdefghij"]],
  ])("rejects %s without throwing", (_label, value) => {
    expect(isClientConversationId(value, NOW)).toBe(false);
    expect(isClientMessageId(value, NOW)).toBe(false);
  });

  it("rejects an id longer than the column allows", () => {
    expect(isClientConversationId(`conv_${"a".repeat(200)}`, NOW)).toBe(false);
  });

  it("rejects a timestamp far beyond this clock", () => {
    const farFuture = (NOW + 1000 * 60 * 60 * 24 * 365).toString(36);
    expect(isClientConversationId(`conv_${farFuture}1abcdef`, NOW)).toBe(false);
  });

  it("allows a browser clock that is a few hours ahead", () => {
    const slightlyAhead = (NOW + 1000 * 60 * 60 * 3).toString(36);
    expect(isClientConversationId(`conv_${slightlyAhead}1abcdef`, NOW)).toBe(true);
  });
});
