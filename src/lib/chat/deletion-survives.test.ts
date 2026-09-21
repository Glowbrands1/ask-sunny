import { describe, expect, it } from "vitest";

import type { ChatConversation } from "@/types";
import { eligibleForImport } from "./local-import";
import { mergeConversations } from "./merge";
import {
  isFullyStored,
  isSuppressed,
  suppressDeleted,
  type HistoryState,
} from "./suppression";

/**
 * ============================================================================
 * A DELETE MUST SURVIVE A BROWSER THAT WAS NOT THERE WHEN IT HAPPENED
 * ============================================================================
 *
 * THE DEFECT THESE PIN. The browser keeps its own copy of history, and
 * hydration merges the account's copy into it as a UNION so that an outage can
 * never look like "your account has no history". Both decisions are right, and
 * together they resurrect the dead:
 *
 *   Laptop A imports X. Laptop B still holds X locally. The person deletes X on
 *   Laptop A. If the server merely forgot X, Laptop B's next hydration adds it
 *   back and offers to import it again — undoing the delete and contradicting
 *   the History panel, which now says Clear History removes conversations "from
 *   your Ask Sunny account and from this browser".
 *
 * The fix is a durable, POSITIVE server record of the decision: a tombstone for
 * one conversation, a boundary instant for all of them. These tests are the
 * state machine in `suppression.ts`, exercised at the seams a second device
 * actually goes through — merge, then suppress, then decide what to offer.
 */

function conversation(
  id: string,
  createdAt: string,
  updatedAt = createdAt,
): ChatConversation {
  return {
    id,
    title: `${id} title`,
    createdAt,
    updatedAt,
    attachedDocumentIds: [],
    messages: [
      { id: `msg_${id.slice(5)}`, role: "user", content: "hello", createdAt },
    ],
  };
}

const X = conversation("conv_mfxdeleted01", "2026-09-01T10:00:00.000Z");
const Y = conversation("conv_mfxkeeper001", "2026-09-02T10:00:00.000Z");

/** What Laptop B holds locally: both, because it was last open before the delete. */
const LAPTOP_B_LOCAL = [X, Y];

describe("one conversation deleted on another device", () => {
  /** The account after the delete: Y is live, X is a tombstone. */
  const AFTER_DELETE: HistoryState = {
    stored: [{ id: Y.id, messages: 1 }],
    deleted: [X.id],
    clearedAt: null,
  };

  it("does not appear in the history the second device shows", () => {
    /* The union first — which is where the resurrection used to happen. */
    const merged = mergeConversations(LAPTOP_B_LOCAL, [Y]);
    expect(merged.map((entry) => entry.id)).toContain(X.id);

    /* Then the person's own decision, which wins. */
    const shown = suppressDeleted(merged, AFTER_DELETE);
    expect(shown.map((entry) => entry.id)).toEqual([Y.id]);
  });

  it("is not offered for import", () => {
    expect(eligibleForImport(LAPTOP_B_LOCAL, AFTER_DELETE)).toEqual([]);
  });

  it("is reported as suppressed so it can never be re-synced", () => {
    expect(isSuppressed(X, AFTER_DELETE)).toBe(true);
    expect(isSuppressed(Y, AFTER_DELETE)).toBe(false);
  });

  it("stays deleted across a refresh, because the state is the server's", () => {
    /* Two hydrations in a row: the second is not softer than the first. */
    const once = suppressDeleted(mergeConversations(LAPTOP_B_LOCAL, [Y]), AFTER_DELETE);
    const twice = suppressDeleted(mergeConversations(once, [Y]), AFTER_DELETE);
    expect(twice.map((entry) => entry.id)).toEqual([Y.id]);
  });

  it("stays deleted however long the second device waits to sign in", () => {
    /*
     * The tombstone has no expiry, so a laptop opened next month behaves like
     * one opened a minute later. Nothing here reads a clock.
     */
    const muchLater = suppressDeleted(
      mergeConversations(LAPTOP_B_LOCAL, [Y]),
      AFTER_DELETE,
    );
    expect(muchLater.map((entry) => entry.id)).toEqual([Y.id]);
  });

  it("cannot be rescued by editing the local copy first", () => {
    const edited: ChatConversation = {
      ...X,
      updatedAt: "2026-12-01T10:00:00.000Z",
      messages: [
        ...X.messages,
        {
          id: "msg_mfxrescue001",
          role: "user",
          content: "still here?",
          createdAt: "2026-12-01T10:00:00.000Z",
        },
      ],
    };

    expect(isSuppressed(edited, AFTER_DELETE)).toBe(true);
    expect(eligibleForImport([edited], AFTER_DELETE)).toEqual([]);
  });
});

describe("Clear History on another device", () => {
  const CLEARED_AT = "2026-09-10T12:00:00.000Z";

  /** Every conversation is gone from the account; one boundary says so. */
  const AFTER_CLEAR: HistoryState = {
    stored: [],
    deleted: [],
    clearedAt: CLEARED_AT,
  };

  /** A browser holding several pre-clear threads, only some ever imported. */
  const STALE = [
    conversation("conv_mfxstale0001", "2026-08-01T09:00:00.000Z"),
    conversation("conv_mfxstale0002", "2026-08-15T09:00:00.000Z"),
    conversation("conv_mfxstale0003", "2026-09-09T09:00:00.000Z"),
    /* Exactly on the boundary — "at or before" includes it. */
    conversation("conv_mfxstale0004", CLEARED_AT),
  ];

  it("returns none of them, from one row rather than four tombstones", () => {
    const shown = suppressDeleted(mergeConversations(STALE, []), AFTER_CLEAR);
    expect(shown).toEqual([]);
  });

  it("offers none of them for import", () => {
    expect(eligibleForImport(STALE, AFTER_CLEAR)).toEqual([]);
  });

  it("covers conversations the account NEVER held, which tombstones could not", () => {
    /*
     * The case a per-conversation tombstone cannot answer: a thread that only
     * ever existed in this browser, so the account has no row to mark. The
     * boundary answers for it because it answers about TIME, not about rows.
     */
    const neverImported = conversation("conv_mfxneverimp1", "2026-07-01T09:00:00.000Z");
    expect(isSuppressed(neverImported, AFTER_CLEAR)).toBe(true);
    expect(eligibleForImport([neverImported], AFTER_CLEAR)).toEqual([]);
  });

  it("lets conversations created AFTER the clear work normally", () => {
    const fresh = conversation("conv_mfxafter0001", "2026-09-10T12:00:01.000Z");

    expect(isSuppressed(fresh, AFTER_CLEAR)).toBe(false);
    expect(suppressDeleted([fresh], AFTER_CLEAR)).toEqual([fresh]);
    expect(eligibleForImport([fresh], AFTER_CLEAR).map((entry) => entry.id)).toEqual([
      fresh.id,
    ]);
  });

  it("judges by when a conversation STARTED, not when it was last touched", () => {
    /*
     * The rescue attempt this rule exists to refuse: a stale browser continues
     * a pre-clear thread, pushing its `updatedAt` past the boundary. When it
     * was CREATED is a fact no later local edit can move.
     */
    const continuedAfter: ChatConversation = {
      ...STALE[0],
      updatedAt: "2026-09-20T10:00:00.000Z",
    };
    expect(isSuppressed(continuedAfter, AFTER_CLEAR)).toBe(true);
  });

  it("suppresses a conversation whose creation time cannot be read", () => {
    /*
     * It cannot be placed in time, and the safe reading of "clear everything
     * from before now" is to include what cannot prove it came after.
     */
    const undated = { ...STALE[0], createdAt: "not a date" };
    expect(isSuppressed(undated, AFTER_CLEAR)).toBe(true);
  });

  it("still honours individual tombstones alongside a boundary", () => {
    const both: HistoryState = {
      stored: [],
      deleted: ["conv_mfxafter0002"],
      clearedAt: CLEARED_AT,
    };
    const afterClear = conversation("conv_mfxafter0002", "2026-09-11T09:00:00.000Z");
    expect(isSuppressed(afterClear, both)).toBe(true);
  });
});

describe("an outage must never be able to imitate a delete", () => {
  it("suppresses nothing when the account could not be reached", () => {
    /*
     * `null` is "we do not know", and it is the state a failed fetch leaves
     * behind. Treating it as "everything was deleted" would turn a thirty-second
     * Supabase blip into a browser that silently discards somebody's history —
     * a far worse failure than showing a conversation that has since been
     * deleted for one more page load.
     */
    expect(suppressDeleted(LAPTOP_B_LOCAL, null)).toEqual(LAPTOP_B_LOCAL);
    expect(isSuppressed(X, null)).toBe(false);
  });

  it("offers no import when the account could not be reached", () => {
    /* Nothing is destroyed, and nothing is uploaded on a guess either. */
    expect(eligibleForImport(LAPTOP_B_LOCAL, null)).toEqual([]);
  });

  it("recovers the moment the account answers again", () => {
    const state: HistoryState = { stored: [], deleted: [X.id], clearedAt: null };
    expect(suppressDeleted(LAPTOP_B_LOCAL, null)).toHaveLength(2);
    expect(suppressDeleted(LAPTOP_B_LOCAL, state).map((entry) => entry.id)).toEqual([
      Y.id,
    ]);
  });
});

describe("a half-stored conversation is still offered, so a chunked import resumes", () => {
  it("counts turns rather than asking whether the id exists", () => {
    const long: ChatConversation = {
      ...X,
      messages: Array.from({ length: 5 }, (_unused, index) => ({
        id: `msg_mfxlong0000${index}`,
        role: "user" as const,
        content: `turn ${index}`,
        createdAt: "2026-09-01T10:00:00.000Z",
      })),
    };

    const halfway: HistoryState = {
      stored: [{ id: long.id, messages: 2 }],
      deleted: [],
      clearedAt: null,
    };

    expect(isFullyStored(long, halfway)).toBe(false);
    expect(eligibleForImport([long], halfway).map((entry) => entry.id)).toEqual([
      long.id,
    ]);

    const complete: HistoryState = {
      stored: [{ id: long.id, messages: 5 }],
      deleted: [],
      clearedAt: null,
    };
    expect(isFullyStored(long, complete)).toBe(true);
    expect(eligibleForImport([long], complete)).toEqual([]);
  });

  it("does not re-offer a conversation the account holds MORE of", () => {
    /* Another device continued it; this browser's shorter copy is not news. */
    const state: HistoryState = {
      stored: [{ id: Y.id, messages: 9 }],
      deleted: [],
      clearedAt: null,
    };
    expect(isFullyStored(Y, state)).toBe(true);
    expect(eligibleForImport([Y], state)).toEqual([]);
  });
});
