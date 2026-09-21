import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fakeChatSupabase, type FakeChatSupabase } from "@/test/fake-chat-supabase";

/**
 * ============================================================================
 * DELETION ACROSS DEVICES, OWNERSHIP IN THE SCHEMA, AND CONCURRENT ORDERING
 * ============================================================================
 *
 * The three things the pre-migration review asked to see proved end to end
 * rather than argued: that an intentional delete beats a stale browser, that
 * the database itself refuses a message whose owner differs from its
 * conversation's, and that two devices continuing one thread lose nothing and
 * produce the same order everywhere.
 */

const ORIGINAL = { ...process.env };

const ME = "11111111-1111-4111-8111-111111111111";
const THEM = "22222222-2222-4222-8222-222222222222";

async function load(subject: string, db: FakeChatSupabase) {
  vi.resetModules();

  vi.doMock("@/lib/auth/server", () => ({
    authorizeRequest: async (_request: Request, permission: string) => ({
      identity: {
        subject,
        email: "maddie@example.com",
        displayName: "Maddie",
        role: "salon_director",
        scope: { level: "salon", primaryAreaId: "loc-0101", alsoCoversAreaIds: [] },
        verified: true,
      },
      permission,
      provider: "supabase",
    }),
  }));
  vi.doMock("@/lib/supabase/server", () => ({ getSupabaseAdmin: () => db.client }));

  return {
    list: await import("./route"),
    one: await import("./[id]/route"),
    state: await import("./import/route"),
  };
}

function post(url: string, body: Record<string, unknown>): Request {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const LIST = "https://app.test/api/chat/conversations";
const STATE = "https://app.test/api/chat/conversations/import";

function conversation(
  id: string,
  createdAt: string,
  messages: { id: string; role: "user" | "assistant"; content: string; createdAt: string }[],
) {
  return {
    id,
    title: `${id} title`,
    createdAt,
    updatedAt: messages.at(-1)?.createdAt ?? createdAt,
    messages,
  };
}

const X = conversation("conv_mfxdeleted01", "2026-09-01T10:00:00.000Z", [
  {
    id: "msg_mfxdeleted01",
    role: "user",
    content: "a private question about an employee",
    createdAt: "2026-09-01T10:00:00.000Z",
  },
]);

const Y = conversation("conv_mfxkeeper001", "2026-09-02T10:00:00.000Z", [
  {
    id: "msg_mfxkeeper001",
    role: "user",
    content: "what is the attendance policy?",
    createdAt: "2026-09-02T10:00:00.000Z",
  },
]);

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

/* ------------------------------------------- one conversation, deleted ---- */

describe("deleting on one device holds against a stale second device", () => {
  it("tells the second device it was deleted, and refuses to take it back", async () => {
    const db = fakeChatSupabase();

    /* Laptop A: both conversations reach the account. */
    const laptopA = await load(ME, db);
    await laptopA.list.POST(post(LIST, { conversation: X }));
    await laptopA.list.POST(post(LIST, { conversation: Y }));

    /* Laptop A: the person deletes X. */
    const deleted = await laptopA.one.DELETE(new Request(`https://app.test/x/${X.id}`), {
      params: Promise.resolve({ id: X.id }),
    });
    expect(deleted.status).toBe(200);

    /* Laptop B, opening later, asks what the account says. */
    const laptopB = await load(ME, db);

    const state = await (
      await laptopB.state.GET(new Request(STATE))
    ).json();
    expect(state.deleted).toEqual([X.id]);
    expect(state.stored.map((entry: { id: string }) => entry.id)).toEqual([Y.id]);

    /* It is not in the history it reads. */
    const history = await (await laptopB.list.GET(new Request(LIST))).json();
    expect(history.conversations.map((entry: { id: string }) => entry.id)).toEqual([
      Y.id,
    ]);

    /* Its content is gone with it. */
    expect(JSON.stringify(db.tables.chat_messages)).not.toContain("private question");

    /* And the stale copy cannot be pushed back up by a sync or an import. */
    const resync = await laptopB.list.POST(post(LIST, { conversation: X }));
    expect(resync.status).toBe(403);

    const reimport = await laptopB.state.POST(post(STATE, { conversations: [X] }));
    expect(reimport.status).toBe(200);
    expect((await reimport.json()).imported).toEqual([]);

    /* Still one row for X, still a tombstone, still no turns. */
    const rows = db.tables.chat_conversations.filter(
      (row) => row.client_conversation_id === X.id,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].deleted_at).toBeTruthy();
    expect(rows[0].title).toBeNull();
    expect(db.tables.chat_messages).toHaveLength(1);
  });

  it("survives a retry storm from the stale device", async () => {
    const db = fakeChatSupabase();
    const laptopA = await load(ME, db);
    await laptopA.list.POST(post(LIST, { conversation: X }));
    await laptopA.one.DELETE(new Request(`https://app.test/x/${X.id}`), {
      params: Promise.resolve({ id: X.id }),
    });

    const laptopB = await load(ME, db);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await laptopB.list.POST(post(LIST, { conversation: X }));
      expect(response.status).toBe(403);
    }

    expect(
      db.tables.chat_conversations.filter(
        (row) => row.client_conversation_id === X.id,
      ),
    ).toHaveLength(1);
    expect(db.tables.chat_messages).toHaveLength(0);
  });

  it("does not report a tombstone as something still stored", async () => {
    const db = fakeChatSupabase();
    const laptopA = await load(ME, db);
    await laptopA.list.POST(post(LIST, { conversation: X }));
    await laptopA.one.DELETE(new Request(`https://app.test/x/${X.id}`), {
      params: Promise.resolve({ id: X.id }),
    });

    const state = await (await laptopA.state.GET(new Request(STATE))).json();
    expect(state.stored).toEqual([]);
    expect(state.deleted).toEqual([X.id]);
  });
});

/* ----------------------------------------------------- clear history ------ */

describe("Clear History on one device holds against a stale second device", () => {
  it("returns none of the pre-clear conversations and lets new ones through", async () => {
    const db = fakeChatSupabase();

    const laptopA = await load(ME, db);
    await laptopA.list.POST(post(LIST, { conversation: X }));
    await laptopA.list.POST(post(LIST, { conversation: Y }));

    const cleared = await laptopA.list.DELETE(new Request(LIST));
    expect(cleared.status).toBe(200);
    expect(db.tables.chat_conversations).toEqual([]);
    expect(db.tables.chat_messages).toEqual([]);

    const laptopB = await load(ME, db);
    const state = await (await laptopB.state.GET(new Request(STATE))).json();
    expect(state.clearedAt).toBeTruthy();
    expect(state.stored).toEqual([]);

    /*
     * Laptop B holds three pre-clear threads — two the account once had and one
     * it never saw, because it was never imported. The boundary answers for all
     * three, which is what a per-conversation tombstone could not have done.
     */
    const neverImported = conversation("conv_mfxneverimp1", "2026-08-20T09:00:00.000Z", [
      {
        id: "msg_mfxneverimp1",
        role: "user",
        content: "never left this laptop",
        createdAt: "2026-08-20T09:00:00.000Z",
      },
    ]);

    const reimport = await laptopB.state.POST(
      post(STATE, { conversations: [X, Y, neverImported] }),
    );
    expect(reimport.status).toBe(200);
    expect((await reimport.json()).imported).toEqual([]);
    expect(db.tables.chat_conversations).toEqual([]);

    /* A conversation started after the clear is ordinary history. */
    const fresh = conversation("conv_mfxafter0001", new Date(Date.now() + 1000).toISOString(), [
      {
        id: "msg_mfxafter0001",
        role: "user",
        content: "a new question",
        createdAt: new Date(Date.now() + 1000).toISOString(),
      },
    ]);
    const saved = await laptopB.list.POST(post(LIST, { conversation: fresh }));
    expect(saved.status).toBe(200);
    expect(db.tables.chat_conversations).toHaveLength(1);
  });

  it("writes the boundary before removing the rows, so a failure fails safe", async () => {
    /*
     * The other order loses: rows gone, no boundary, and every stale browser
     * offers to import all of it back. A Clear History that resurrects itself
     * is the exact failure this ordering prevents.
     */
    const db = fakeChatSupabase();
    const laptopA = await load(ME, db);
    await laptopA.list.POST(post(LIST, { conversation: X }));

    db.failOn("chat_conversations");
    const response = await laptopA.list.DELETE(new Request(LIST));
    expect(response.status).toBe(503);

    /* The boundary landed; the rows are still there to remove next time. */
    expect(db.tables.chat_history_boundaries).toHaveLength(1);
    expect(db.tables.chat_conversations).toHaveLength(1);

    db.failOn(null);
    const retried = await laptopA.list.DELETE(new Request(LIST));
    expect(retried.status).toBe(200);
    expect(db.tables.chat_conversations).toEqual([]);
    expect(db.tables.chat_history_boundaries).toHaveLength(1);
  });

  it("clears one account without touching another", async () => {
    const db = fakeChatSupabase();
    const mine = await load(ME, db);
    await mine.list.POST(post(LIST, { conversation: X }));

    const theirs = await load(THEM, db);
    await theirs.list.POST(post(LIST, { conversation: Y }));

    const again = await load(ME, db);
    await again.list.DELETE(new Request(LIST));

    expect(db.tables.chat_conversations.map((row) => row.user_id)).toEqual([THEM]);
    expect(db.tables.chat_history_boundaries.map((row) => row.user_id)).toEqual([ME]);
  });
});

/* -------------------------------------------- ownership in the schema ----- */

describe("the database refuses a message whose owner is not its conversation's", () => {
  it("rejects the pairing even when both halves exist", async () => {
    /*
     * BLOCKER 2, at the seam it protects. Every statement the application
     * issues is scoped by the session's own id — but all of it runs under the
     * secret key, which bypasses row level security by design, so a coding bug
     * could otherwise assemble this row and satisfy every single-column key.
     *
     * The composite foreign key checks the message's user_id against the
     * conversation's in the same lookup that checks the conversation exists.
     */
    const db = fakeChatSupabase();
    const mine = await load(ME, db);
    await mine.list.POST(post(LIST, { conversation: X }));

    const conversationRow = db.tables.chat_conversations[0];
    expect(conversationRow.user_id).toBe(ME);

    const { error } = await db.client.from("chat_messages").insert({
      conversation_id: conversationRow.id,
      /* Somebody else's id, on somebody else's conversation. */
      user_id: THEM,
      client_message_id: "msg_mfxcrossown1",
      role: "user",
      content: "written into another person's thread",
      created_at: "2026-09-03T10:00:00.000Z",
      position: 1,
      turn_id: null,
      metadata: {},
    });

    expect(error).not.toBeNull();
    expect((error as { code: string }).code).toBe("23503");
    expect(db.tables.chat_messages).toHaveLength(1);
    expect(db.tables.chat_messages[0].user_id).toBe(ME);
  });

  it("rejects it through an upsert too, which is how the store writes", async () => {
    const db = fakeChatSupabase();
    const mine = await load(ME, db);
    await mine.list.POST(post(LIST, { conversation: X }));

    const { error } = await db.client.from("chat_messages").upsert(
      [
        {
          conversation_id: db.tables.chat_conversations[0].id,
          user_id: THEM,
          client_message_id: "msg_mfxcrossown2",
          role: "user",
          content: "same trick, different verb",
          created_at: "2026-09-03T10:00:00.000Z",
          position: 1,
          turn_id: null,
          metadata: {},
        },
      ],
      { onConflict: "conversation_id,client_message_id" },
    );

    expect(error).not.toBeNull();
    expect((error as { code: string }).code).toBe("23503");
  });

  it("accepts the same message under the right owner", async () => {
    const db = fakeChatSupabase();
    const mine = await load(ME, db);
    await mine.list.POST(post(LIST, { conversation: X }));

    const { error } = await db.client.from("chat_messages").insert({
      conversation_id: db.tables.chat_conversations[0].id,
      user_id: ME,
      client_message_id: "msg_mfxrightown1",
      role: "user",
      content: "mine, in my own thread",
      created_at: "2026-09-03T10:00:00.000Z",
      position: 1,
      turn_id: null,
      metadata: {},
    });

    expect(error).toBeNull();
    expect(db.tables.chat_messages).toHaveLength(2);
  });
});

/* ------------------------------------------------- concurrent ordering ---- */

describe("two devices continuing one conversation", () => {
  const BASE = conversation("conv_mfxconcurr01", "2026-09-01T10:00:00.000Z", [
    {
      id: "msg_mfxconcurr01",
      role: "user",
      content: "q1",
      createdAt: "2026-09-01T10:00:00.000Z",
    },
    {
      id: "msg_mfxconcurr02",
      role: "assistant",
      content: "a1",
      /* The same millisecond as its own question, which is routine. */
      createdAt: "2026-09-01T10:00:00.000Z",
    },
  ]);

  /** What each device sends: the base thread plus its own new turn. */
  function continued(
    messageId: string,
    content: string,
    createdAt: string,
  ): typeof BASE {
    return {
      ...BASE,
      updatedAt: createdAt,
      messages: [...BASE.messages, { id: messageId, role: "user", content, createdAt }],
    };
  }

  async function readThread(db: FakeChatSupabase) {
    const reader = await load(ME, db);
    const response = await reader.one.GET(new Request(`https://app.test/x/${BASE.id}`), {
      params: Promise.resolve({ id: BASE.id }),
    });
    const payload = (await response.json()) as {
      conversation: { messages: { id: string; content: string }[] };
    };
    return payload.conversation.messages;
  }

  it("loses neither message when both land on the same position", async () => {
    const db = fakeChatSupabase();
    const deviceA = await load(ME, db);
    await deviceA.list.POST(post(LIST, { conversation: BASE }));

    /* Both devices append to a two-turn thread, so both compute position 2. */
    await deviceA.list.POST(
      post(LIST, {
        conversation: continued("msg_mfxdevicea01", "from A", "2026-09-02T10:00:00.000Z"),
      }),
    );
    const deviceB = await load(ME, db);
    await deviceB.list.POST(
      post(LIST, {
        conversation: continued("msg_mfxdeviceb01", "from B", "2026-09-02T10:00:01.000Z"),
      }),
    );

    const messages = await readThread(db);
    expect(messages.map((entry) => entry.id)).toEqual([
      "msg_mfxconcurr01",
      "msg_mfxconcurr02",
      "msg_mfxdevicea01",
      "msg_mfxdeviceb01",
    ]);
    /* Four turns, not three: nothing was rejected by a unique constraint. */
    expect(db.tables.chat_messages).toHaveLength(4);
  });

  it("keeps a question and its own answer in order despite a shared millisecond", async () => {
    const db = fakeChatSupabase();
    const device = await load(ME, db);
    await device.list.POST(post(LIST, { conversation: BASE }));

    const messages = await readThread(db);
    /*
     * `position` carries the array index, so the answer cannot sort ahead of
     * the question it answered — which sorting on `created_at` alone would
     * have allowed, arbitrarily, on every tie.
     */
    expect(messages.map((entry) => entry.content)).toEqual(["q1", "a1"]);
  });

  it("is deterministic even when the two new turns share a millisecond", async () => {
    const db = fakeChatSupabase();
    const deviceA = await load(ME, db);
    await deviceA.list.POST(post(LIST, { conversation: BASE }));

    const sameInstant = "2026-09-02T10:00:00.000Z";
    await deviceA.list.POST(
      post(LIST, { conversation: continued("msg_mfxtieb00001", "B", sameInstant) }),
    );
    const deviceB = await load(ME, db);
    await deviceB.list.POST(
      post(LIST, { conversation: continued("msg_mfxtiea00001", "A", sameInstant) }),
    );

    /*
     * Position ties, time ties, so the client message id breaks it — and it is
     * unique within the conversation, which makes (position, created_at,
     * client_message_id) a TOTAL order. Two reads of the same rows cannot
     * disagree, and neither can two devices.
     */
    const first = await readThread(db);
    const second = await readThread(db);
    expect(first.map((entry) => entry.id)).toEqual(second.map((entry) => entry.id));
    expect(first.map((entry) => entry.id)).toEqual([
      "msg_mfxconcurr01",
      "msg_mfxconcurr02",
      "msg_mfxtiea00001",
      "msg_mfxtieb00001",
    ]);
  });

  it("settles into a contiguous thread once either device has seen both turns", async () => {
    /*
     * THE SELF-HEALING PROPERTY, and the honest limit of this design. During
     * the concurrent window two turns share a position and sort by time. As
     * soon as one device hydrates the merged thread and saves it, every
     * position is rewritten from that array — so the ambiguity lasts exactly
     * until the next full-thread save, and never longer.
     */
    const db = fakeChatSupabase();
    const deviceA = await load(ME, db);
    await deviceA.list.POST(post(LIST, { conversation: BASE }));
    await deviceA.list.POST(
      post(LIST, {
        conversation: continued("msg_mfxheal00001", "from A", "2026-09-02T10:00:00.000Z"),
      }),
    );
    const deviceB = await load(ME, db);
    await deviceB.list.POST(
      post(LIST, {
        conversation: continued("msg_mfxheal00002", "from B", "2026-09-02T10:00:01.000Z"),
      }),
    );

    const shared = db.tables.chat_messages.filter((row) => row.position === 2);
    expect(shared).toHaveLength(2);

    /* Device A hydrates, sees the merged thread, and saves it back. */
    const merged = await readThread(db);
    const rehydrated = await load(ME, db);
    await rehydrated.list.POST(
      post(LIST, {
        conversation: {
          ...BASE,
          updatedAt: "2026-09-02T10:00:02.000Z",
          messages: merged.map((entry) => ({
            id: entry.id,
            role: "user",
            content: entry.content,
            createdAt: "2026-09-02T10:00:02.000Z",
          })),
        },
      }),
    );

    const positions = db.tables.chat_messages
      .map((row) => row.position as number)
      .sort((a, b) => a - b);
    expect(positions).toEqual([0, 1, 2, 3]);
  });
});
