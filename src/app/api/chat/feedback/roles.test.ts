import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_PERMISSION_MATRIX, ROLES, hasPermission } from "@/lib/permissions";
import type { Role } from "@/types";

/**
 * ============================================================================
 * EVERY ROLE THAT CAN ASK SUNNY CAN RATE SUNNY — AND ONLY ITS OWN ANSWERS
 * ============================================================================
 *
 * `route.test.ts` proves the ownership rule with `authorizeRequest` mocked to
 * say yes. That leaves the question the rollout actually asked unanswered:
 * does an Admin, a Regional Manager, a District Manager, a Salon Director and
 * a frontline Employee each get through the REAL gate?
 *
 * So here `authorizeRequest` and the permission matrix are the real ones, and
 * only the two things outside this process are faked: the identity provider
 * (which says who is calling and in what role, verified, as Supabase Auth does
 * in production) and the database (so the ownership check in the store runs
 * against rows it can see).
 *
 * The gate is `ask_questions` and stays `ask_questions`. Feedback is not an
 * administrator's feature: a person who can ask Sunny a question can say how
 * the answer was, and an administrator gets nothing extra — not even the
 * ability to rate somebody else's turn.
 */

const ORIGINAL = { ...process.env };

/** The roles the rollout named, which must never lose the ability to rate. */
const NAMED_ROLES: Role[] = [
  "admin",
  "regional_manager",
  "district_manager",
  "salon_director",
  "employee",
];

/** Every role the permission matrix lets ask Sunny a question. */
const ASKING_ROLES = ROLES.filter((role) =>
  hasPermission(DEFAULT_PERMISSION_MATRIX, role, "ask_questions"),
);

const CALLER = "aaaaaaaa-0000-4000-8000-000000000001";
const SOMEONE_ELSE = "aaaaaaaa-0000-4000-8000-000000000002";
const MY_TURN = "11111111-1111-4111-8111-111111111111";
const THEIR_TURN = "22222222-2222-4222-8222-222222222222";

interface Seen {
  upserts: { values: Record<string, unknown>; options: unknown }[];
}

async function load(role: Role) {
  vi.resetModules();
  const seen: Seen = { upserts: [] };

  /*
   * THE PROVIDER, NOT THE GATE. A production-grade provider returning a
   * verified identity is exactly what `SupabaseAuthProvider` hands
   * `authorizeRequest` for a signed-in person; everything after that — the
   * verified check and the matrix lookup — is the real code.
   */
  vi.doMock("@/lib/auth/index", async () => {
    const actual = await vi.importActual<typeof import("@/lib/auth/index")>(
      "@/lib/auth/index",
    );
    return {
      ...actual,
      getAuthProvider: () => ({
        kind: "supabase",
        name: "fake supabase",
        isProductionGrade: true,
        missingConfiguration: [],
        identify: async () => ({
          subject: CALLER,
          email: `${role}@example.com`,
          displayName: role,
          role,
          scope:
            role === "admin"
              ? { level: "global", primaryAreaId: null, alsoCoversAreaIds: [] }
              : { level: "salon", primaryAreaId: "loc-0306", alsoCoversAreaIds: [] },
          verified: true,
        }),
      }),
    };
  });

  vi.doMock("@/lib/supabase/server", () => ({
    getSupabaseAdmin: () => ({
      from() {
        const filters: Record<string, unknown> = {};
        const builder = {
          select: () => builder,
          eq: (column: string, value: unknown) => {
            filters[column] = value;
            return builder;
          },
          maybeSingle: async () => {
            const events: Record<string, { actor_user_id: string }> = {
              [MY_TURN]: { actor_user_id: CALLER },
              [THEIR_TURN]: { actor_user_id: SOMEONE_ELSE },
            };
            return { data: events[filters.id as string] ?? null, error: null };
          },
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
                    updated_at: "2026-09-30T10:00:00.000Z",
                  },
                  error: null,
                }),
              }),
            };
          },
        };
        return builder;
      },
    }),
  }));

  const route = await import("./route");
  return { route, seen };
}

function post(body: Record<string, unknown>): Request {
  return new Request("https://app.test/api/chat/feedback", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer test" },
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
  vi.doUnmock("@/lib/auth/index");
  vi.doUnmock("@/lib/supabase/server");
  vi.resetModules();
});

/* ------------------------------------------------------------ the gate --- */

describe("the rating gate is ask_questions, for every role that holds it", () => {
  it("lets every role the rollout named ask Sunny, so none is locked out of rating", () => {
    /*
     * If this fails, the matrix changed — and Admin-only (or manager-only)
     * feedback would follow silently, because the route's gate is the matrix.
     */
    for (const role of NAMED_ROLES) {
      expect(ASKING_ROLES).toContain(role);
    }
  });

  it.each(ASKING_ROLES)("saves a %s's rating of their own answer", async (role) => {
    const { route, seen } = await load(role);

    const response = await route.POST(post({ turnId: MY_TURN, rating: 4 }));

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.feedback).toMatchObject({ turnId: MY_TURN, rating: 4 });
    expect(seen.upserts).toHaveLength(1);
    /* The rater is the session's subject, whatever the role. */
    expect(seen.upserts[0]!.values.user_id).toBe(CALLER);
    expect(seen.upserts[0]!.options).toEqual({ onConflict: "activity_event_id,user_id" });
  });

  it.each(ASKING_ROLES)(
    "refuses a %s rating somebody else's answer, and writes nothing",
    async (role) => {
      /*
       * INCLUDING AN ADMIN. Moderating feedback is an administrator's job on
       * its own route; LEAVING feedback on another person's turn is nobody's.
       */
      const { route, seen } = await load(role);

      const response = await route.POST(post({ turnId: THEIR_TURN, rating: 1 }));

      expect(response.status).toBe(403);
      expect(seen.upserts).toHaveLength(0);
    },
  );
});

/* ----------------------------------------------- the three submissions --- */

describe("rating only, rating and outcome, and all three are each complete", () => {
  it.each([
    [
      "rating only",
      { rating: 3 },
      { rating: 3, got_what_needed: null, comment: null },
    ],
    [
      "rating and outcome",
      { rating: 5, gotWhatNeeded: "yes" },
      { rating: 5, got_what_needed: "yes", comment: null },
    ],
    [
      "rating, outcome and comment",
      { rating: 2, gotWhatNeeded: "no", comment: "  Wrong salon.  " },
      { rating: 2, got_what_needed: "no", comment: "Wrong salon." },
    ],
  ] as const)("%s", async (_label, body, stored) => {
    const { route, seen } = await load("district_manager");

    const response = await route.POST(post({ turnId: MY_TURN, ...body }));

    expect(response.status).toBe(200);
    expect(seen.upserts).toHaveLength(1);
    expect(seen.upserts[0]!.values).toMatchObject({
      activity_event_id: MY_TURN,
      user_id: CALLER,
      ...stored,
    });
  });
});
