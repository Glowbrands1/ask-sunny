import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * ============================================================================
 * POST/GET /api/chat/feedback — WHO MAY RATE WHAT
 * ============================================================================
 *
 * Two rules, and only one of them is the permission.
 *
 *   `ask_questions` says this person may rate SOMETHING. It is the right gate:
 *   anything narrower would create a class of user who can use Ask Sunny and
 *   cannot say it was wrong, and the frontline Employee holding it is the
 *   population whose complaints this feature exists to collect.
 *
 *   `assertOwnTurn` says WHICH thing: the turn named must be one this person is
 *   the recorded actor of. That is the check that matters, and it cannot be a
 *   row-level policy — every read and write here runs under the secret key,
 *   which holds `service_role` and bypasses RLS by design. A policy would bind
 *   nobody while looking exactly like the thing doing the work.
 */

const ORIGINAL = { ...process.env };

/** One caller's identity, and the rows the fake database holds. */
interface Fixture {
  subject: string;
  /** `activity_events` rows, by id. */
  events: Record<string, { actor_user_id: string | null }>;
}

interface Seen {
  upserts: { values: Record<string, unknown>; options: unknown }[];
  selects: { table: string; filters: Record<string, unknown> }[];
}

async function load(fixture: Fixture) {
  vi.resetModules();
  const seen: Seen = { upserts: [], selects: [] };

  vi.doMock("@/lib/auth/server", () => ({
    authorizeRequest: async (_request: Request, permission: string) => ({
      identity: {
        subject: fixture.subject,
        email: "sd@example.com",
        displayName: "SD",
        role: "salon_director",
        scope: { level: "salon", primaryAreaId: "loc-0101", alsoCoversAreaIds: [] },
        verified: true,
      },
      permission,
      provider: "supabase",
    }),
  }));

  /*
   * A FAKE SUPABASE, not a mocked store module. The store is where the
   * ownership check lives, so mocking it out would leave the single most
   * important rule in this file untested.
   */
  vi.doMock("@/lib/supabase/server", () => ({
    getSupabaseAdmin: () => ({
      from(table: string) {
        const filters: Record<string, unknown> = {};
        const builder = {
          select: () => builder,
          eq: (column: string, value: unknown) => {
            filters[column] = value;
            return builder;
          },
          in: (column: string, value: unknown) => {
            filters[column] = value;
            return builder;
          },
          maybeSingle: async () => {
            seen.selects.push({ table, filters });
            const id = filters.id as string;
            return { data: fixture.events[id] ?? null, error: null };
          },
          single: async () => ({ data: null, error: null }),
          upsert: (values: Record<string, unknown>, options: unknown) => {
            seen.upserts.push({ values, options });
            return {
              select: () => ({
                single: async () => ({
                  data: {
                    id: "fb-1",
                    activity_event_id: values.activity_event_id,
                    rating: values.rating,
                    got_what_needed: values.got_what_needed,
                    comment: values.comment,
                    updated_at: "2026-09-15T10:00:00.000Z",
                  },
                  error: null,
                }),
              }),
            };
          },
          then: undefined,
        };
        /* The GET path awaits the builder itself for a list. */
        return Object.assign(builder, {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          then: (resolve: any) => {
            seen.selects.push({ table, filters });
            return Promise.resolve({ data: [], error: null }).then(resolve);
          },
        });
      },
    }),
  }));

  const route = await import("./route");
  return { route, seen };
}

function post(body: Record<string, unknown>): Request {
  return new Request("https://app.test/api/chat/feedback", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const MY_TURN = "11111111-1111-4111-8111-111111111111";
const THEIR_TURN = "22222222-2222-4222-8222-222222222222";
const MACHINE_TURN = "33333333-3333-4333-8333-333333333333";

const FIXTURE: Fixture = {
  subject: "user-1",
  events: {
    [MY_TURN]: { actor_user_id: "user-1" },
    [THEIR_TURN]: { actor_user_id: "user-2" },
    [MACHINE_TURN]: { actor_user_id: null },
  },
};

const GOOD = {
  turnId: MY_TURN,
  rating: 4,
  gotWhatNeeded: "partially",
  comment: "Close, but it missed the attendance policy.",
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

/* ----------------------------------------------------------- ownership --- */

describe("a person may only rate their own answers", () => {
  it("saves feedback on a turn they are the actor of", async () => {
    const { route, seen } = await load(FIXTURE);
    const response = await route.POST(post(GOOD));

    expect(response.status).toBe(200);
    expect(seen.upserts).toHaveLength(1);
    expect(seen.upserts[0].values.activity_event_id).toBe(MY_TURN);
  });

  it("refuses a turn belonging to somebody else, and writes nothing", async () => {
    const { route, seen } = await load(FIXTURE);
    const response = await route.POST(post({ ...GOOD, turnId: THEIR_TURN }));

    expect(response.status).toBe(403);
    expect(seen.upserts).toHaveLength(0);
  });

  it("refuses a turn that does not exist with the SAME message", async () => {
    /*
     * NO ORACLE. Distinguishing "that turn does not exist" from "that turn is
     * not yours" would let a caller enumerate which event ids are real.
     */
    const { route } = await load(FIXTURE);
    const missing = await route.POST(
      post({ ...GOOD, turnId: "44444444-4444-4444-8444-444444444444" }),
    );
    const theirs = await route.POST(post({ ...GOOD, turnId: THEIR_TURN }));

    expect(missing.status).toBe(403);
    expect(theirs.status).toBe(403);
    expect(await missing.json()).toEqual(await theirs.json());
  });

  it("refuses a machine-driven turn that belongs to nobody", async () => {
    /* An emailed workbook has no person behind it, so nobody may rate it. */
    const { route, seen } = await load(FIXTURE);
    const response = await route.POST(post({ ...GOOD, turnId: MACHINE_TURN }));

    expect(response.status).toBe(403);
    expect(seen.upserts).toHaveLength(0);
  });

  it("takes the user from the session and ignores one in the body", async () => {
    /*
     * There is no field on this route a caller could put an identity in, and
     * this is what proves it: a body asserting somebody else's id is stored
     * against the session's subject.
     */
    const { route, seen } = await load(FIXTURE);
    await route.POST(post({ ...GOOD, userId: "user-2", user_id: "user-2" }));

    expect(seen.upserts[0].values.user_id).toBe("user-1");
  });
});

/* ---------------------------------------------------------- validation --- */

describe("the stars are required at the route as well as in the form", () => {
  it.each([
    [{ rating: undefined }, "star rating"],
    [{ rating: 0 }, "star rating"],
    [{ rating: 6 }, "star rating"],
    [{ rating: "4" }, "star rating"],
    /*
     * A VALUE THAT IS PRESENT IS STILL VALIDATED. The outcome became optional;
     * it did not become free text. "maybe" is not one of the three and never
     * reaches the enum column.
     */
    [{ gotWhatNeeded: "maybe" }, "got what you needed"],
  ])("refuses %o", async (override, fragment) => {
    const { route, seen } = await load(FIXTURE);
    const response = await route.POST(post({ ...GOOD, ...override }));

    expect(response.status).toBe(400);
    expect(String((await response.json()).error)).toContain(fragment);
    expect(seen.upserts).toHaveLength(0);
  });

  /*
   * ==========================================================================
   * A RATING WITH NO WORDS IS A COMPLETE SUBMISSION
   * ==========================================================================
   *
   * Both of these used to be 400s, on the reasoning that a 1-star with no words
   * is a dead end. That was the right trade while every answer demanded a
   * rating and the next question was held until one arrived. Rating is now a
   * passive control nobody has to open, and a voluntary form that refuses what
   * somebody wanted to say collects nothing at all.
   *
   * ABSENT IS STORED AS NULL, NOT AS A GUESS. An empty string or a defaulted
   * 'yes' would put an opinion nobody expressed into the same averages the
   * dashboard reports as what leaders said.
   */
  it.each([
    ["no outcome", { gotWhatNeeded: undefined }],
    ["an explicitly null outcome", { gotWhatNeeded: null }],
    ["no comment", { comment: undefined }],
    ["a blank comment", { comment: "   " }],
    ["neither", { gotWhatNeeded: undefined, comment: undefined }],
  ])("accepts a rating with %s", async (_label, override) => {
    const { route, seen } = await load(FIXTURE);
    const response = await route.POST(post({ ...GOOD, ...override }));

    expect(response.status).toBe(200);
    expect(seen.upserts).toHaveLength(1);
    expect(seen.upserts[0].values.rating).toBe(GOOD.rating);
  });

  it("stores an unanswered outcome and an unwritten comment as null", async () => {
    const { route, seen } = await load(FIXTURE);
    await route.POST(
      post({ ...GOOD, gotWhatNeeded: undefined, comment: "   " }),
    );

    expect(seen.upserts[0].values.got_what_needed).toBeNull();
    expect(seen.upserts[0].values.comment).toBeNull();
  });

  it("refuses a comment longer than the column allows", async () => {
    const { route, seen } = await load(FIXTURE);
    const response = await route.POST(post({ ...GOOD, comment: "x".repeat(2001) }));

    expect(response.status).toBe(400);
    expect(seen.upserts).toHaveLength(0);
  });

  it("trims the comment before storing it", async () => {
    const { route, seen } = await load(FIXTURE);
    await route.POST(post({ ...GOOD, comment: "  wrong policy  " }));

    expect(seen.upserts[0].values.comment).toBe("wrong policy");
  });
});

/* -------------------------------------------------------------- upsert --- */

describe("a second rating replaces the first rather than adding one", () => {
  it("upserts on the one-per-person-per-answer key", async () => {
    /*
     * Without this a double-click is two rows and the average moves twice for a
     * single opinion — and "19 responses" stops meaning nineteen people.
     */
    const { route, seen } = await load(FIXTURE);
    await route.POST(post(GOOD));
    await route.POST(post({ ...GOOD, rating: 5, comment: "Fixed now." }));

    expect(seen.upserts).toHaveLength(2);
    for (const call of seen.upserts) {
      expect(call.options).toEqual({ onConflict: "activity_event_id,user_id" });
    }
  });

  it("never sends a moderation field from the browser", async () => {
    /*
     * Moderation is an administrator's verb on its own route. A body arriving
     * here with `status: "resolved"` changes nothing because nothing reads it.
     */
    const { route, seen } = await load(FIXTURE);
    await route.POST(
      post({ ...GOOD, status: "resolved", hidden: true, resolutionNote: "n" }),
    );

    const values = seen.upserts[0].values;
    expect(values.status).toBeUndefined();
    expect(values.hidden_at).toBeUndefined();
    expect(values.resolution_note).toBeUndefined();
  });

  it("stores the browser's own ids as opaque correlation text", async () => {
    const { route, seen } = await load(FIXTURE);
    await route.POST(post({ ...GOOD, conversationId: "conv_1", messageId: "msg_1" }));

    expect(seen.upserts[0].values.client_conversation_id).toBe("conv_1");
    expect(seen.upserts[0].values.client_message_id).toBe("msg_1");
  });

  it("drops a browser id that is absurdly long rather than storing it", async () => {
    const { route, seen } = await load(FIXTURE);
    await route.POST(post({ ...GOOD, conversationId: "c".repeat(200) }));

    expect(seen.upserts[0].values.client_conversation_id).toBeNull();
  });
});

/* ----------------------------------------------------------------- GET --- */

describe("reading your own feedback", () => {
  it("scopes the query to the session's user inside the statement", async () => {
    /*
     * Passing the subject rather than filtering afterwards is what makes "you
     * cannot read somebody else's feedback" a property of the query instead of
     * a step somebody can forget.
     */
    const { route, seen } = await load(FIXTURE);
    const response = await route.GET(
      new Request(`https://app.test/api/chat/feedback?turn=${MY_TURN}`),
    );

    expect(response.status).toBe(200);
    const read = seen.selects.find((entry) => entry.table === "ask_sunny_feedback");
    expect(read?.filters.user_id).toBe("user-1");
  });
});

/* --------------------------------------------------------- the contract -- */

describe("the route's own shape", () => {
  const source = readFileSync(
    join(process.cwd(), "src/app/api/chat/feedback/route.ts"),
    "utf8",
  );

  it("authorizes before it reaches the store", () => {
    /* A guard placed after the work has not guarded it. */
    const body = source.split("export async function POST")[1] ?? "";
    expect(body.indexOf("authorizeRequest")).toBeLessThan(body.indexOf("saveFeedback"));
  });

  it("gates on ask_questions", () => {
    expect(source).toContain('authorizeRequest(request, "ask_questions")');
  });

  it("offers no way to moderate from here", () => {
    expect(source).not.toContain("moderateFeedback");
    expect(source).not.toMatch(/export async function (DELETE|PATCH|PUT)/);
  });
});
