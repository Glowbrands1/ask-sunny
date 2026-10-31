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
  it("this account's key, or no key and stored by this account, is mine; everything else is held back", () => {
    const { mine, others } = partitionByOwner(
      [chat("conv_a", "me"), chat("conv_b", "them"), chat("conv_c"), chat("conv_d")],
      "me",
      new Set(["conv_c"]),
    );
    expect(mine.map((entry) => entry.id)).toEqual(["conv_a", "conv_c"]);
    expect(others.map((entry) => entry.id)).toEqual(["conv_b", "conv_d"]);
  });

  it("no key known: nothing is mine", () => {
    expect(partitionByOwner([chat("conv_a", "me")], null, new Set(["conv_a"])).mine).toEqual([]);
  });
});

describe("stampOwner", () => {
  it("stamps this account's key, leaving a chat already stamped as it is", () => {
    const same = chat("conv_a", "me");
    const stamped = stampOwner([same, chat("conv_b")], "me");
    expect(stamped[0]).toBe(same);
    expect(stamped[1]!.ownerKey).toBe("me");
  });
});
