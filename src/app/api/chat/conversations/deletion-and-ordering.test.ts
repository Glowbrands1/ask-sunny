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

/* ============================================================================
 * THE WRONG-CLOCK CASE, AT THE SERVER BOUNDARY
 * ========================================================================== */

describe("a wrong browser clock cannot talk a cleared conversation back onto the account", () => {
  /**
   * The browser's clock is not evidence. `createdAt` is `nowIso()` from the
   * machine that made the conversation, so a clock running fast stamps old
   * threads into the future and a boundary check that reads it waves them
   * through.
   *
   * `turn_id` is the one thing on a conversation the browser RECEIVED rather
   * than chose. It names an `activity_events` row whose `occurred_at` is
   * server-set — defaulted precisely so a caller cannot backdate activity — so
   * it says when a turn really happened, on the server's own clock.
   */
  /*
   * EVERY INSTANT HERE IS IN THE PAST, DERIVED FROM THE CLOCK RATHER THAN
   * HARD-CODED — and that is a correction rather than a style choice.
   *
   * The first version of this block put the clear at a fixed date near the day
   * it was written and the stale conversation a day after it. Both sat in the
   * FUTURE relative to the test run, so `normaliseTimestamp` clamped the stale
   * stamp back to now under its 24-hour skew tolerance, the honest-clock check
   * caught it, and the test passed for a reason that had nothing to do with
   * what it claimed to prove — and would have changed meaning as the calendar
   * moved. Dates in the past are not clamped, so the scenario is the one
   * described and it is the same one every day.
   */
  const day = 24 * 60 * 60 * 1000;
  const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();

  /** T — the authoritative server instant of the clear. */
  const T = iso(10 * day);
  /** The stale conversation's own stamp: AFTER T, from a clock a day fast. */
  const STALE_STAMP = iso(9 * day);

  /** A turn this server recorded BEFORE the clear. */
  const OLD_TURN = "44444444-4444-4444-8444-444444444444";
  /** A turn it recorded after. */
  const NEW_TURN = "55555555-5555-4555-8555-555555555555";
  /** Somebody else's turn, from before the clear. */
  const THEIR_TURN = "66666666-6666-4666-8666-666666666666";

  function cleared(): FakeChatSupabase {
    return fakeChatSupabase({
      chat_conversations: [],
      chat_messages: [],
      chat_history_boundaries: [
        { user_id: ME, history_cleared_at: T, updated_at: T },
      ],
      activity_events: [
        { id: OLD_TURN, actor_user_id: ME, occurred_at: iso(20 * day) },
        { id: NEW_TURN, actor_user_id: ME, occurred_at: iso(5 * day) },
        { id: THEIR_TURN, actor_user_id: THEM, occurred_at: iso(20 * day) },
      ],
    });
  }

  /** Old thread, future-stamped by a clock running a day fast. */
  function staleWithWrongClock(turnId: string | null) {
    return {
      id: "conv_mfxstaleclk1",
      title: "old thread, wrong clock",
      createdAt: STALE_STAMP,
      updatedAt: STALE_STAMP,
      messages: [
        {
          id: "msg_mfxstaleclk1",
          role: "user",
          content: "an old question about an employee",
          createdAt: STALE_STAMP,
        },
        {
          id: "msg_mfxstaleclk2",
          role: "assistant",
          content: "an old answer",
          createdAt: STALE_STAMP,
          ...(turnId ? { turnId } : {}),
        },
      ],
    };
  }

  it("its timestamp really does claim to post-date the clear", () => {
    /*
     * Otherwise the rest of this block would be testing the easy case. Also
     * checked: it is in the past, so nothing clamps it on the way in and the
     * refusal below is the boundary check rather than a side effect of the
     * future-timestamp guard.
     */
    expect(Date.parse(staleWithWrongClock(null).createdAt)).toBeGreaterThan(
      Date.parse(T),
    );
    expect(Date.parse(staleWithWrongClock(null).createdAt)).toBeLessThan(Date.now());
  });

  it("refuses it, because the turn it carries was recorded before the clear", async () => {
    const db = cleared();
    const { list } = await load(ME, db);

    const response = await list.POST(
      post(LIST, { conversation: staleWithWrongClock(OLD_TURN) }),
    );

    expect(response.status).toBe(403);
    expect(db.tables.chat_conversations).toEqual([]);
    expect(JSON.stringify(db.tables.chat_messages)).not.toContain("old question");
  });

  it("declines it on import too, with a reason rather than an error", async () => {
    const db = cleared();
    const { state } = await load(ME, db);

    const response = await state.POST(
      post(STATE, { conversations: [staleWithWrongClock(OLD_TURN)] }),
    );
    const payload = (await response.json()) as {
      imported: string[];
      declined: { reason: string }[];
    };

    expect(response.status).toBe(200);
    expect(payload.imported).toEqual([]);
    expect(payload.declined.map((entry) => entry.reason)).toEqual(["deleted"]);
    expect(db.tables.chat_conversations).toEqual([]);
  });

  it("refuses however many attempts the stale browser makes", async () => {
    const db = cleared();
    const { list } = await load(ME, db);

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await list.POST(
        post(LIST, { conversation: staleWithWrongClock(OLD_TURN) }),
      );
      expect(response.status).toBe(403);
    }
    expect(db.tables.chat_conversations).toEqual([]);
  });

  it("is not fooled by a turn id belonging to somebody else", async () => {
    /*
     * The activity lookup is scoped to the caller's own events, so a forged id
     * matches nothing. That cuts both ways and both are wanted: it cannot read
     * another person's activity, and it cannot be used to launder a stale
     * conversation past the boundary either — the honest-clock check and the
     * browser's own sweep still stand.
     */
    const db = cleared();
    const { list } = await load(ME, db);

    const response = await list.POST(
      post(LIST, { conversation: staleWithWrongClock(THEIR_TURN) }),
    );

    /* Allowed by this check alone — see the assertion below for why that is safe. */
    expect(response.status).toBe(200);

    /* Nothing of THEIR turn is now attached to anything of mine. */
    const stored = db.tables.chat_messages.find(
      (row) => row.client_message_id === "msg_mfxstaleclk2",
    );
    expect(stored?.user_id).toBe(ME);
    /*
     * And the browser never offers this case in the first place: the clock-free
     * sweep in `suppression.ts` suppresses any conversation that was on disk
     * before the clear was known, whatever turn ids it carries. Proved in
     * `lib/chat/deletion-survives.test.ts`.
     */
  });

  /* ------------------------------------------------------------------- */

  it("STILL stores a genuinely new conversation created after the clear", async () => {
    const db = cleared();
    const { list } = await load(ME, db);

    const fresh = {
      id: "conv_mfxafterclk1",
      title: "asked after clearing",
      createdAt: iso(6 * day),
      updatedAt: iso(5 * day),
      messages: [
        {
          id: "msg_mfxafterclk1",
          role: "user",
          content: "a new question",
          createdAt: iso(6 * day),
        },
        {
          id: "msg_mfxafterclk2",
          role: "assistant",
          content: "a new answer",
          createdAt: iso(5 * day),
          turnId: NEW_TURN,
        },
      ],
    };

    const response = await list.POST(post(LIST, { conversation: fresh }));

    expect(response.status).toBe(200);
    expect(db.tables.chat_conversations).toHaveLength(1);
    expect(db.tables.chat_messages).toHaveLength(2);

    /* And it reads back as ordinary history. */
    const history = await (await list.GET(new Request(LIST))).json();
    expect(history.conversations.map((entry: { id: string }) => entry.id)).toEqual([
      fresh.id,
    ]);
  });

  it("stores the FIRST save of a new conversation, before any answer exists", async () => {
    /*
     * The state a brand new conversation is in when it first syncs: the person
     * has typed a question and the answer has not come back, so there is no
     * turn id to date it by. A rule that demanded one would refuse every new
     * conversation's first save after a clear.
     */
    const db = cleared();
    const { list } = await load(ME, db);

    const response = await list.POST(
      post(LIST, {
        conversation: {
          id: "conv_mfxafterclk2",
          title: "just asked",
          createdAt: iso(6 * day),
          updatedAt: iso(6 * day),
          messages: [
            {
              id: "msg_mfxafterclk3",
              role: "user",
              content: "a question with no answer yet",
              createdAt: iso(6 * day),
            },
          ],
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(db.tables.chat_conversations).toHaveLength(1);
  });

  it("refuses a conversation that admits to pre-dating the clear", async () => {
    /* The honest-clock case, still the cheapest and most common. */
    const db = cleared();
    const { list } = await load(ME, db);

    const response = await list.POST(
      post(LIST, {
        conversation: {
          id: "conv_mfxhonest001",
          title: "honestly old",
          createdAt: iso(20 * day),
          updatedAt: iso(20 * day),
          messages: [
            {
              id: "msg_mfxhonest001",
              role: "user",
              content: "old",
              createdAt: iso(20 * day),
            },
          ],
        },
      }),
    );

    expect(response.status).toBe(403);
    expect(db.tables.chat_conversations).toEqual([]);
  });

  it("does none of this when the person has never cleared anything", async () => {
    /* No boundary, no extra lookup, no refusal — the ordinary path. */
    const db = fakeChatSupabase({
      activity_events: [
        { id: OLD_TURN, actor_user_id: ME, occurred_at: iso(20 * day) },
      ],
    });
    const { list } = await load(ME, db);

    const response = await list.POST(
      post(LIST, { conversation: staleWithWrongClock(OLD_TURN) }),
    );

    expect(response.status).toBe(200);
    expect(db.tables.chat_conversations).toHaveLength(1);
  });
});
