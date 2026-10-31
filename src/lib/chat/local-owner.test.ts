import { describe, expect, it } from "vitest";

import { partitionByOwner, stampOwner, type OwnedConversation } from "./local-owner";

const chat = (id: string, ownerKey?: string): OwnedConversation => ({
  id,
  title: id,
  createdAt: "2026-10-30T18:09:00.000Z",
  updatedAt: "2026-10-30T18:28:00.000Z",
  messages: [],
  attachedDocumentIds: [],
  ...(ownerKey ? { ownerKey } : {}),
});

describe("partitionByOwner", () => {
  // Changed on purpose (Pau, 31 Oct 2026: "Keep them visible"): an unstamped chat this account does not hold is shown, not held back.
  it("this account's key, or no key and stored by this account, is mine; no key and not held is unclaimed; another key is held back", () => {
    const { mine, unclaimed, others } = partitionByOwner(
      [chat("conv_a", "me"), chat("conv_b", "them"), chat("conv_c"), chat("conv_d")],
      "me",
      new Set(["conv_c"]),
    );
    expect(mine.map((entry) => entry.id)).toEqual(["conv_a", "conv_c"]);
    expect(unclaimed.map((entry) => entry.id)).toEqual(["conv_d"]);
    expect(others.map((entry) => entry.id)).toEqual(["conv_b"]);
  });

  it("no key known: nothing is mine", () => {
    expect(partitionByOwner([chat("conv_a", "me")], null, new Set(["conv_a"])).mine).toEqual([]);
  });
});

describe("stampOwner", () => {
  it("never stamps an unclaimed legacy chat as this account's", () => {
    const stamped = stampOwner([chat("conv_d"), chat("conv_new")], "me", new Set(["conv_d"]));
    expect(stamped[0]!.ownerKey).toBeUndefined();
    expect(stamped[1]!.ownerKey).toBe("me");
  });

  it("stamps this account's key, leaving a chat already stamped as it is", () => {
    const same = chat("conv_a", "me");
    const stamped = stampOwner([same, chat("conv_b")], "me");
    expect(stamped[0]).toBe(same);
    expect(stamped[1]!.ownerKey).toBe("me");
  });
});
