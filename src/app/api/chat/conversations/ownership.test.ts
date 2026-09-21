import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fakeChatSupabase, type FakeChatSupabase } from "@/test/fake-chat-supabase";

/**
 * ============================================================================
 * NOBODY REACHES ANYBODY ELSE'S CONVERSATION
 * ============================================================================
 *
 * The one rule Phase 2A is built on, tested against the REAL store code rather
 * than a mock of it — the ownership scoping lives in the statements
 * `lib/chat/store.ts` issues, so a test that mocked the store would assert only
 * that a stub returns what it was told to.
 *
 * What is deliberately absent from these tests, because it is absent from the
 * code: any route, argument or role that returns somebody else's conversation.
 * There is no administrative viewer in this phase and no permission that would
 * grant one, so "an Owner can read everything" has no test here because it has
 * no implementation — and `lib/chat/boundaries.test.ts` asserts that stays true.
 */

const ORIGINAL = { ...process.env };

/* Real-shaped ids: `createId` output, which the validator requires. */
const MINE = "conv_mfx1a2b3c4d5e";
const THEIRS = "conv_mfx9z8y7x6w5v";
const MINE_MSG = "msg_mfx1a2b3c4d5e";
const THEIRS_MSG = "msg_mfx9z8y7x6w5v";

const ME = "11111111-1111-4111-8111-111111111111";
const THEM = "22222222-2222-4222-8222-222222222222";

interface Loaded {
  list: typeof import("./route");
  one: typeof import("./[id]/route");
  importRoute: typeof import("./import/route");
  db: FakeChatSupabase;
}

async function load(
  subject: string | null,
  db: FakeChatSupabase = fixture(),
): Promise<Loaded> {
  vi.resetModules();

  vi.doMock("@/lib/auth/server", () => ({
    authorizeRequest: async (_request: Request, permission: string) => {
      if (!subject) {
        const { AuthError } = await import("@/lib/auth/types");
        throw new AuthError("unauthenticated", "You are not signed in.");
      }
      return {
        identity: {
          subject,
          email: "sd@example.com",
          displayName: "SD",
          role: "salon_director",
          scope: { level: "salon", primaryAreaId: "loc-0101", alsoCoversAreaIds: [] },
          verified: true,
        },
        permission,
        provider: "supabase",
      };
    },
  }));

  vi.doMock("@/lib/supabase/server", () => ({
    getSupabaseAdmin: () => db.client,
  }));

  return {
    list: await import("./route"),
    one: await import("./[id]/route"),
    importRoute: await import("./import/route"),
    db,
  };
}

/** Two people, one conversation each, each with one turn. */
function fixture(): FakeChatSupabase {
  return fakeChatSupabase({
    chat_conversations: [
      {
        id: "row-mine",
        user_id: ME,
        client_conversation_id: MINE,
        title: "My thread",
        created_at: "2026-09-19T14:00:00.000Z",
        updated_at: "2026-09-19T14:05:00.000Z",
        archived_at: null,
      },
      {
        id: "row-theirs",
        user_id: THEM,
        client_conversation_id: THEIRS,
        title: "Their thread",
        created_at: "2026-09-19T15:00:00.000Z",
        updated_at: "2026-09-19T15:05:00.000Z",
        archived_at: null,
      },
    ],
    chat_messages: [
      {
        id: "msg-row-mine",
        conversation_id: "row-mine",
        user_id: ME,
        client_message_id: MINE_MSG,
        role: "user",
        content: "mine: what is the attendance policy?",
        created_at: "2026-09-19T14:00:00.000Z",
        position: 0,
        turn_id: null,
        metadata: {},
      },
      {
        id: "msg-row-theirs",
        conversation_id: "row-theirs",
        user_id: THEM,
        client_message_id: THEIRS_MSG,
        role: "user",
        content: "theirs: a private question about an employee",
        created_at: "2026-09-19T15:00:00.000Z",
        position: 0,
        turn_id: null,
        metadata: {},
      },
    ],
  });
}

function get(url: string): Request {
  return new Request(url);
}

function post(url: string, body: Record<string, unknown>): Request {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.resetModules();
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

/* ------------------------------------------------------------- listing --- */

describe("a person lists their own history and only their own", () => {
  it("returns my conversation and not theirs", async () => {
    const { list } = await load(ME);
    const response = await list.GET(get("https://app.test/api/chat/conversations"));
    const payload = (await response.json()) as {
      conversations: { id: string; messages: { content: string }[] }[];
    };

    expect(response.status).toBe(200);
    expect(payload.conversations.map((entry) => entry.id)).toEqual([MINE]);
    expect(JSON.stringify(payload)).not.toContain("theirs:");
  });

  it("returns the other person's conversation to the other person", async () => {
    const { list } = await load(THEM);
    const response = await list.GET(get("https://app.test/api/chat/conversations"));
    const payload = (await response.json()) as { conversations: { id: string }[] };

    expect(payload.conversations.map((entry) => entry.id)).toEqual([THEIRS]);
  });

  it("scopes the message read by the reader as well as by the conversation", async () => {
    const { list, db } = await load(ME);
    await list.GET(get("https://app.test/api/chat/conversations"));

    const messageReads = db.statements.filter(
      (statement) => statement.table === "chat_messages",
    );
    expect(messageReads.length).toBeGreaterThan(0);
    for (const statement of messageReads) {
      expect(statement.filters.user_id).toBe(ME);
    }
  });

  it("refuses an unauthenticated caller", async () => {
    const { list } = await load(null);
    const response = await list.GET(get("https://app.test/api/chat/conversations"));
    expect(response.status).toBe(401);
  });
});

/* ------------------------------------------------------ direct id access -- */

describe("changing the conversation id in the URL buys nothing", () => {
  it("opens my own conversation", async () => {
    const { one } = await load(ME);
    const response = await one.GET(get(`https://app.test/x/${MINE}`), {
      params: Promise.resolve({ id: MINE }),
    });

    expect(response.status).toBe(200);
    const payload = (await response.json()) as { conversation: { id: string } };
    expect(payload.conversation.id).toBe(MINE);
  });

  it("refuses somebody else's, and leaks none of its content", async () => {
    const { one } = await load(ME);
    const response = await one.GET(get(`https://app.test/x/${THEIRS}`), {
      params: Promise.resolve({ id: THEIRS }),
    });

    expect(response.status).toBe(403);
    const body = await response.text();
    expect(body).not.toContain("theirs:");
    expect(body).not.toContain("Their thread");
  });

  it("answers a missing conversation and somebody else's IDENTICALLY", async () => {
    /*
     * The anti-enumeration property. If "does not exist" and "not yours" read
     * differently, sweeping ids tells an attacker which ones are real — which
     * is the entire value of sweeping them.
     */
    const { one } = await load(ME);
    const missing = await one.GET(get("https://app.test/x/conv_mfxaaaaaaaaaa"), {
      params: Promise.resolve({ id: "conv_mfxaaaaaaaaaa" }),
    });
    const notMine = await one.GET(get(`https://app.test/x/${THEIRS}`), {
      params: Promise.resolve({ id: THEIRS }),
    });

    expect(missing.status).toBe(notMine.status);
    expect(await missing.text()).toBe(await notMine.text());
  });

  it.each([
    ["a demo seed id", "conv-seed-1"],
    ["a message id", MINE_MSG],
    ["a uuid", "11111111-1111-4111-8111-111111111111"],
    ["a path traversal", "../../etc/passwd"],
    ["a SQL fragment", "conv_1' or '1'='1"],
    ["an empty id", ""],
    ["a very long id", `conv_${"a".repeat(500)}`],
  ])("fails safely on %s, with the same refusal", async (_label, id) => {
    const { one, db } = await load(ME);
    const response = await one.GET(get("https://app.test/x/whatever"), {
      params: Promise.resolve({ id }),
    });

    expect(response.status).toBe(403);
    /* A malformed id never reaches Postgres at all. */
    expect(db.statements).toHaveLength(0);
  });

  it("refuses an unauthenticated read of a real conversation", async () => {
    const { one } = await load(null);
    const response = await one.GET(get(`https://app.test/x/${MINE}`), {
      params: Promise.resolve({ id: MINE }),
    });
    expect(response.status).toBe(401);
  });
});

/* ------------------------------------------------------------- deleting -- */

describe("deleting reaches only your own conversations", () => {
  it("tombstones mine: the turns and the title go, the decision stays", async () => {
    const { one, db } = await load(ME);
    const response = await one.DELETE(get(`https://app.test/x/${MINE}`), {
      params: Promise.resolve({ id: MINE }),
    });

    expect(response.status).toBe(200);

    /*
     * THE ROW SURVIVES SO THE DELETE DOES. A hard delete would leave the server
     * with no record that this conversation existed, and a second browser's
     * stale copy would look like history the account had never seen — which is
     * exactly how a deleted thread comes back.
     */
    const tombstone = db.tables.chat_conversations.find(
      (row) => row.client_conversation_id === MINE,
    );
    expect(tombstone).toBeDefined();
    expect(tombstone!.deleted_at).toBeTruthy();

    /* And it carries nothing she wrote: no title, no turns. */
    expect(tombstone!.title).toBeNull();
    expect(db.tables.chat_messages.map((row) => row.client_message_id)).toEqual([
      THEIRS_MSG,
    ]);

    /* It is not history any more, so it is not in her history. */
    const list = await one.GET(get(`https://app.test/x/${MINE}`), {
      params: Promise.resolve({ id: MINE }),
    });
    expect(list.status).toBe(403);
  });

  it("refuses to delete somebody else's, and removes nothing", async () => {
    const { one, db } = await load(ME);
    const response = await one.DELETE(get(`https://app.test/x/${THEIRS}`), {
      params: Promise.resolve({ id: THEIRS }),
    });

    expect(response.status).toBe(403);
    expect(db.tables.chat_conversations).toHaveLength(2);
    expect(db.tables.chat_messages).toHaveLength(2);
  });

  it("clears only the caller's history, never the whole table", async () => {
    const { list, db } = await load(ME);
    const response = await list.DELETE(get("https://app.test/api/chat/conversations"));

    expect(response.status).toBe(200);
    expect(db.tables.chat_conversations.map((row) => row.user_id)).toEqual([THEM]);
    expect(db.tables.chat_messages.map((row) => row.user_id)).toEqual([THEM]);

    /* And the boundary that stops any of it coming back from another device. */
    expect(db.tables.chat_history_boundaries).toHaveLength(1);
    expect(db.tables.chat_history_boundaries[0].user_id).toBe(ME);
    expect(db.tables.chat_history_boundaries[0].history_cleared_at).toBeTruthy();

    const deletes = db.statements.filter((statement) => statement.op === "delete");
    expect(deletes.length).toBeGreaterThan(0);
    for (const statement of deletes) {
      expect(statement.filters.user_id).toBe(ME);
    }
  });
});

/* ------------------------------------------------------- mass assignment -- */

describe("the body cannot decide who a conversation belongs to", () => {
  it("ignores a user_id in the body", async () => {
    const { list, db } = await load(ME);
    const response = await list.POST(
      post("https://app.test/api/chat/conversations", {
        userId: THEM,
        user_id: THEM,
        conversation: {
          id: "conv_mfxnew111111a",
          user_id: THEM,
          title: "Mine really",
          createdAt: "2026-09-20T10:00:00.000Z",
          updatedAt: "2026-09-20T10:00:00.000Z",
          messages: [
            {
              id: "msg_mfxnew111111a",
              role: "user",
              content: "hello",
              createdAt: "2026-09-20T10:00:00.000Z",
            },
          ],
        },
      }),
    );

    expect(response.status).toBe(200);
    const created = db.tables.chat_conversations.find(
      (row) => row.client_conversation_id === "conv_mfxnew111111a",
    );
    expect(created?.user_id).toBe(ME);
    expect(db.tables.chat_messages.find((row) => row.client_message_id === "msg_mfxnew111111a")?.user_id).toBe(ME);
  });

  it("presenting somebody else's conv id creates a row of your OWN", async () => {
    /*
     * The browser's ids are correlation keys, and uniqueness is per user. So
     * naming another person's conversation cannot touch it: it opens one of
     * yours under the same local name, which is harmless and is exactly why the
     * ids confer nothing.
     */
    const { list, db } = await load(ME);
    const before = JSON.stringify(
      db.tables.chat_conversations.find((row) => row.user_id === THEM),
    );

    const response = await list.POST(
      post("https://app.test/api/chat/conversations", {
        conversation: {
          id: THEIRS,
          title: "Hijack attempt",
          createdAt: "2026-09-20T10:00:00.000Z",
          updatedAt: "2026-09-20T10:00:00.000Z",
          messages: [
            {
              id: "msg_mfxnew222222b",
              role: "user",
              content: "overwrite",
              createdAt: "2026-09-20T10:00:00.000Z",
            },
          ],
        },
      }),
    );

    expect(response.status).toBe(200);
    /* Their row is byte-for-byte untouched. */
    expect(
      JSON.stringify(db.tables.chat_conversations.find((row) => row.user_id === THEM)),
    ).toBe(before);
    /* And a second row now exists under the same local id, owned by me. */
    const rows = db.tables.chat_conversations.filter(
      (row) => row.client_conversation_id === THEIRS,
    );
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.user_id).sort()).toEqual([ME, THEM].sort());
  });

  it("refuses a seeded demo conversation outright", async () => {
    const { list, db } = await load(ME);
    const response = await list.POST(
      post("https://app.test/api/chat/conversations", {
        conversation: {
          id: "conv-seed-1",
          title: "Daily Stats — conversion focus",
          createdAt: "2026-09-20T10:00:00.000Z",
          updatedAt: "2026-09-20T10:00:00.000Z",
          messages: [
            {
              id: "msg-s1-1",
              role: "user",
              content: "What should I focus on in today's Daily Stats?",
              createdAt: "2026-09-20T10:00:00.000Z",
            },
          ],
        },
      }),
    );

    expect(response.status).toBe(400);
    expect(db.tables.chat_conversations).toHaveLength(2);
  });

  it("refuses an unauthenticated save", async () => {
    const { list, db } = await load(null);
    const response = await list.POST(
      post("https://app.test/api/chat/conversations", { conversation: {} }),
    );
    expect(response.status).toBe(401);
    expect(db.tables.chat_conversations).toHaveLength(2);
  });
});

/* --------------------------------------------------------- outage vs no --- */

describe("a database failure is never reported as a refusal", () => {
  it("answers 503 when the conversation table cannot be read", async () => {
    const db = fixture();
    const { one } = await load(ME, db);
    db.failOn("chat_conversations");

    const response = await one.GET(get(`https://app.test/x/${MINE}`), {
      params: Promise.resolve({ id: MINE }),
    });

    /*
     * Telling somebody their own conversation is not theirs because Supabase
     * was briefly unreachable is both wrong and alarming — the same distinction
     * `assertOwnTurn` draws for a turn.
     */
    expect(response.status).toBe(503);
    const payload = (await response.json()) as { code: string; error: string };
    expect(payload.code).toBe("chat_unavailable");
    expect(payload.error).toContain("still on this device");
  });

  it("answers 503 on a failed save and stores nothing", async () => {
    const db = fixture();
    const { list } = await load(ME, db);
    db.failOn("chat_conversations");

    const response = await list.POST(
      post("https://app.test/api/chat/conversations", {
        conversation: {
          id: "conv_mfxnew333333c",
          title: "New",
          createdAt: "2026-09-20T10:00:00.000Z",
          updatedAt: "2026-09-20T10:00:00.000Z",
          messages: [
            {
              id: "msg_mfxnew333333c",
              role: "user",
              content: "hello",
              createdAt: "2026-09-20T10:00:00.000Z",
            },
          ],
        },
      }),
    );

    expect(response.status).toBe(503);
    expect(db.tables.chat_messages).toHaveLength(2);
  });

  it("never quotes a Postgres message back to the caller", async () => {
    const db = fixture();
    const { one } = await load(ME, db);
    db.failOn("chat_conversations");

    const response = await one.GET(get(`https://app.test/x/${MINE}`), {
      params: Promise.resolve({ id: MINE }),
    });
    const body = await response.text();

    /*
     * Rows here hold what somebody asked Sunny about a named employee, and a
     * Postgres error can quote row contents.
     */
    expect(body).not.toContain("fake failure");
    expect(body).not.toContain("XX000");
  });
});

/* ----------------------------------------------------------- cross-device -- */

describe("the same account, two browsers", () => {
  /**
   * The behaviour the whole phase exists for, end to end through the routes:
   * a conversation saved from one browser is readable from another, is
   * continuable there, and is invisible to anybody else — with no reference
   * anywhere to a device, a location or an address.
   */
  const FRESH = {
    id: "conv_mfxcrossdev1",
    title: "Started in Kansas City",
    createdAt: "2026-09-20T10:00:00.000Z",
    updatedAt: "2026-09-20T10:00:00.000Z",
    messages: [
      {
        id: "msg_mfxcrossdev1",
        role: "user",
        content: "What is the attendance policy?",
        createdAt: "2026-09-20T10:00:00.000Z",
      },
    ],
  };

  it("appears in the history the same account reads from a second browser", async () => {
    const db = fakeChatSupabase();

    /* Browser A saves it. */
    const browserA = await load(ME, db);
    expect(
      (
        await browserA.list.POST(
          post("https://app.test/api/chat/conversations", { conversation: FRESH }),
        )
      ).status,
    ).toBe(200);

    /* Browser B — a separate module registry, a separate request, same account. */
    const browserB = await load(ME, db);
    const response = await browserB.list.GET(
      get("https://app.test/api/chat/conversations"),
    );
    const payload = (await response.json()) as {
      conversations: { id: string; title: string; messages: { content: string }[] }[];
    };

    expect(payload.conversations.map((entry) => entry.id)).toContain(FRESH.id);
    const found = payload.conversations.find((entry) => entry.id === FRESH.id)!;
    expect(found.title).toBe("Started in Kansas City");
    expect(found.messages[0].content).toBe("What is the attendance policy?");
  });

  it("can be continued from the second browser and reads back on the first", async () => {
    const db = fakeChatSupabase();
    const browserA = await load(ME, db);
    await browserA.list.POST(
      post("https://app.test/api/chat/conversations", { conversation: FRESH }),
    );

    const browserB = await load(ME, db);
    await browserB.list.POST(
      post("https://app.test/api/chat/conversations", {
        conversation: {
          ...FRESH,
          updatedAt: "2026-09-20T11:00:00.000Z",
          messages: [
            ...FRESH.messages,
            {
              id: "msg_mfxcrossdev2",
              role: "assistant",
              content: "Three occurrences in a rolling ninety days.",
              createdAt: "2026-09-20T11:00:00.000Z",
            },
          ],
        },
      }),
    );

    const back = await load(ME, db);
    const response = await back.one.GET(get(`https://app.test/x/${FRESH.id}`), {
      params: Promise.resolve({ id: FRESH.id }),
    });
    const payload = (await response.json()) as {
      conversation: { messages: { id: string }[] };
    };

    /* One conversation, two turns, in order — not two conversations. */
    expect(db.tables.chat_conversations).toHaveLength(1);
    expect(payload.conversation.messages.map((entry) => entry.id)).toEqual([
      "msg_mfxcrossdev1",
      "msg_mfxcrossdev2",
    ]);
  });

  it("is invisible to a different account, however it is asked for", async () => {
    const db = fakeChatSupabase();
    const mine = await load(ME, db);
    await mine.list.POST(
      post("https://app.test/api/chat/conversations", { conversation: FRESH }),
    );

    const theirs = await load(THEM, db);

    const list = await theirs.list.GET(get("https://app.test/api/chat/conversations"));
    expect((await list.json()).conversations).toEqual([]);

    const direct = await theirs.one.GET(get(`https://app.test/x/${FRESH.id}`), {
      params: Promise.resolve({ id: FRESH.id }),
    });
    expect(direct.status).toBe(403);
    expect(await direct.text()).not.toContain("attendance policy");

    const stored = await theirs.importRoute.GET(
      get("https://app.test/api/chat/conversations/import"),
    );
    expect((await stored.json()).stored).toEqual([]);
  });

  it("carries no device, location or address anywhere in the record", async () => {
    /*
     * This is not an IP-based system. Ownership is the authenticated subject
     * and nothing else, so there is no column, field or header here that could
     * tie a conversation to where it was had.
     */
    const db = fakeChatSupabase();
    const { list } = await load(ME, db);
    await list.POST(
      new Request("https://app.test/api/chat/conversations", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": "203.0.113.9",
          "user-agent": "Mozilla/5.0 (a very specific browser)",
        },
        body: JSON.stringify({ conversation: FRESH }),
      }),
    );

    const stored = JSON.stringify(db.tables);
    expect(stored).not.toContain("203.0.113.9");
    expect(stored).not.toContain("Mozilla");
    expect(stored).not.toContain("x-forwarded-for");
  });

  it("reports no attachments, because chat has no attachment system", async () => {
    const db = fakeChatSupabase();
    const { list } = await load(ME, db);
    await list.POST(
      post("https://app.test/api/chat/conversations", {
        /* Even when the browser sends some, there is nowhere for them to go. */
        conversation: { ...FRESH, attachedDocumentIds: ["kb_1", "kb_2"] },
      }),
    );

    expect(JSON.stringify(db.tables)).not.toContain("kb_1");

    const response = await list.GET(get("https://app.test/api/chat/conversations"));
    const payload = (await response.json()) as {
      conversations: { attachedDocumentIds: string[] }[];
    };
    expect(payload.conversations[0].attachedDocumentIds).toEqual([]);
  });
});
