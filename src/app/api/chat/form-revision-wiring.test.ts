import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * ============================================================================
 * THE CHAT ROUTE SENDS "REDRAFT IT" TO THE OPEN FORM
 * ============================================================================
 *
 * The revision itself is proven in `api/forms/coaching-feedback-e2e.test.ts`.
 * This proves the wiring: with a created form named by the browser, the route
 * tries the correction, then the revision, and only then an ordinary answer —
 * and without a named form it never tries the revision at all.
 */

const ORIGINAL = { ...process.env };

async function load(revision: unknown) {
  vi.resetModules();
  const seen = { answered: 0, revised: [] as unknown[] };

  vi.doMock("@/lib/auth/server", () => ({
    authorizeRequest: async (_request: Request, permission: string) => ({
      identity: {
        subject: "user-1",
        email: "sd@example.com",
        displayName: "SD",
        role: "salon_director",
        scope: { level: "salon", primaryAreaId: "loc-0310", alsoCoversAreaIds: [] },
        verified: true,
      },
      permission,
      provider: "supabase",
    }),
  }));
  vi.doMock("@/lib/ai/server-ask", () => ({
    answerQuestion: async () => {
      seen.answered += 1;
      return { content: "An ordinary answer.", citations: [], recommendedVideoIds: [] };
    },
  }));
  vi.doMock("@/lib/forms/chat-correction", () => ({ correctActiveForm: async () => null }));
  vi.doMock("@/lib/forms/chat-revision", () => ({
    reviseActiveForm: async (input: unknown) => {
      seen.revised.push(input);
      return revision;
    },
  }));
  vi.doMock("@/lib/supabase/server", () => ({
    getSupabaseAdmin: () => ({
      from: () => ({
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
        insert: async () => ({ error: null }),
        update: () => ({ eq: async () => ({ error: null }) }),
      }),
    }),
  }));

  const route = await import("./route");
  return { route, seen };
}

const INSTANCE = "0b6b6f0e-1111-4c2a-9a55-000000000042";

function ask(body: Record<string, unknown>): Request {
  return new Request("https://app.test/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ question: "Redraft it and change the timeframe to one week.", ...body }),
  });
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
  for (const path of ["@/lib/auth/server", "@/lib/ai/server-ask", "@/lib/forms/chat-correction", "@/lib/forms/chat-revision", "@/lib/supabase/server"]) {
    vi.doUnmock(path);
  }
  vi.resetModules();
});

describe("a revision of the open form", () => {
  it("is answered by the revision, with the form update the editor listens for", async () => {
    const { route, seen } = await load({
      content: "Updated the **Coaching Form** for **Kaitlyn Marsh**: Next Follow-Up.",
      citations: [],
      coverage: "not_applicable",
      recommendedVideoIds: [],
      formUpdate: { instanceId: INSTANCE, updated: ["next_follow_up"] },
    });
    const response = await route.POST(ask({ activeFormInstanceId: INSTANCE, history: [] }));
    const payload = await response.json();

    expect(response.status, JSON.stringify(payload)).toBe(200);
    expect(payload.formUpdate).toEqual({ instanceId: INSTANCE, updated: ["next_follow_up"] });
    expect(seen.answered).toBe(0);
    expect(seen.revised).toHaveLength(1);
  });

  it("is given the business day, so a typed follow-up date can be read", async () => {
    const { route, seen } = await load({
      content: "Set the follow-up date to **Thursday, October 15, 2026**.",
      citations: [],
      coverage: "not_applicable",
      recommendedVideoIds: [],
      formUpdate: { instanceId: INSTANCE, updated: ["follow_up_date"] },
    });
    const response = await route.POST(
      ask({
        activeFormInstanceId: INSTANCE,
        history: [],
        question: "Change the follow-up date to 10/15",
        context: { userName: "Dana", locationName: "NE Lincoln O Street", todayIso: "2026-10-02" },
      }),
    );
    expect(response.status).toBe(200);
    expect(seen.revised[0]).toMatchObject({ question: "Change the follow-up date to 10/15", today: "2026-10-02" });
  });

  it("falls through to an ordinary answer when the turn is not a revision", async () => {
    const { route, seen } = await load(null);
    const response = await route.POST(ask({ activeFormInstanceId: INSTANCE, history: [] }));
    expect((await response.json()).content).toBe("An ordinary answer.");
    expect(seen.answered).toBe(1);
  });

  it("is never tried without a form the conversation created", async () => {
    const { route, seen } = await load({ content: "should not be used" });
    await route.POST(ask({ history: [] }));
    expect(seen.revised).toHaveLength(0);
    expect(seen.answered).toBe(1);
  });
});
