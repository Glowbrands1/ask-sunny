import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fakeChatSupabase } from "@/test/fake-chat-supabase";

/**
 * NEXT_PUBLIC_CHAT_LOCAL_OWNER_ENABLED: the history state carries the opaque
 * key a browser stamps this account's chats with — stable, per account, and
 * never the account id.
 */
const ORIGINAL = { ...process.env };
const MANAGER = "11111111-1111-4111-8111-111111111111";
const ASSISTANT = "22222222-2222-4222-8222-222222222222";

async function stateFor(subject: string): Promise<Record<string, unknown>> {
  vi.resetModules();
  vi.doMock("@/lib/auth/server", () => ({
    authorizeRequest: async (_request: Request, permission: string) => ({
      identity: { subject, email: "x@example.com", displayName: "X", role: "salon_director", scope: { level: "salon", primaryAreaId: "loc-0309", alsoCoversAreaIds: [] }, verified: true },
      permission,
      provider: "supabase",
    }),
  }));
  const db = fakeChatSupabase();
  vi.doMock("@/lib/supabase/server", () => ({ getSupabaseAdmin: () => db.client }));
  const route = await import("./route");
  const response = await route.GET(new Request("https://app.test/api/chat/conversations/import"));
  return (await response.json()) as Record<string, unknown>;
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
  vi.doUnmock("@/lib/auth/server");
  vi.doUnmock("@/lib/supabase/server");
  vi.resetModules();
});

describe("the account key in the history state", () => {
  it("off: not sent", async () => {
    delete process.env.NEXT_PUBLIC_CHAT_LOCAL_OWNER_ENABLED;
    expect(await stateFor(MANAGER)).not.toHaveProperty("account");
  });

  it("on: stable per account, different between accounts, never the id", async () => {
    process.env.NEXT_PUBLIC_CHAT_LOCAL_OWNER_ENABLED = "true";
    const first = (await stateFor(MANAGER)).account;
    const again = (await stateFor(MANAGER)).account;
    const other = (await stateFor(ASSISTANT)).account;
    expect(typeof first).toBe("string");
    expect(first).toBe(again);
    expect(first).not.toBe(other);
    expect(String(first)).not.toContain(MANAGER.slice(0, 8));
  });
});
