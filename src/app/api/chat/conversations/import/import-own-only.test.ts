import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fakeChatSupabase } from "@/test/fake-chat-supabase";

/**
 * ============================================================================
 * ANOTHER ACCOUNT'S CHAT IS NOT IMPORTED — CHAT_IMPORT_OWN_ONLY_ENABLED
 * ============================================================================
 *
 * Port from the sibling app (QA, 30 Oct 2026, its production). A manager chatted about a
 * coaching form; their assistant then signed in on the same browser and
 * pressed Import, which offers every chat the browser holds. The manager's six
 * chats — employee coaching details included — were stored in the assistant
 * manager's account. Reported as "every message saved twice".
 *
 * The browser's store is not keyed by account, so the server decides: a chat
 * whose answered turns were answered for another account (the server-set
 * `activity_events.actor_user_id`) is that account's, and is declined.
 */

const ORIGINAL = { ...process.env };
const FLAG = "CHAT_IMPORT_OWN_ONLY_ENABLED";

const MANAGER = "11111111-1111-4111-8111-111111111111";
const ASSISTANT = "22222222-2222-4222-8222-222222222222";
const TURN = "33333333-3333-4333-8333-333333333333";

/** The manager's chat, as the shared browser holds it. Names are invented. */
const MANAGERS_CHAT = {
  id: "conv_mvvadk9k8yp7ck2",
  title: "Coaching Form",
  createdAt: "2026-10-30T18:09:02.936Z",
  updatedAt: "2026-10-30T18:28:24.414Z",
  attachedDocumentIds: [],
  messages: [
    {
      id: "msg_mvvadk9k7464fur",
      role: "user",
      content: "Create a coaching form.",
      createdAt: "2026-10-30T18:09:02.936Z",
    },
    {
      id: "msg_mvvadofj9pe7juz",
      role: "assistant",
      content: "Here is what I would put on a **Coaching Form** for Marnie Holloway.",
      createdAt: "2026-10-30T18:09:08.335Z",
      mode: "standard",
      coverage: "grounded",
      turnId: TURN,
    },
  ],
};

async function load(subject: string, db: ReturnType<typeof fakeChatSupabase>) {
  vi.resetModules();
  vi.doMock("@/lib/auth/server", () => ({
    authorizeRequest: async (_request: Request, permission: string) => ({
      identity: {
        subject,
        email: "someone@example.com",
        displayName: "Someone",
        role: "assistant_salon_director",
        scope: { level: "location", primaryAreaId: "salon-0101", alsoCoversAreaIds: [] },
        verified: true,
      },
      permission,
      provider: "supabase",
    }),
  }));
  vi.doMock("@/lib/supabase/server", () => ({ getSupabaseAdmin: () => db.client }));
  return {
    importRoute: await import("./route"),
    saveRoute: await import("../route"),
  };
}

function post(url: string, body: Record<string, unknown>): Request {
  return new Request(`https://app.test${url}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** The turn was answered for the manager: the server-set activity row says so. */
function database(managerHoldsIt: boolean) {
  const db = fakeChatSupabase({
    activity_events: [{ id: TURN, actor_user_id: MANAGER, occurred_at: "2026-10-30T18:09:08.000Z" }],
  });
  return { db, managerHoldsIt };
}

async function importAs(subject: string, on: boolean, managerHoldsIt = true) {
  if (on) process.env[FLAG] = "true";
  else delete process.env[FLAG];
  const { db } = database(managerHoldsIt);
  if (managerHoldsIt) {
    const manager = await load(MANAGER, db);
    await manager.saveRoute.POST(post("/api/chat/conversations", { conversation: MANAGERS_CHAT }));
  }
  const { importRoute } = await load(subject, db);
  const response = await importRoute.POST(post("/api/chat/conversations/import", { conversations: [MANAGERS_CHAT] }));
  const payload = (await response.json()) as { imported: string[]; declined: { id: string | null; reason: string }[] };
  const held = (user: string) =>
    db.tables.chat_conversations.filter((row) => row.user_id === user && row.client_conversation_id === MANAGERS_CHAT.id);
  return { payload, held };
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_DEMO_MODE = "false";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test";
  process.env.SUPABASE_SECRET_KEY = ["sb", "secret", "TESTFIXTURE"].join("_");
  process.env.ANTHROPIC_API_KEY = "test";
});

afterEach(() => {
  process.env = { ...ORIGINAL };
  vi.doUnmock("@/lib/auth/server");
  vi.doUnmock("@/lib/supabase/server");
  vi.resetModules();
});

describe("the assistant manager presses Import on the manager's browser", () => {
  it("off, as reported: the manager's chat is copied into the assistant manager's account", async () => {
    const { payload, held } = await importAs(ASSISTANT, false);
    expect(payload.imported).toEqual([MANAGERS_CHAT.id]);
    expect(held(ASSISTANT)).toHaveLength(1);
  });

  it("on: declined as another account's, and nothing is stored for the assistant manager", async () => {
    const { payload, held } = await importAs(ASSISTANT, true);
    expect(payload.imported).toEqual([]);
    expect(payload.declined).toEqual([{ id: MANAGERS_CHAT.id, reason: "another_account" }]);
    expect(held(ASSISTANT)).toHaveLength(0);
    expect(held(MANAGER)).toHaveLength(1);
  });

  it("on: declined by its answered turn alone, when the manager never saved it", async () => {
    const { payload, held } = await importAs(ASSISTANT, true, false);
    expect(payload.declined).toEqual([{ id: MANAGERS_CHAT.id, reason: "another_account" }]);
    expect(held(ASSISTANT)).toHaveLength(0);
  });

  it("on: the manager's own import of their own chat still goes through", async () => {
    const { payload, held } = await importAs(MANAGER, true, false);
    expect(payload.imported).toEqual([MANAGERS_CHAT.id]);
    expect(held(MANAGER)).toHaveLength(1);
  });
});

describe("a live save of another account's chat", () => {
  it("on: refused like any conversation that is not yours", async () => {
    process.env[FLAG] = "true";
    const { db } = database(false);
    const { saveRoute } = await load(ASSISTANT, db);
    const response = await saveRoute.POST(post("/api/chat/conversations", { conversation: MANAGERS_CHAT }));
    expect(response.status).toBe(403);
    expect(db.tables.chat_conversations).toHaveLength(0);
  });
});

/*
 * INDEPENDENT REVIEW, 31 Oct 2026: CHAT_IMPORT_OWN_ONLY passed a chat with no
 * turn evidence — no turn id (a chat whose answer was never recorded, or an
 * older build), a turn id with no activity row, or a row with no actor — so
 * another account's chat could still be imported on a shared browser.
 * CHAT_IMPORT_PROVEN_OWN_ENABLED: an import must prove every answered turn is
 * this account's.
 */
describe("CHAT_IMPORT_PROVEN_OWN_ENABLED: an import with no proof of whose it is", () => {
  const PROVEN = "CHAT_IMPORT_PROVEN_OWN_ENABLED";
  const withoutTurn = {
    ...MANAGERS_CHAT,
    messages: MANAGERS_CHAT.messages.map((message) => {
      const copy: Record<string, unknown> = { ...message };
      delete copy.turnId;
      return copy;
    }),
  } as unknown as typeof MANAGERS_CHAT;

  async function importChat(chat: typeof MANAGERS_CHAT, activity: { id: string; actor_user_id: string | null }[], proven: boolean) {
    process.env[FLAG] = "true";
    if (proven) process.env[PROVEN] = "true";
    else delete process.env[PROVEN];
    const db = fakeChatSupabase({ activity_events: activity.map((row) => ({ ...row, occurred_at: "2026-10-30T18:09:08.000Z" })) });
    const { importRoute } = await load(ASSISTANT, db);
    const response = await importRoute.POST(post("/api/chat/conversations/import", { conversations: [chat] }));
    return (await response.json()) as { imported: string[]; declined: { id: string | null; reason: string }[] };
  }

  it("off (CHAT_IMPORT_OWN_ONLY alone): a chat with no turn id is imported into the other account", async () => {
    expect((await importChat(withoutTurn, [], false)).imported).toEqual([MANAGERS_CHAT.id]);
  });

  it.each([
    ["no turn id at all", withoutTurn, []],
    ["a turn with no activity row", MANAGERS_CHAT, []],
    ["a turn with no actor", MANAGERS_CHAT, [{ id: TURN, actor_user_id: null }]],
  ] as const)("on: declined — %s", async (_case, chat, activity) => {
    const payload = await importChat(chat, [...activity], true);
    expect(payload.imported).toEqual([]);
    expect(payload.declined).toEqual([{ id: MANAGERS_CHAT.id, reason: "another_account" }]);
  });

  it("on: a chat whose every answered turn is this account's is imported", async () => {
    const payload = await importChat(MANAGERS_CHAT, [{ id: TURN, actor_user_id: ASSISTANT }], true);
    expect(payload.imported).toEqual([MANAGERS_CHAT.id]);
  });
});
