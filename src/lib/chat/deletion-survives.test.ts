import { describe, expect, it } from "vitest";

import type { ChatConversation } from "@/types";
import { eligibleForImport } from "./local-import";
import { mergeConversations } from "./merge";
import {
  isFullyStored,
  isSuppressed,
  suppressDeleted,
  unknownContext,
  type HistoryState,
  type SuppressionContext,
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
 * AND THE SECOND DEFECT, WHICH THE FIRST FIX DID NOT CLOSE. Suppression judged
 * a clear by the conversation's own `createdAt` — `nowIso()` from whatever the
 * creating browser's clock said. A machine running a day fast stamps its
 * conversations into the future, so after a clear those stamps sat AFTER the
 * boundary and the conversation survived. A wrong clock defeated a deliberate
 * delete. The sweep below consults no clock at all.
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

/**
 * A second device reconnecting: it holds these conversations on disk, and it
 * has not yet carried out whatever boundary the account reports.
 */
function reconnecting(
  state: HistoryState,
  onDisk: ChatConversation[],
): SuppressionContext {
  return {
    state,
    preExisting: new Set(onDisk.map((entry) => entry.id)),
    appliedBoundary: null,
  };
}

/**
 * The same device later: it has already carried out this boundary, and these
 * conversations were on disk when it loaded.
 */
function alreadyApplied(
  state: HistoryState,
  onDisk: ChatConversation[],
): SuppressionContext {
  return {
    state,
    preExisting: new Set(onDisk.map((entry) => entry.id)),
    appliedBoundary: state.clearedAt,
  };
}

const X = conversation("conv_mfxdeleted01", "2026-09-01T10:00:00.000Z");
const Y = conversation("conv_mfxkeeper001", "2026-09-02T10:00:00.000Z");

/** What Laptop B holds locally: both, because it was last open before the delete. */
const LAPTOP_B_LOCAL = [X, Y];

/* ------------------------------------------------- one conversation ------ */

describe("one conversation deleted on another device", () => {
  /** The account after the delete: Y is live, X is a tombstone. */
  const AFTER_DELETE: HistoryState = {
    stored: [{ id: Y.id, messages: 1 }],
    deleted: [X.id],
    clearedAt: null,
  };
  const CONTEXT = reconnecting(AFTER_DELETE, LAPTOP_B_LOCAL);

  it("does not appear in the history the second device shows", () => {
    /* The union first — which is where the resurrection used to happen. */
    const merged = mergeConversations(LAPTOP_B_LOCAL, [Y]);
    expect(merged.map((entry) => entry.id)).toContain(X.id);

    /* Then the person's own decision, which wins. */
    expect(suppressDeleted(merged, CONTEXT).map((entry) => entry.id)).toEqual([Y.id]);
  });

  it("is not offered for import", () => {
    expect(eligibleForImport(LAPTOP_B_LOCAL, CONTEXT)).toEqual([]);
  });

  it("is reported as suppressed so it can never be re-synced", () => {
    expect(isSuppressed(X, CONTEXT)).toBe(true);
    expect(isSuppressed(Y, CONTEXT)).toBe(false);
  });

  it("stays deleted across a refresh, and on a device that already swept", () => {
    /*
     * A tombstone names the conversation outright, so it does not depend on the
     * sweep having been carried out or not — both contexts refuse it.
     */
    expect(isSuppressed(X, alreadyApplied(AFTER_DELETE, LAPTOP_B_LOCAL))).toBe(true);
    const once = suppressDeleted(mergeConversations(LAPTOP_B_LOCAL, [Y]), CONTEXT);
    const twice = suppressDeleted(mergeConversations(once, [Y]), CONTEXT);
    expect(twice.map((entry) => entry.id)).toEqual([Y.id]);
  });

  it("stays deleted however long the second device waits to sign in", () => {
    /* The tombstone has no expiry, and nothing here reads a clock. */
    expect(
      suppressDeleted(mergeConversations(LAPTOP_B_LOCAL, [Y]), CONTEXT).map(
        (entry) => entry.id,
      ),
    ).toEqual([Y.id]);
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
    const context = reconnecting(AFTER_DELETE, [edited]);

    expect(isSuppressed(edited, context)).toBe(true);
    expect(eligibleForImport([edited], context)).toEqual([]);
  });
});

/* ------------------------------------------------------ clear history ---- */

describe("Clear History on another device", () => {
  const CLEARED_AT = "2026-09-10T12:00:00.000Z";
  const AFTER_CLEAR: HistoryState = { stored: [], deleted: [], clearedAt: CLEARED_AT };

  /** A browser holding several pre-clear threads, only some ever imported. */
  const STALE = [
    conversation("conv_mfxstale0001", "2026-08-01T09:00:00.000Z"),
    conversation("conv_mfxstale0002", "2026-08-15T09:00:00.000Z"),
    conversation("conv_mfxstale0003", "2026-09-09T09:00:00.000Z"),
    /* Exactly on the boundary — "at or before" includes it. */
    conversation("conv_mfxstale0004", CLEARED_AT),
  ];
  const CONTEXT = reconnecting(AFTER_CLEAR, STALE);

  it("returns none of them, from one row rather than four tombstones", () => {
    expect(suppressDeleted(mergeConversations(STALE, []), CONTEXT)).toEqual([]);
  });

  it("offers none of them for import", () => {
    expect(eligibleForImport(STALE, CONTEXT)).toEqual([]);
  });

  it("covers conversations the account NEVER held, which tombstones could not", () => {
    const neverImported = conversation("conv_mfxneverimp1", "2026-07-01T09:00:00.000Z");
    const context = reconnecting(AFTER_CLEAR, [neverImported]);

    expect(isSuppressed(neverImported, context)).toBe(true);
    expect(eligibleForImport([neverImported], context)).toEqual([]);
  });

  it("judges by when a conversation STARTED, not when it was last touched", () => {
    const continuedAfter: ChatConversation = {
      ...STALE[0],
      updatedAt: "2026-09-20T10:00:00.000Z",
    };
    expect(isSuppressed(continuedAfter, reconnecting(AFTER_CLEAR, [continuedAfter]))).toBe(
      true,
    );
  });

  it("suppresses a conversation whose creation time cannot be read", () => {
    const undated = { ...STALE[0], createdAt: "not a date" };
    expect(isSuppressed(undated, reconnecting(AFTER_CLEAR, [undated]))).toBe(true);
  });

  it("still honours individual tombstones alongside a boundary", () => {
    const afterClear = conversation("conv_mfxafter0002", "2026-09-11T09:00:00.000Z");
    const both: HistoryState = {
      stored: [],
      deleted: [afterClear.id],
      clearedAt: CLEARED_AT,
    };
    expect(isSuppressed(afterClear, alreadyApplied(both, []))).toBe(true);
  });
});

/* ===========================================================================
 * THE WRONG-CLOCK CASE
 * =========================================================================== */

describe("a browser whose clock was wrong cannot defeat Clear History", () => {
  /** T — the authoritative server instant of the clear. */
  const T = "2026-09-21T23:30:00.000Z";
  const AFTER_CLEAR: HistoryState = { stored: [], deleted: [], clearedAt: T };

  /**
   * Device B's clock was a day fast when this was created, so its local
   * `createdAt` lands AFTER T even though the conversation is older than the
   * clear. Under the previous rule this survived, reappeared and was offered
   * for import — the whole reason the sweep exists.
   */
  const STALE_FUTURE_STAMP = conversation(
    "conv_mfxstaleclk1",
    "2026-09-22T23:00:00.000Z",
  );

  /** A clock wrong by years, to show the size of the error does not matter. */
  const STALE_WILDLY_FUTURE = conversation(
    "conv_mfxstaleclk2",
    "2031-01-01T00:00:00.000Z",
  );

  const RECONNECTED = reconnecting(AFTER_CLEAR, [
    STALE_FUTURE_STAMP,
    STALE_WILDLY_FUTURE,
  ]);

  it("suppresses it even though its timestamp is after the boundary", () => {
    /* The timestamp really does claim to post-date the clear. */
    expect(Date.parse(STALE_FUTURE_STAMP.createdAt)).toBeGreaterThan(Date.parse(T));

    expect(isSuppressed(STALE_FUTURE_STAMP, RECONNECTED)).toBe(true);
    expect(isSuppressed(STALE_WILDLY_FUTURE, RECONNECTED)).toBe(true);
  });

  it("keeps it out of the history the second device shows", () => {
    const merged = mergeConversations(
      [STALE_FUTURE_STAMP, STALE_WILDLY_FUTURE],
      [],
    );
    expect(suppressDeleted(merged, RECONNECTED)).toEqual([]);
  });

  it("never offers it for import", () => {
    expect(
      eligibleForImport([STALE_FUTURE_STAMP, STALE_WILDLY_FUTURE], RECONNECTED),
    ).toEqual([]);
  });

  it("holds for a clock wrong by any amount, tested across a range", () => {
    /*
     * Parameterised rather than spot-checked, because the previous rule failed
     * for exactly the skews that push `createdAt` past the boundary and passed
     * for the rest — so a single example could have been the passing one.
     */
    for (const hoursFast of [1, 6, 24, 24 * 7, 24 * 365, 24 * 365 * 5]) {
      const stamped = new Date(Date.parse(T) + hoursFast * 3_600_000).toISOString();
      const stale = conversation("conv_mfxskewtest1", stamped);
      expect(
        isSuppressed(stale, reconnecting(AFTER_CLEAR, [stale])),
        `a clock ${hoursFast}h fast must not rescue a stale conversation`,
      ).toBe(true);
    }
  });

  it("does not depend on the id's embedded timestamp either", () => {
    /*
     * `createId` encodes `Date.now()` in the id, so a wrong clock corrupts that
     * too. The sweep reads neither — it reads whether the conversation was on
     * this disk before the browser heard about the clear.
     */
    const stale = {
      ...STALE_FUTURE_STAMP,
      id: "conv_mfxzzzzzzz9",
    };
    expect(isSuppressed(stale, reconnecting(AFTER_CLEAR, [stale]))).toBe(true);
  });

  /* ------------------------------------------------------------------- */

  it("STILL lets a genuinely new conversation after the clear work normally", () => {
    /*
     * The other half, and the one that makes the rule usable rather than merely
     * safe. A conversation started after the clear was NOT on this disk when
     * the page loaded, so it is not in `preExisting` and the sweep never
     * considers it — whatever its timestamp says.
     */
    const fresh = conversation("conv_mfxafter0001", "2026-09-22T09:00:00.000Z");
    const context = reconnecting(AFTER_CLEAR, [
      STALE_FUTURE_STAMP,
      STALE_WILDLY_FUTURE,
    ]);

    expect(isSuppressed(fresh, context)).toBe(false);
    expect(suppressDeleted([fresh, STALE_FUTURE_STAMP], context)).toEqual([fresh]);
    expect(eligibleForImport([fresh], context).map((entry) => entry.id)).toEqual([
      fresh.id,
    ]);
  });

  it("lets a new conversation work even on a browser whose clock is still wrong", () => {
    /*
     * The same machine, still a day fast, starting a fresh conversation after
     * the clear. Its stamp is nonsense in both directions and it does not
     * matter: it was not on disk at hydration.
     */
    const freshOnBadClock = conversation("conv_mfxafter0003", "2031-06-01T00:00:00.000Z");
    const context = reconnecting(AFTER_CLEAR, [STALE_FUTURE_STAMP]);

    expect(isSuppressed(freshOnBadClock, context)).toBe(false);
    expect(eligibleForImport([freshOnBadClock], context)).toHaveLength(1);
  });

  it("does not re-suppress a post-clear conversation on the NEXT load", () => {
    /*
     * The reason the applied boundary is remembered. On the visit after the
     * sweep, a conversation had after the clear IS on disk at hydration — and
     * if the sweep ran again it would be destroyed, losing work somebody did
     * after clearing. The boundary has been carried out, so it does not.
     */
    const hadAfterClear = conversation("conv_mfxafter0004", "2026-09-22T09:00:00.000Z");
    expect(isSuppressed(hadAfterClear, alreadyApplied(AFTER_CLEAR, [hadAfterClear]))).toBe(
      false,
    );
  });

  it("re-arms for a SECOND clear, because the boundary value changes", () => {
    /*
     * The applied record is keyed to the boundary it carried out. A later clear
     * is a different instant, so it does not match and the sweep runs again —
     * which is what stops a browser that has swept once from being permanently
     * exempt.
     */
    const hadAfterFirstClear = conversation(
      "conv_mfxafter0005",
      "2026-09-22T09:00:00.000Z",
    );
    const secondClear: HistoryState = {
      stored: [],
      deleted: [],
      clearedAt: "2026-09-25T10:00:00.000Z",
    };

    expect(
      isSuppressed(hadAfterFirstClear, {
        state: secondClear,
        preExisting: new Set([hadAfterFirstClear.id]),
        /* Applied the FIRST boundary, not this one. */
        appliedBoundary: T,
      }),
    ).toBe(true);
  });

  it("exempts a conversation the account currently holds", () => {
    /*
     * The clear deleted every row, so anything the account holds now was stored
     * after it. That is server-authoritative and needs no clock either.
     */
    const survived = conversation("conv_mfxafter0006", "2026-09-22T09:00:00.000Z");
    const state: HistoryState = {
      stored: [{ id: survived.id, messages: 1 }],
      deleted: [],
      clearedAt: T,
    };
    expect(isSuppressed(survived, reconnecting(state, [survived]))).toBe(false);
  });
});

/* -------------------------------------------------------------- outage --- */

describe("an outage must never be able to imitate a delete", () => {
  it("suppresses nothing when the account could not be reached", () => {
    expect(suppressDeleted(LAPTOP_B_LOCAL, unknownContext())).toEqual(LAPTOP_B_LOCAL);
    expect(isSuppressed(X, unknownContext())).toBe(false);
  });

  it("offers no import when the account could not be reached", () => {
    expect(eligibleForImport(LAPTOP_B_LOCAL, unknownContext())).toEqual([]);
  });

  it("recovers the moment the account answers again", () => {
    const state: HistoryState = { stored: [], deleted: [X.id], clearedAt: null };
    expect(suppressDeleted(LAPTOP_B_LOCAL, unknownContext())).toHaveLength(2);
    expect(
      suppressDeleted(LAPTOP_B_LOCAL, reconnecting(state, LAPTOP_B_LOCAL)).map(
        (entry) => entry.id,
      ),
    ).toEqual([Y.id]);
  });
});

/* --------------------------------------------------- resumable import ---- */

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
    expect(
      eligibleForImport([long], reconnecting(halfway, [long])).map((entry) => entry.id),
    ).toEqual([long.id]);

    const complete: HistoryState = {
      stored: [{ id: long.id, messages: 5 }],
      deleted: [],
      clearedAt: null,
    };
    expect(isFullyStored(long, complete)).toBe(true);
    expect(eligibleForImport([long], reconnecting(complete, [long]))).toEqual([]);
  });

  it("does not re-offer a conversation the account holds MORE of", () => {
    const state: HistoryState = {
      stored: [{ id: Y.id, messages: 9 }],
      deleted: [],
      clearedAt: null,
    };
    expect(isFullyStored(Y, state)).toBe(true);
    expect(eligibleForImport([Y], reconnecting(state, [Y]))).toEqual([]);
  });
});
