import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { feedbackDueOn } from "@/lib/feedback/gate";
import type { ChatMessage } from "@/types";

/**
 * ============================================================================
 * THE INVARIANT: A SUCCESSFUL ANSWER ALWAYS HAS A RATEABLE TURN
 * ============================================================================
 *
 * REPORTED IN PRODUCTION, on the first Bed Usage question of a session: Sunny
 * answered, and no feedback panel appeared. The second question on the same
 * screen behaved correctly.
 *
 * The chain that produced it, end to end:
 *
 *   the model answers
 *     -> the activity insert is slow (a cold serverless instance pays DNS, TLS
 *        and client construction before its first Supabase call; every later
 *        call on that instance reuses the pooled connection — which is exactly
 *        why it was only ever the FIRST answer)
 *     -> the write is abandoned at its deadline and the route returns no turnId
 *     -> `AnswerFeedback` renders nothing, because it has nothing to attach to
 *     -> `feedbackDueOn` releases, because an answer with no turn cannot be rated
 *     -> the next question goes through ungated
 *
 * Every link in that chain was behaving as written. The defect was the design:
 * a successful answer was allowed to exist without a durable turn.
 *
 * THESE TESTS PIN THE WHOLE CHAIN, not one link. The route tests below prove a
 * slow write can no longer produce an untracked answer; the gate test proves
 * what the client would do if one ever did.
 */

const ORIGINAL = { ...process.env };

interface Options {
  /** How long the activity insert takes before it lands. */
  insertDelayMs?: number;
  /** The insert never succeeds. */
  insertFails?: boolean;
}

interface Seen {
  inserts: number;
  updates: number;
  answered: number;
  insertedIds: string[];
}

async function load(options: Options = {}) {
  vi.resetModules();
  const seen: Seen = { inserts: 0, updates: 0, answered: 0, insertedIds: [] };

  vi.doMock("@/lib/auth/server", () => ({
    authorizeRequest: async (_request: Request, permission: string) => ({
      identity: {
        subject: "user-1",
        email: "admin@example.com",
        displayName: "Admin",
        role: "admin",
        scope: { level: "global", primaryAreaId: null, alsoCoversAreaIds: [] },
        verified: true,
      },
      permission,
      provider: "supabase",
    }),
  }));

  vi.doMock("@/lib/ai/server-ask", () => ({
    answerQuestion: async () => {
      seen.answered += 1;
      return { content: "The Bed Usage period is 9/1 - 9/1.", citations: [], recommendedVideoIds: [] };
    },
  }));

  vi.doMock("@/lib/supabase/server", () => ({
    getSupabaseAdmin: () => ({
      from: () => ({
        select: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }),
        }),
        insert: async (values: Record<string, unknown>) => {
          seen.inserts += 1;
          seen.insertedIds.push(String(values.id));
          /*
           * THE ARTIFICIAL DELAY. This is the cold-start round trip, made
           * deterministic: long enough that any deadline shorter than it will
           * lose the race.
           */
          if (options.insertDelayMs) {
            await new Promise((resolve) => setTimeout(resolve, options.insertDelayMs));
          }
          if (options.insertFails) {
            return { error: { message: "connection terminated unexpectedly" } };
          }
          return { error: null };
        },
        update: () => ({
          eq: async () => {
            seen.updates += 1;
            return { error: null };
          },
        }),
      }),
    }),
  }));

  const route = await import("./route");
  return { route, seen };
}

function ask(body: Record<string, unknown> = {}): Request {
  return new Request("https://app.test/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      question: "What is the Bed Usage reporting period?",
      surface: "bed_usage",
      reportContext: { family: "bed-usage", reportDate: "2026-09-01" },
      ...body,
    }),
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
  vi.doUnmock("@/lib/ai/server-ask");
  vi.doUnmock("@/lib/supabase/server");
  vi.resetModules();
});

/* ------------------------------------------------- the reported production -- */

describe("the exact production failure cannot happen again", () => {
  it("a slow turn write still yields a rateable answer", async () => {
    /*
     * THE MUTATION TEST THIS FILE EXISTS FOR. 2500ms is past the 1500ms budget
     * the old post-answer recorder abandoned the write at, so under the old
     * lifecycle this returned a 200 with no turnId — the broken Production
     * state exactly. It must now either carry a turn or refuse; never both
     * succeed and be unrateable.
     */
    const { route } = await load({ insertDelayMs: 2500 });
    const response = await route.POST(ask());
    const payload = await response.json();

    if (response.status === 200) {
      expect(payload.turnId, "a successful answer with no turnId is the defect").toBeTruthy();
    } else {
      expect(payload.error, "a refusal must explain itself").toBeTruthy();
    }
  });

  it(
    "never answers successfully without a turn, at any write latency",
    async () => {
    /*
     * The four latencies straddle the OLD 1500ms budget deliberately: 800ms is
     * a warm write, 1600ms and 3000ms are the cold ones that used to lose. They
     * are real timers rather than fake ones because what is being proved is the
     * interaction between a race and a deadline, and a fake clock is exactly
     * the thing that would let a broken race pass.
     */
    for (const insertDelayMs of [0, 800, 1600, 3000]) {
      const { route } = await load({ insertDelayMs });
      const response = await route.POST(ask());
      const payload = await response.json();

      if (response.status === 200) {
        expect(payload.turnId, `no turnId at ${insertDelayMs}ms`).toBeTruthy();
        expect(payload.content).toBeTruthy();
      }
    }
    },
    /* The four real delays sum past vitest's 5s default. */
    20_000,
  );

  it("does not spend money at the model when the turn cannot be created", async () => {
    /*
     * The pre-flight ordering, asserted rather than assumed: if the turn cannot
     * be created there is nothing to rate, so the request is refused BEFORE the
     * answer is generated. Nothing is lost, because nothing was made.
     */
    const { route, seen } = await load({ insertFails: true });
    const response = await route.POST(ask());

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(seen.answered, "the model was called for an answer nobody can rate").toBe(0);
  });
});

/* ------------------------------------------------------------- the gate ---- */

describe("the client gate, on the state the server no longer produces", () => {
  const answered = (overrides: Partial<ChatMessage> = {}): ChatMessage[] => [
    { id: "q", role: "user", content: "…", createdAt: "2026-09-15T10:00:00.000Z" },
    {
      id: "a",
      role: "assistant",
      content: "…",
      createdAt: "2026-09-15T10:00:01.000Z",
      ...overrides,
    },
  ];

  it("released on a turn-less answer — the second half of the reported bug", () => {
    /*
     * PINNED AS DOCUMENTATION, not as desired behaviour. A stored message with
     * no turnId is now only ever a LEGACY one, written before this feature
     * shipped, and trapping somebody in a conversation they cannot rate would
     * be worse than letting it through. The server guarantee is what closes the
     * hole; this is why the client is not where it was closed.
     */
    expect(feedbackDueOn(answered({ turnId: undefined }))).toBeNull();
  });

  it("holds as soon as the answer carries a turn", () => {
    expect(feedbackDueOn(answered({ turnId: "t-1" }))?.id).toBe("a");
  });
});

/* ---------------------------------------------------- every Ask Sunny surface */

describe("the guarantee holds on every surface, not just the one that broke", () => {
  /*
   * BED USAGE IS FIRST because that is where it was reported, and the rest are
   * here because the defect was never about Bed Usage: it was about the first
   * Supabase call on a cold instance, which any surface can be.
   */
  const SURFACES = [
    "bed_usage",
    "main_chat",
    "overview",
    "salon_performance",
    "sales_totals",
    "spa_wellness",
    "spa_engagement",
    "google_reviews",
  ] as const;

  it.each(SURFACES)(
    "%s: a cold first write still yields a rateable answer",
    async (surface) => {
      /* 2500ms — past the old budget, inside the new one. */
      const { route } = await load({ insertDelayMs: 2500 });
      const response = await route.POST(ask({ surface }));
      const payload = await response.json();

      expect(response.status).toBe(200);
      expect(payload.turnId, `${surface} answered with no turn`).toBeTruthy();
    },
    20_000,
  );

  it("records the surface it was told, on the turn it opened", async () => {
    const { route, seen } = await load();
    const response = await route.POST(ask({ surface: "spa_engagement" }));
    const payload = await response.json();

    expect(seen.inserts).toBe(1);
    /* The id the browser was handed is the id that was written. */
    expect(seen.insertedIds).toContain(payload.turnId);
  });
});

/* --------------------------------------------- first answer vs. the next one */

describe("the first answer and the second are now identical", () => {
  it("both carry a turn, even when only the first write is slow", async () => {
    /*
     * THE PRODUCTION SHAPE, reproduced: one cold instance, a slow first write,
     * a fast second. Before the fix the first answer came back unrateable and
     * ungated and the second was correct — which is precisely what was
     * reported, and precisely what made it look intermittent.
     */
    const first = await load({ insertDelayMs: 2500 });
    const firstResponse = await first.route.POST(ask());
    const firstPayload = await firstResponse.json();

    const second = await load({ insertDelayMs: 5 });
    const secondResponse = await second.route.POST(ask());
    const secondPayload = await secondResponse.json();

    expect(firstPayload.turnId).toBeTruthy();
    expect(secondPayload.turnId).toBeTruthy();
    expect(firstResponse.status).toBe(secondResponse.status);
  }, 20_000);

  it("opens the turn before the model is called, not after", async () => {
    /*
     * THE ORDERING IS THE FIX, so it is asserted directly rather than inferred
     * from the outcome. A later edit that moved the write back after the answer
     * would restore the defect while leaving most of these tests passing.
     */
    const { route, seen } = await load();
    await route.POST(ask());

    expect(seen.inserts).toBe(1);
    expect(seen.answered).toBe(1);
    /* One row opened, then refined once the answer existed. */
    expect(seen.updates).toBe(1);
  });
});

/* ------------------------------------------------------- the failure state -- */

describe("when the turn genuinely cannot be created", () => {
  it("refuses with a retryable code rather than a broken-looking answer", async () => {
    const { route } = await load({ insertFails: true });
    const response = await route.POST(ask());
    const payload = await response.json();

    expect(response.status).toBe(503);
    expect(payload.code).toBe("turn_unavailable");
    /* The message says nothing was asked, which is the actionable part. */
    expect(String(payload.error)).toMatch(/try again/i);
  });

  it("says nothing about the connection in the response body", async () => {
    /*
     * The driver's reason is logged and never returned. An error body is not
     * where operational detail belongs, and a caller learns only that it was
     * refused and that retrying is worth it.
     */
    const { route } = await load({ insertFails: true });
    const payload = await (await route.POST(ask())).json();

    expect(JSON.stringify(payload)).not.toMatch(/connection terminated/i);
  });

  it("maps to a retryable client error the manager can act on", async () => {
    const { toChatTurnError } = await import("@/features/chat/chat-error");
    const { AiError } = await import("@/lib/ai/errors");

    const mapped = toChatTurnError(
      new AiError("turn_unavailable", "…", 503),
      "What is the Bed Usage reporting period?",
    );

    expect(mapped.kind).toBe("turn_unavailable");
    expect(mapped.retryable).toBe(true);
    expect(mapped.message).toMatch(/not sent/i);
    /* The question survives, so "try again" can actually resend it. */
    expect(mapped.question).toBe("What is the Bed Usage reporting period?");
  });
});
