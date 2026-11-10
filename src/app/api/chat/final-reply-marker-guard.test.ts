import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { STREAM_HEADER, unwrapStreamed } from "@/lib/api/streamed-response";

/**
 * FINAL_REPLY_MARKER_GUARD_ENABLED, through POST /api/chat (QA's live Sunny tester after round 4, 8 Nov 2026).
 *
 * "I need a corrective action for under performance" → "must see behaviors": on the form path (intent form|no_card,
 * the slow one, 14–17 s) the reply reached the manager with "…not an employee name [S1][S2]." and "…see their eyewear
 * [S4][S3]." though SOURCE_NOTE_GUARD was on. Whatever inner path answers, the route's final reply carries no bare
 * tag. Here the answer is stubbed to arrive tagged (as that path's did) and slow enough that the reply is streamed
 * (CHAT_RESPONSE_STREAM: keep-alives, then one envelope), the way the live turn was.
 */
const ORIGINAL = { ...process.env };
vi.setConfig({ testTimeout: 30_000 });

const TAGGED =
  "Got it — MSB is Must See Behaviors, not an employee name [S1][S2].\n\nThe Must See Behaviors are used every time with every client, and asking every client to see their eyewear [S4][S3].\n\nWho is this form for? Tell me the employee's full name.";

async function load(delayMs: number) {
  vi.resetModules();
  vi.doMock("@/lib/auth/server", () => ({
    authorizeRequest: async (_request: Request, permission: string) => ({
      identity: {
        subject: "user-1",
        email: "manager@example.test",
        displayName: "Dana Reyes",
        role: "salon_director",
        scope: { level: "salon", primaryAreaId: "loc-0314", alsoCoversAreaIds: [] },
        verified: true,
      },
      permission,
      provider: "supabase",
    }),
  }));
  vi.doMock("@/lib/ai/server-ask", () => ({
    answerQuestion: async () => {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      return { content: TAGGED, citations: [], recommendedVideoIds: [] };
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
  return import("./route");
}

const ask = () =>
  new Request("https://app.test/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ question: "must see behaviors", history: [{ id: "u1", role: "user", content: "I need a corrective action for under performance" }], mode: "standard" }),
  });

/** What the browser keeps: the streamed envelope unwrapped, or the plain body. */
async function replyOf(response: Response): Promise<string> {
  if (response.headers.get(STREAM_HEADER) === "1") return String((unwrapStreamed(await response.text()).body as { content?: string }).content ?? "");
  return String(((await response.json()) as { content?: string }).content ?? "");
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_DEMO_MODE = "false";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test";
  process.env.SUPABASE_SECRET_KEY = ["sb", "secret", "TESTFIXTURE"].join("_");
  process.env.ANTHROPIC_API_KEY = "test";
  process.env.CHAT_RESPONSE_STREAM_ENABLED = "true";
});

afterEach(() => {
  process.env = { ...ORIGINAL };
  vi.doUnmock("@/lib/auth/server");
  vi.doUnmock("@/lib/ai/server-ask");
  vi.doUnmock("@/lib/supabase/server");
  vi.resetModules();
});

describe("FINAL_REPLY_MARKER_GUARD_ENABLED", () => {
  it("off (as before): a tagged answer reaches the browser tagged, on the streamed (slow) path", async () => {
    const route = await load(2_200);
    const response = await route.POST(ask());
    expect(response.headers.get(STREAM_HEADER)).toBe("1");
    expect(await replyOf(response)).toContain("[S4][S3]");
  });

  it("on: the streamed (slow) reply carries no bare tag; its words stay", async () => {
    process.env.FINAL_REPLY_MARKER_GUARD_ENABLED = "true";
    const route = await load(2_200);
    const response = await route.POST(ask());
    expect(response.headers.get(STREAM_HEADER)).toBe("1");
    const reply = await replyOf(response);
    expect(reply).not.toMatch(/\[\s*S\d/);
    expect(reply).toContain("not an employee name.");
    expect(reply).toContain("see their eyewear.");
  });

  it("on: the fast (plain) reply too", async () => {
    process.env.FINAL_REPLY_MARKER_GUARD_ENABLED = "true";
    const route = await load(0);
    const response = await route.POST(ask());
    expect(await replyOf(response)).not.toMatch(/\[\s*S\d/);
  });
});
