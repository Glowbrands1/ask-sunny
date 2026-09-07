import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AccessScope } from "@/types";

/**
 * ============================================================================
 * REQUIREMENT 44 — THE CALLER DOES NOT SAY WHO THE CALLER IS
 * ============================================================================
 *
 * A form proposal needs two facts a caller must never be able to assert about
 * itself: which ROLE is asking (it decides which templates are offered) and
 * which SALONS they are assigned to (it decides which salon a form may name).
 *
 * Both are read from `authorizeRequest` and passed to `answerQuestion` as a
 * SEPARATE ARGUMENT from the parsed body — which is the structural part. There
 * is no field on `AskRequest` for them, so a browser that sends `role` or
 * `scope` has nowhere for them to land.
 */

const ORIGINAL = { ...process.env };

const REAL_SCOPE: AccessScope = {
  level: "salon",
  primaryAreaId: "loc-0101",
  alsoCoversAreaIds: [],
};

interface Seen {
  request: Record<string, unknown>;
  actor: { role: string | null; scope: AccessScope | null };
}

async function load(identity: { role: string; scope: AccessScope | null }) {
  vi.resetModules();
  const seen: Seen[] = [];

  vi.doMock("@/lib/auth/server", () => ({
    authorizeRequest: async (_request: Request, permission: string) => ({
      identity: {
        subject: "user-1",
        email: "sd@example.com",
        displayName: "SD",
        role: identity.role,
        scope: identity.scope,
        verified: true,
      },
      permission,
      provider: "supabase",
    }),
  }));

  vi.doMock("@/lib/ai/server-ask", () => ({
    answerQuestion: async (request: Record<string, unknown>, actor: Seen["actor"]) => {
      seen.push({ request, actor });
      return { content: "ok", citations: [], recommendedVideoIds: [] };
    },
  }));

  const route = await import("./route");
  return { route, seen };
}

function ask(body: Record<string, unknown>): Request {
  return new Request("https://app.test/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ question: "I need a coaching form", ...body }),
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
  vi.resetModules();
});

describe("44. the actor comes from the session, never from the body", () => {
  it("passes the authenticated role and scope", async () => {
    const { route, seen } = await load({ role: "salon_director", scope: REAL_SCOPE });
    await route.POST(ask({}));

    expect(seen[0]!.actor).toEqual({ role: "salon_director", scope: REAL_SCOPE });
  });

  it("ignores a role and a scope the browser asserts about itself", async () => {
    const { route, seen } = await load({ role: "salon_director", scope: REAL_SCOPE });
    await route.POST(
      ask({
        // Every shape a caller might try. None of them has anywhere to land.
        role: "owner",
        scope: { level: "global", primaryAreaId: null, alsoCoversAreaIds: [] },
        actor: { role: "owner", scope: { level: "global" } },
        identity: { role: "developer" },
      }),
    );

    expect(seen[0]!.actor).toEqual({ role: "salon_director", scope: REAL_SCOPE });
    expect(seen[0]!.request).not.toHaveProperty("role");
    expect(seen[0]!.request).not.toHaveProperty("scope");
    expect(seen[0]!.request).not.toHaveProperty("actor");
  });

  it("carries a null scope through rather than inventing one", async () => {
    const { route, seen } = await load({ role: "salon_director", scope: null });
    await route.POST(ask({ scope: REAL_SCOPE }));

    expect(seen[0]!.actor.scope).toBeNull();
  });

  it("passes the message id as provenance, bounded and optional", async () => {
    const { route, seen } = await load({ role: "salon_director", scope: REAL_SCOPE });

    await route.POST(ask({ questionMessageId: "msg-42" }));
    expect(seen[0]!.request.questionMessageId).toBe("msg-42");

    const long = "x".repeat(500);
    await route.POST(ask({ questionMessageId: long }));
    expect((seen[1]!.request.questionMessageId as string).length).toBe(64);

    await route.POST(ask({}));
    expect(seen[2]!.request.questionMessageId).toBeUndefined();
  });
});
