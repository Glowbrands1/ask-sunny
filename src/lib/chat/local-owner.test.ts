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
  /*
   * Changed on purpose (owner, 23 Nov 2026: "that chats from other account leak to other poeples log in, i dont
   * want that"). Until now an unstamped chat this account does not hold was shown (Pau, 31 Oct 2026: "Keep them
   * visible"), so another account's legacy chat appeared to whoever signed in next on a shared browser. Now it is
   * held back like another account's.
   */
  it("this account's key, or no key and stored by this account, is mine; everything else is held back, unstamped legacy chats included", () => {
    const { mine, unclaimed, others } = partitionByOwner(
      [chat("conv_a", "me"), chat("conv_b", "them"), chat("conv_c"), chat("conv_d")],
      "me",
      new Set(["conv_c"]),
    );
    expect(mine.map((entry) => entry.id)).toEqual(["conv_a", "conv_c"]);
    expect(unclaimed).toEqual([]);
    expect(others.map((entry) => entry.id)).toEqual(["conv_b", "conv_d"]);
  });

  it("the shared-browser case: the next account to sign in sees none of the first account's chats, stamped or not", () => {
    const browser = [chat("first_stamped", "first"), chat("first_legacy")];
    const next = partitionByOwner(browser, "second", new Set());
    expect(next.mine).toEqual([]);
    expect(next.unclaimed).toEqual([]);
    expect(next.others.map((entry) => entry.id)).toEqual(["first_stamped", "first_legacy"]);
    // The first account still gets its own legacy chat back when the server holds it for them.
    expect(partitionByOwner(browser, "first", new Set(["first_legacy"])).mine.map((entry) => entry.id)).toEqual(["first_stamped", "first_legacy"]);
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
