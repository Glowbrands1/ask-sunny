import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEMO_CONVERSATIONS } from "@/data/demo";
import { fakeChatSupabase } from "@/test/fake-chat-supabase";

/**
 * ============================================================================
 * THE ONE-TIME IMPORT: IDEMPOTENT, RESUMABLE, AND BLIND TO THE DEMO SEEDS
 * ============================================================================
 *
 * The failure modes this endpoint has to survive are ordinary rather than
 * exotic: somebody double-clicks Import, refreshes mid-run, loses their
 * connection on a train, or presses it again next week wondering whether it
 * worked. After any of those there must be ONE conversation holding ONE copy of
 * each turn, in the order it was said.
 *
 * And the six fabricated threads in every production browser must never be
 * among them.
 */

const ORIGINAL = { ...process.env };

const ME = "11111111-1111-4111-8111-111111111111";
const THEM = "22222222-2222-4222-8222-222222222222";

async function load(subject: string | null, db = fakeChatSupabase()) {
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
          email: "maddie@example.com",
          displayName: "Maddie",
          role: "salon_director",
          scope: { level: "salon", primaryAreaId: "loc-0101", alsoCoversAreaIds: [] },
          verified: true,
        },
        permission,
        provider: "supabase",
      };
    },
  }));

  vi.doMock("@/lib/supabase/server", () => ({ getSupabaseAdmin: () => db.client }));

  return { route: await import("./route"), db };
}

function post(body: Record<string, unknown>): Request {
  return new Request("https://app.test/api/chat/conversations/import", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** A real browser-local conversation, of the shape IndexedDB actually holds. */
const REAL = {
  id: "conv_mfx1a2b3c4d5e",
  title: "Saturday coverage",
  createdAt: "2026-08-01T09:00:00.000Z",
  updatedAt: "2026-08-01T09:30:00.000Z",
  attachedDocumentIds: [],
  messages: [
    {
      id: "msg_mfx1a2b3c4d51",
      role: "user",
      content: "Who covers Saturday?",
      createdAt: "2026-08-01T09:00:00.000Z",
    },
    {
      id: "msg_mfx1a2b3c4d52",
      role: "assistant",
      content: "Two Salon Directors are scheduled.",
      /* Deliberately the same millisecond — see the ordering test. */
      createdAt: "2026-08-01T09:00:00.000Z",
      mode: "standard",
      coverage: "grounded",
      turnId: "33333333-3333-4333-8333-333333333333",
      citations: [{ documentId: "kb_1", title: "Scheduling", page: 2 }],
      feedback: { id: "fb_1", turnId: "t", rating: 5, comment: "" },
    },
    {
      id: "msg_mfx1a2b3c4d53",
      role: "user",
      content: "Thanks",
      createdAt: "2026-08-01T09:30:00.000Z",
    },
  ],
};

const SECOND = {
  ...REAL,
  id: "conv_mfx9z8y7x6w5v",
  title: "Bed usage question",
  messages: [
    {
      id: "msg_mfx9z8y7x6w51",
      role: "user",
      content: "Why is bed usage down?",
      createdAt: "2026-08-02T09:00:00.000Z",
    },
  ],
};

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

/* ------------------------------------------------------------- the seeds -- */

describe("the six seeded demo conversations never enter Supabase", () => {
  it("declines all of them and stores nothing", async () => {
    const { route, db } = await load(ME);
    const response = await route.POST(post({ conversations: [...DEMO_CONVERSATIONS] }));

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      imported: string[];
      declined: { id: string | null; reason: string }[];
    };

    expect(payload.imported).toEqual([]);
    expect(payload.declined).toHaveLength(6);
    for (const entry of payload.declined) expect(entry.reason).toBe("demo_seed");

    expect(db.tables.chat_conversations).toHaveLength(0);
    expect(db.tables.chat_messages).toHaveLength(0);
  });

  it("stores the real one and declines the seeds in the same batch", async () => {
    const { route, db } = await load(ME);
    const response = await route.POST(
      post({ conversations: [DEMO_CONVERSATIONS[0], REAL, DEMO_CONVERSATIONS[1]] }),
    );

    const payload = (await response.json()) as {
      imported: string[];
      declined: { reason: string }[];
    };

    expect(payload.imported).toEqual([REAL.id]);
    expect(payload.declined.map((entry) => entry.reason)).toEqual([
      "demo_seed",
      "demo_seed",
    ]);
    expect(db.tables.chat_conversations).toHaveLength(1);
  });

  it("never stores a seeded MESSAGE id, even smuggled into a real thread", async () => {
    const { route, db } = await load(ME);
    const response = await route.POST(
      post({
        conversations: [
          { ...REAL, messages: [...REAL.messages, DEMO_CONVERSATIONS[0].messages[0]] },
        ],
      }),
    );

    const payload = (await response.json()) as { declined: { reason: string }[] };
    expect(payload.declined[0]?.reason).toBe("malformed_message_id");
    expect(db.tables.chat_messages).toHaveLength(0);

    const stored = JSON.stringify(db.tables.chat_messages);
    expect(stored).not.toContain("msg-s");
  });
});

/* ------------------------------------------------------------- fidelity -- */

describe("what is imported is what was there", () => {
  it("stores it under the AUTHENTICATED user, not anyone named in the payload", async () => {
    const { route, db } = await load(ME);
    await route.POST(
      post({
        conversations: [{ ...REAL, user_id: THEM, userId: THEM, email: "them@x.test" }],
      }),
    );

    expect(db.tables.chat_conversations[0].user_id).toBe(ME);
    for (const message of db.tables.chat_messages) expect(message.user_id).toBe(ME);
  });

  it("preserves the title and both timestamps", async () => {
    const { route, db } = await load(ME);
    await route.POST(post({ conversations: [REAL] }));

    const row = db.tables.chat_conversations[0];
    expect(row.title).toBe("Saturday coverage");
    expect(row.created_at).toBe("2026-08-01T09:00:00.000Z");
    expect(row.updated_at).toBe("2026-08-01T09:30:00.000Z");
  });

  it("marks it as imported rather than as a conversation the service recorded", async () => {
    const { route, db } = await load(ME);
    await route.POST(post({ conversations: [REAL] }));
    expect(db.tables.chat_conversations[0].imported_at).toBeTruthy();
  });

  it("preserves order with an explicit position, not by timestamp", async () => {
    const { route, db } = await load(ME);
    await route.POST(post({ conversations: [REAL] }));

    const ordered = [...db.tables.chat_messages].sort(
      (a, b) => (a.position as number) - (b.position as number),
    );
    expect(ordered.map((row) => row.client_message_id)).toEqual([
      "msg_mfx1a2b3c4d51",
      "msg_mfx1a2b3c4d52",
      "msg_mfx1a2b3c4d53",
    ]);
    expect(ordered.map((row) => row.position)).toEqual([0, 1, 2]);

    /* The first two share a millisecond, so time alone could not have done it. */
    expect(ordered[0].created_at).toBe(ordered[1].created_at);
  });

  it("preserves each turn's own timestamp, role and content", async () => {
    const { route, db } = await load(ME);
    await route.POST(post({ conversations: [REAL] }));

    const first = db.tables.chat_messages.find(
      (row) => row.client_message_id === "msg_mfx1a2b3c4d51",
    );
    expect(first?.role).toBe("user");
    expect(first?.content).toBe("Who covers Saturday?");
    expect(first?.created_at).toBe("2026-08-01T09:00:00.000Z");
  });

  it("preserves the server turn id and the safe metadata", async () => {
    const { route, db } = await load(ME);
    await route.POST(post({ conversations: [REAL] }));

    const answer = db.tables.chat_messages.find(
      (row) => row.client_message_id === "msg_mfx1a2b3c4d52",
    );
    expect(answer?.turn_id).toBe("33333333-3333-4333-8333-333333333333");

    const metadata = answer?.metadata as Record<string, unknown>;
    expect(metadata.mode).toBe("standard");
    expect(metadata.coverage).toBe("grounded");
    expect(metadata.citations).toHaveLength(1);
    expect(metadata.feedback).toBeDefined();
  });
});

/* ---------------------------------------------------------- idempotency -- */

describe("importing twice is importing once", () => {
  it("creates no duplicate conversation or message on a rerun", async () => {
    const { route, db } = await load(ME);

    await route.POST(post({ conversations: [REAL, SECOND] }));
    await route.POST(post({ conversations: [REAL, SECOND] }));
    await route.POST(post({ conversations: [REAL, SECOND] }));

    expect(db.tables.chat_conversations).toHaveLength(2);
    expect(db.tables.chat_messages).toHaveLength(4);
  });

  it("survives two requests racing on the same new conversation", async () => {
    /*
     * A double-click sends two requests that both find no existing row and both
     * insert. The second hits the unique constraint, and the store re-reads the
     * row the first one created rather than failing — which is what makes a
     * double-click produce one conversation instead of an error.
     */
    const { route, db } = await load(ME);

    const [first, second] = await Promise.all([
      route.POST(post({ conversations: [REAL] })),
      route.POST(post({ conversations: [REAL] })),
    ]);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(db.tables.chat_conversations).toHaveLength(1);
    expect(db.tables.chat_messages).toHaveLength(3);
  });

  it("resumes after an interruption without duplicating what landed", async () => {
    const db = fakeChatSupabase();
    const { route } = await load(ME, db);

    /* First run: the first conversation lands, then the database goes away. */
    await route.POST(post({ conversations: [REAL] }));
    expect(db.tables.chat_conversations).toHaveLength(1);

    db.failOn("chat_conversations");
    const interrupted = await route.POST(post({ conversations: [SECOND] }));
    expect(interrupted.status).toBe(503);
    expect(db.tables.chat_conversations).toHaveLength(1);

    /* Second run: everything again, which is exactly what pressing Import does. */
    db.failOn(null);
    const resumed = await route.POST(post({ conversations: [REAL, SECOND] }));
    expect(resumed.status).toBe(200);

    expect(db.tables.chat_conversations).toHaveLength(2);
    expect(db.tables.chat_messages).toHaveLength(4);
  });

  it("does not duplicate a conversation that arrived through ordinary chat first", async () => {
    const { route, db } = await load(ME);
    const list = await import("../route");

    await list.POST(
      new Request("https://app.test/api/chat/conversations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ conversation: REAL }),
      }),
    );
    await route.POST(post({ conversations: [REAL] }));

    expect(db.tables.chat_conversations).toHaveLength(1);
    expect(db.tables.chat_messages).toHaveLength(3);
  });
});

/* ----------------------------------------------------------- the bounds -- */

describe("the endpoint bounds and refuses what it should", () => {
  it("accepts an empty list without writing anything", async () => {
    const { route, db } = await load(ME);
    const response = await route.POST(post({ conversations: [] }));

    expect(response.status).toBe(200);
    expect(db.tables.chat_conversations).toHaveLength(0);
  });

  it("refuses a body that is not a list", async () => {
    const { route } = await load(ME);
    expect((await route.POST(post({ conversations: "all" }))).status).toBe(400);
  });

  it("refuses more than one batch at a time", async () => {
    const { route, db } = await load(ME);
    const many = Array.from({ length: 11 }, (_unused, index) => ({
      ...REAL,
      id: `conv_mfx1a2b3c4d${index.toString(36)}z`,
    }));

    expect((await route.POST(post({ conversations: many }))).status).toBe(400);
    expect(db.tables.chat_conversations).toHaveLength(0);
  });

  it("refuses an unauthenticated import and writes nothing", async () => {
    const { route, db } = await load(null);
    const response = await route.POST(post({ conversations: [REAL] }));

    expect(response.status).toBe(401);
    expect(db.tables.chat_conversations).toHaveLength(0);
  });
});

/* ------------------------------------------------------------ the diff --- */

describe("the already-stored check carries ids and nothing else", () => {
  it("returns only the caller's own ids", async () => {
    const db = fakeChatSupabase({
      chat_conversations: [
        { id: "a", user_id: ME, client_conversation_id: REAL.id, title: "Mine" },
        { id: "b", user_id: THEM, client_conversation_id: SECOND.id, title: "Theirs" },
      ],
      chat_messages: [],
    });
    const { route } = await load(ME, db);

    const response = await route.GET(
      new Request("https://app.test/api/chat/conversations/import"),
    );
    const payload = (await response.json()) as { stored: string[] };

    expect(payload.stored).toEqual([REAL.id]);
    expect(await new Response(JSON.stringify(payload)).text()).not.toContain("Theirs");
  });

  it("refuses an unauthenticated caller", async () => {
    const { route } = await load(null);
    const response = await route.GET(
      new Request("https://app.test/api/chat/conversations/import"),
    );
    expect(response.status).toBe(401);
  });
});
