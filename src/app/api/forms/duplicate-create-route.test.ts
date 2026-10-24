import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AccessScope } from "@/types";

/**
 * POST /api/forms/instances — a repeated create from chat returns the draft.
 *
 * Ported from Ask Bubbles' duplicate-create-route test. Sunny's create sends
 * source "ask_sunny" (Bubbles sends "assistant"). With
 * CONVERSATION_PROPOSAL_DEDUPE_ENABLED off, the lookup is the card id the
 * route already used. With the flag on, the key is the conversation plus
 * the proposal, and the employee name is not part of the match.
 */

const ORIGINAL = { ...process.env };
const GLOBAL: AccessScope = { level: "global", primaryAreaId: null, alsoCoversAreaIds: [] };

async function load(existing: { id: string } | null) {
  process.env.NEXT_PUBLIC_DEMO_MODE = "false";
  process.env.DRAFT_DEDUPE_ENABLED = "off";
  vi.resetModules();
  const created: Record<string, unknown>[] = [];
  const lookups: Record<string, unknown>[] = [];
  const conversationLookups: Record<string, unknown>[] = [];

  vi.doMock("@/lib/auth/server", async () => {
    const { AuthError } = await import("@/lib/auth/types");
    const { DEFAULT_PERMISSION_MATRIX, hasPermission } = await import("@/lib/permissions");
    return {
      authorizeRequest: async (_request: Request, permission: string) => {
        if (!hasPermission(DEFAULT_PERMISSION_MATRIX, "admin" as never, permission as never)) {
          throw new AuthError("forbidden", "Your role does not have permission to do that.");
        }
        return {
          identity: {
            subject: "manager-1",
            email: "m@example.com",
            displayName: "Manager",
            role: "admin",
            scope: GLOBAL,
            verified: true,
          },
          permission,
          provider: "supabase",
        };
      },
    };
  });
  vi.doMock("@/lib/forms/repository", () => ({
    getTemplateByKey: async (key: string) =>
      key === "coaching"
        ? {
            id: "tpl-coaching",
            key: "coaching",
            name: "Coaching Form",
            requiredPermission: "create_coaching_form",
            active: true,
          }
        : null,
  }));
  vi.doMock("@/lib/forms/instances", () => ({
    createInstance: async (input: Record<string, unknown>) => {
      created.push(input);
      return { id: "inst-new", ...input };
    },
    findRecentAssistantDraft: async (input: Record<string, unknown>) => {
      lookups.push(input);
      return existing;
    },
    listInstances: async () => [],
    findDemoInstances: async () => ({ deletable: [], protected: [] }),
    deleteDemoInstances: async () => ({ deleted: 0 }),
    InstanceProtectedError: class extends Error {},
  }));
  vi.doMock("@/lib/forms/conversation-proposal-draft", () => ({
    findConversationProposalDraft: async (input: Record<string, unknown>) => {
      conversationLookups.push(input);
      return existing;
    },
  }));

  const route = await import("./instances/route");
  return { route, created, lookups, conversationLookups };
}

function post(body: Record<string, unknown>): Request {
  return new Request("https://app.test/api/forms/instances", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const BODY = {
  templateKey: "coaching",
  employeeName: "Avery Testperson",
  variantKey: null,
  employeeRole: null,
  locationId: null,
  source: "ask_sunny",
  createdBy: "someone-else",
  proposalId: "proposal-1111",
  conversation: [{ id: "m1", role: "user", content: "coaching form for Avery Testperson" }],
};

beforeEach(() => {
  vi.resetModules();
  delete process.env.CONVERSATION_PROPOSAL_DEDUPE_ENABLED;
});
afterEach(() => {
  process.env = { ...ORIGINAL };
  for (const mod of [
    "@/lib/auth/server",
    "@/lib/forms/repository",
    "@/lib/forms/instances",
    "@/lib/forms/conversation-proposal-draft",
  ]) {
    vi.doUnmock(mod);
  }
  vi.resetModules();
});

describe("a create from chat that repeats one just made", () => {
  it("returns the existing draft, marked reused, and creates nothing", async () => {
    const { route, created, lookups, conversationLookups } = await load({ id: "inst-existing" });
    const response = await route.POST(post(BODY));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { instance: { id: string }; reused?: boolean };
    expect(body.instance.id).toBe("inst-existing");
    expect(body.reused).toBe(true);
    expect(created).toEqual([]);
    expect(conversationLookups).toEqual([]);
    expect(lookups).toEqual([
      {
        templateKey: "coaching",
        employeeName: "Avery Testperson",
        createdBy: "manager-1",
        locationId: null,
        proposalId: "proposal-1111",
      },
    ]);
  });

  it("creates as before when there is no such draft", async () => {
    const { route, created } = await load(null);
    const response = await route.POST(post(BODY));
    expect(response.status).toBe(200);
    expect(((await response.json()) as { reused?: boolean }).reused).toBeUndefined();
    expect(created).toHaveLength(1);
    expect(created[0]!.conversationKey).toBeUndefined();
  });

  it("a stale card is still refused before any draft is looked up or returned", async () => {
    const { route, created, lookups, conversationLookups } = await load({ id: "inst-existing" });
    const response = await route.POST(
      post({
        ...BODY,
        conversation: [
          { id: "m1", role: "user", content: "coaching form for Avery Testperson" },
          { id: "m2", role: "assistant", content: "Here is what I would put on a Coaching Form." },
          { id: "m3", role: "user", content: "No, not Avery Testperson. Jordan Testperson." },
        ],
      }),
    );
    expect(response.status).toBe(409);
    expect(lookups).toEqual([]);
    expect(conversationLookups).toEqual([]);
    expect(created).toEqual([]);
  });

  it("a create without a card id is never matched, and records nothing to match later", async () => {
    const { route, created, lookups } = await load({ id: "inst-existing" });
    const withoutCard: Record<string, unknown> = { ...BODY };
    delete withoutCard.proposalId;
    const response = await route.POST(post(withoutCard));
    expect(response.status).toBe(200);
    expect(lookups).toEqual([]);
    expect(created).toHaveLength(1);
    expect(created[0]!.proposalId).toBeUndefined();
  });

  it("the new form records its card, so a repeated press can find it", async () => {
    const { route, created } = await load(null);
    await route.POST(post(BODY));
    expect(created[0]!.proposalId).toBe("proposal-1111");
  });

  it("a manual create never reuses a draft", async () => {
    const { route, created, lookups } = await load({ id: "inst-existing" });
    const response = await route.POST(post({ ...BODY, source: "manual", conversation: undefined }));
    expect(response.status).toBe(200);
    expect(lookups).toEqual([]);
    expect(created).toHaveLength(1);
  });

  it("with the flag on, the key is the conversation and the proposal", async () => {
    process.env.CONVERSATION_PROPOSAL_DEDUPE_ENABLED = "on";
    const { route, created, lookups, conversationLookups } = await load({ id: "inst-existing" });
    const response = await route.POST(post({ ...BODY, conversationId: "conv-9" }));
    expect(response.status).toBe(200);
    expect(((await response.json()) as { reused?: boolean }).reused).toBe(true);
    expect(created).toEqual([]);
    expect(lookups).toEqual([]);
    expect(conversationLookups).toEqual([
      { createdBy: "manager-1", proposalId: "proposal-1111", conversationKey: "conv-9" },
    ]);
  });

  it("with the flag on and no existing draft, the create records the conversation key", async () => {
    process.env.CONVERSATION_PROPOSAL_DEDUPE_ENABLED = "on";
    const { route, created, conversationLookups } = await load(null);
    await route.POST(post(BODY));
    expect(conversationLookups).toEqual([
      { createdBy: "manager-1", proposalId: "proposal-1111", conversationKey: "m1" },
    ]);
    expect(created[0]!.conversationKey).toBe("m1");
    expect(created[0]!.proposalId).toBe("proposal-1111");
  });
});
