import { describe, expect, it } from "vitest";

import type { ChatConversation, ChatMessage } from "@/types";
import { chunkForImport } from "./local-import";
import {
  CONTENT_MAX_LENGTH,
  CONVERSATIONS_PER_REQUEST_MAX,
  IMPORT_MAX_REQUEST_BYTES,
  MESSAGES_PER_CONVERSATION_MAX,
  MESSAGES_PER_REQUEST_MAX,
  METADATA_MAX_BYTES,
  parseConversation,
} from "./payload";

/**
 * ============================================================================
 * HOW BIG AN IMPORT REQUEST CAN GET, AND WHY NOTHING IS EVER TRUNCATED
 * ============================================================================
 *
 * THE CORRECTION THESE PIN. "Ten conversations per request" bounded the wrong
 * axis. One conversation may hold five hundred turns of a hundred thousand
 * characters each — tens of megabytes — while a Vercel Node.js function rejects
 * a body over 4.5 MB with a 413 before any application code runs. A person with
 * one very long thread would have been told, unhelpfully and permanently, that
 * their history could not be imported.
 *
 * So requests are packed by BYTES and by TURNS as well as by count, and a
 * conversation too large for one request is split by messages across several —
 * each slice carrying the offset at which it belongs.
 *
 * THE NUMBERS, stated here so they can be checked rather than believed:
 *
 *   deployment ceiling      4 718 592 bytes (4.5 MB), enforced by Vercel
 *   request budget          3 145 728 bytes (3 MB), enforced here
 *   turns per request       400
 *   largest single turn     ~132 KB (100 000 chars of content + 32 768 of
 *                           metadata), so one turn always fits with room over
 *   largest conversation    unbounded in practice — it becomes N requests
 */

/** Vercel's documented request body limit for a Node.js function. */
const DEPLOYMENT_BODY_LIMIT_BYTES = 4.5 * 1024 * 1024;

function message(id: string, contentLength: number): ChatMessage {
  return {
    id,
    role: "user",
    content: "x".repeat(contentLength),
    createdAt: "2026-09-01T10:00:00.000Z",
  };
}

function conversation(id: string, messages: ChatMessage[]): ChatConversation {
  return {
    id,
    title: `${id} title`,
    createdAt: "2026-09-01T10:00:00.000Z",
    updatedAt: "2026-09-01T10:00:00.000Z",
    attachedDocumentIds: [],
    messages,
  };
}

function bytesOf(chunk: { conversations: unknown[] }): number {
  return JSON.stringify({ conversations: chunk.conversations }).length;
}

/** A base36 id of the shape `createId` mints, from an index. */
function id(prefix: "conv" | "msg", index: number): string {
  return `${prefix}_${Date.now().toString(36)}${index.toString(36)}zzz`;
}

describe("the budget sits safely inside what the deployment will accept", () => {
  it("is under Vercel's 4.5 MB body limit with room to spare", () => {
    expect(IMPORT_MAX_REQUEST_BYTES).toBeLessThan(DEPLOYMENT_BODY_LIMIT_BYTES);
    /* At least a third of headroom, so JSON overhead can never close the gap. */
    expect(IMPORT_MAX_REQUEST_BYTES).toBeLessThan(DEPLOYMENT_BODY_LIMIT_BYTES * 0.7);
  });

  it("is larger than the largest single turn this application can produce", () => {
    /*
     * The property that makes "never truncated" true. If one turn could exceed
     * the budget there would be a conversation no number of chunks could carry,
     * and the only options left would be dropping it or cutting it in half.
     */
    const largestTurn = CONTENT_MAX_LENGTH + METADATA_MAX_BYTES;
    expect(largestTurn).toBeLessThan(IMPORT_MAX_REQUEST_BYTES / 4);
  });
});

describe("packing several ordinary conversations", () => {
  it("puts them in one request when they fit", () => {
    const chunks = chunkForImport([
      conversation(id("conv", 1), [message(id("msg", 1), 100)]),
      conversation(id("conv", 2), [message(id("msg", 2), 100)]),
    ]);

    expect(chunks).toHaveLength(1);
    expect(chunks[0].conversations).toHaveLength(2);
  });

  it("never exceeds the conversation count per request", () => {
    const many = Array.from({ length: 25 }, (_unused, index) =>
      conversation(id("conv", index), [message(id("msg", index), 50)]),
    );

    const chunks = chunkForImport(many);
    for (const chunk of chunks) {
      expect(chunk.conversations.length).toBeLessThanOrEqual(
        CONVERSATIONS_PER_REQUEST_MAX,
      );
    }
    expect(chunks.flatMap((chunk) => chunk.conversations)).toHaveLength(25);
  });

  it("never exceeds the byte budget, whatever the mix", () => {
    /* Each ~500 KB, so roughly six fit a 3 MB request rather than ten. */
    const heavy = Array.from({ length: 14 }, (_unused, index) =>
      conversation(id("conv", index), [message(id("msg", index), 500_000)]),
    );

    const chunks = chunkForImport(heavy);
    for (const chunk of chunks) {
      expect(bytesOf(chunk)).toBeLessThanOrEqual(IMPORT_MAX_REQUEST_BYTES);
    }
    /*
     * Counting conversations alone would have made two requests of seven
     * megabytes each — both refused by the deployment before reaching any of
     * this. Packing by bytes makes more, smaller, accepted requests.
     */
    const byCountAlone = Math.ceil(14 / CONVERSATIONS_PER_REQUEST_MAX);
    expect(chunks.length).toBeGreaterThan(byCountAlone);
  });

  it("never exceeds the turn budget", () => {
    const chatty = Array.from({ length: 6 }, (_unused, conversationIndex) =>
      conversation(
        id("conv", conversationIndex),
        Array.from({ length: 100 }, (_m, messageIndex) =>
          message(`msg_${Date.now().toString(36)}${conversationIndex}${messageIndex}z`, 20),
        ),
      ),
    );

    for (const chunk of chunkForImport(chatty)) {
      const turns = chunk.conversations.reduce(
        (sum, entry) => sum + entry.messages.length,
        0,
      );
      expect(turns).toBeLessThanOrEqual(MESSAGES_PER_REQUEST_MAX);
    }
  });
});

describe("one conversation too large for any request", () => {
  /** 60 turns of 100 KB each: about 6 MB, comfortably past the ceiling. */
  const huge = conversation(
    id("conv", 99),
    Array.from({ length: 60 }, (_unused, index) =>
      message(`msg_${Date.now().toString(36)}${index.toString(36)}yyy`, 100_000),
    ),
  );

  it("is split rather than refused or truncated", () => {
    const chunks = chunkForImport([huge]);

    expect(chunks.length).toBeGreaterThan(1);
    const sent = chunks.flatMap((chunk) => chunk.conversations[0].messages);
    /* Every turn is sent exactly once. No truncation, no duplication. */
    expect(sent).toHaveLength(60);
    expect(new Set(sent.map((entry) => entry.id)).size).toBe(60);
  });

  it("keeps every slice inside the budget", () => {
    for (const chunk of chunkForImport([huge])) {
      expect(bytesOf(chunk)).toBeLessThanOrEqual(IMPORT_MAX_REQUEST_BYTES);
    }
  });

  it("tells the server where each slice belongs in the thread", () => {
    const chunks = chunkForImport([huge]);

    let expectedOffset = 0;
    for (const chunk of chunks) {
      const slice = chunk.conversations[0] as ChatConversation & {
        positionOffset: number;
      };
      expect(slice.positionOffset).toBe(expectedOffset);
      expectedOffset += slice.messages.length;
    }
    expect(expectedOffset).toBe(60);
  });

  it("produces positions that reassemble the original order exactly", () => {
    /*
     * The end-to-end property: run each slice through the same parser the route
     * uses, and the positions it computes must be 0..59 with each turn at its
     * original index. A chunk that started from zero would overwrite the one
     * before it and the thread would read as its last few turns repeated.
     */
    const positions = new Map<string, number>();

    for (const chunk of chunkForImport([huge])) {
      const parsed = parseConversation(chunk.conversations[0]);
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) return;
      for (const message of parsed.payload.messages) {
        positions.set(message.clientMessageId, message.position);
      }
    }

    expect([...positions.values()].sort((a, b) => a - b)).toEqual(
      Array.from({ length: 60 }, (_unused, index) => index),
    );
    huge.messages.forEach((message, index) => {
      expect(positions.get(message.id)).toBe(index);
    });
  });

  it("splits a conversation with more turns than one request allows", () => {
    const chatty = conversation(
      id("conv", 98),
      Array.from({ length: MESSAGES_PER_REQUEST_MAX + 50 }, (_unused, index) =>
        message(`msg_${Date.now().toString(36)}${index.toString(36)}xxx`, 10),
      ),
    );

    const chunks = chunkForImport([chatty]);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.conversations[0].messages.length).toBeLessThanOrEqual(
        MESSAGES_PER_REQUEST_MAX,
      );
    }
  });
});

describe("the offset cannot be used to reorder or overflow a thread", () => {
  it("is ignored when it is not a whole non-negative number", () => {
    for (const bad of [-1, 1.5, "3", null, {}]) {
      const parsed = parseConversation({
        id: id("conv", 1),
        title: "t",
        createdAt: "2026-09-01T10:00:00.000Z",
        updatedAt: "2026-09-01T10:00:00.000Z",
        positionOffset: bad,
        messages: [{ ...message(id("msg", 1), 10) }],
      });
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) return;
      expect(parsed.payload.messages[0].position).toBe(0);
    }
  });

  it("refuses an offset that would push a turn past what a thread can hold", () => {
    const parsed = parseConversation({
      id: id("conv", 1),
      title: "t",
      createdAt: "2026-09-01T10:00:00.000Z",
      updatedAt: "2026-09-01T10:00:00.000Z",
      positionOffset: MESSAGES_PER_CONVERSATION_MAX,
      messages: [{ ...message(id("msg", 1), 10) }],
    });
    expect(parsed.ok).toBe(false);
  });

  it("still numbers turns by array index within the slice", () => {
    /*
     * The offset says where the slice starts. It cannot say what order the
     * turns inside it are in — that is still the array, which is the whole
     * reason positions are computed server-side.
     */
    const parsed = parseConversation({
      id: id("conv", 1),
      title: "t",
      createdAt: "2026-09-01T10:00:00.000Z",
      updatedAt: "2026-09-01T10:00:00.000Z",
      positionOffset: 7,
      messages: [
        { ...message(id("msg", 1), 10), position: 99 },
        { ...message(id("msg", 2), 10), position: 0 },
      ],
    });

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.payload.messages.map((entry) => entry.position)).toEqual([7, 8]);
  });
});

describe("the bounds agree with each other", () => {
  it("cannot let one request carry more turns than one conversation may hold", () => {
    expect(MESSAGES_PER_REQUEST_MAX).toBeLessThanOrEqual(MESSAGES_PER_CONVERSATION_MAX);
  });

  it("packs an empty list into no requests at all", () => {
    expect(chunkForImport([])).toEqual([]);
  });
});
