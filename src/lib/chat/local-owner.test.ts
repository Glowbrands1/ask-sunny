import { afterEach, describe, expect, it } from "vitest";

import type { ChatConversation } from "@/types";
import { belongsToAnotherAccount, localOwnerEnabled, ownConversations, stampOwnConversations } from "./local-owner";

/**
 * Port from the sibling app (QA, 30 Oct 2026, its production): an assistant
 * signed in on their manager's browser saw the manager's chats and imported
 * them. With the flag
 * on, the browser shows each account only the chats it wrote.
 */
const MANAGER = "key-manager";
const ASSISTANT = "key-assistant";

function chat(id: string, ownerKey?: string): ChatConversation {
  return { id, title: id, createdAt: "2026-10-30T18:09:02.936Z", updatedAt: "2026-10-30T18:28:24.414Z", messages: [], attachedDocumentIds: [], ...(ownerKey ? { ownerKey } : {}) };
}

const before = process.env.NEXT_PUBLIC_CHAT_LOCAL_OWNER_ENABLED;
afterEach(() => {
  if (before === undefined) delete process.env.NEXT_PUBLIC_CHAT_LOCAL_OWNER_ENABLED;
  else process.env.NEXT_PUBLIC_CHAT_LOCAL_OWNER_ENABLED = before;
});

describe("the assistant signs in on the manager's browser", () => {
  const browser = [chat("conv_manager1", MANAGER), chat("conv_manager2", MANAGER), chat("conv_old"), chat("conv_mine", ASSISTANT)];

  it("sees their own chats and the unstamped one, never the manager's", () => {
    expect(ownConversations(browser, ASSISTANT).map((entry) => entry.id)).toEqual(["conv_old", "conv_mine"]);
    expect(belongsToAnotherAccount(browser[0]!, ASSISTANT)).toBe(true);
  });

  it("the manager, back on their browser, sees theirs again: nothing was removed", () => {
    expect(ownConversations(browser, MANAGER).map((entry) => entry.id)).toEqual(["conv_manager1", "conv_manager2", "conv_old"]);
  });

  it("with no key yet (account not reached, or the flag off), everything shows as today", () => {
    expect(ownConversations(browser, null)).toBe(browser);
  });
});

describe("stamping", () => {
  it("stamps what the account holds and what was started this session; leaves an older unknown chat unstamped", () => {
    const local = [chat("conv_stored"), chat("conv_new"), chat("conv_older"), chat("conv_theirs", MANAGER)];
    const stamped = stampOwnConversations(local, ASSISTANT, {
      stored: new Set(["conv_stored"]),
      preExisting: new Set(["conv_stored", "conv_older", "conv_theirs"]),
    });
    expect(stamped.map((entry) => [entry.id, entry.ownerKey ?? null])).toEqual([
      ["conv_stored", ASSISTANT],
      ["conv_new", ASSISTANT],
      ["conv_older", null],
      ["conv_theirs", MANAGER],
    ]);
  });

  it("returns the same array when nothing changes", () => {
    const local = [chat("conv_a", ASSISTANT)];
    expect(stampOwnConversations(local, ASSISTANT, { stored: new Set(), preExisting: new Set() })).toBe(local);
  });
});

describe("the flag", () => {
  it("reads off by default", () => {
    delete process.env.NEXT_PUBLIC_CHAT_LOCAL_OWNER_ENABLED;
    expect(localOwnerEnabled()).toBe(false);
    process.env.NEXT_PUBLIC_CHAT_LOCAL_OWNER_ENABLED = "true";
    expect(localOwnerEnabled()).toBe(true);
  });
});
