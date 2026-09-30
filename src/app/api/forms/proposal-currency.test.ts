import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AccessScope, ChatMessage } from "@/types";

/**
 * ============================================================================
 * PRODUCTION QA, 30 SEPTEMBER 2026 — A SUPERSEDED CARD CANNOT FILE A FORM
 * ============================================================================
 *
 * After "Coaching form for Jordan Testperson" was corrected to Avery
 * Testperson, the Jordan card stayed on screen with its Create button. The
 * chat now marks it superseded, but the card lives in browser storage — so the
 * ROUTE re-reads the conversation and refuses a proposal it no longer stands
 * behind. These tests drive `POST /api/forms/instances` with the body
 * `createInlineForm` sends.
 */

const ORIGINAL = { ...process.env };
const GLOBAL: AccessScope = { level: "global", primaryAreaId: null, alsoCoversAreaIds: [] };

async function load() {
  process.env.NEXT_PUBLIC_DEMO_MODE = "false";
  vi.resetModules();
  const created: { employeeName: string; templateKey?: string }[] = [];

  vi.doMock("@/lib/auth/server", async () => {
    const { AuthError } = await import("@/lib/auth/types");
    const { DEFAULT_PERMISSION_MATRIX, hasPermission } = await import("@/lib/permissions");
    return {
      authorizeRequest: async (_request: Request, permission: string) => {
        if (!hasPermission(DEFAULT_PERMISSION_MATRIX, "admin" as never, permission as never)) {
          throw new AuthError("forbidden", "Your role does not have permission to do that.");
        }
        return {
          identity: { subject: "user-1", email: "admin@example.com", displayName: "Admin", role: "admin", scope: GLOBAL, verified: true },
          permission,
          provider: "supabase",
        };
      },
    };
  });

  vi.doMock("@/lib/forms/repository", () => ({
    getTemplateByKey: async (key: string) =>
      ({
        coaching: { id: "tpl-coaching", key: "coaching", name: "Coaching Form", requiredPermission: "create_coaching_form", active: true },
        "policy-review": { id: "tpl-pr", key: "policy-review", name: "Policy Review", requiredPermission: "create_policy_review", active: true },
      })[key] ?? null,
  }));

  vi.doMock("@/lib/forms/instances", () => ({
    createInstance: async (input: { employeeName: string; templateKey?: string }) => {
      created.push(input);
      return { id: "inst-1", ...input };
    },
    listInstances: async () => [],
    findDemoInstances: async () => ({ deletable: [], protected: [] }),
    deleteDemoInstances: async () => ({ deleted: 0 }),
    InstanceProtectedError: class extends Error {},
  }));

  const route = await import("./instances/route");
  return { route, created };
}

function post(body: Record<string, unknown>): Request {
  return new Request("https://app.test/api/forms/instances", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

let counter = 0;
function said(content: string): Pick<ChatMessage, "id" | "role" | "content"> {
  counter += 1;
  return { id: `m-${counter}`, role: "user", content };
}
function answered(content: string): Pick<ChatMessage, "id" | "role" | "content"> {
  counter += 1;
  return { id: `m-${counter}`, role: "assistant", content };
}

const CORRECTED = [
  said("Coaching form for Jordan Testperson"),
  answered("Here is what I would put on a Coaching Form."),
  said("No, not Jordan Testperson. Avery Testperson."),
  answered("Here is what I would put on a Coaching Form."),
];

function create(templateKey: string, employeeName: string, conversation: unknown) {
  return post({ templateKey, employeeName, variantKey: null, employeeRole: null, locationId: null, source: "ask_sunny", conversation });
}

beforeEach(() => vi.resetModules());
afterEach(() => {
  process.env = { ...ORIGINAL };
  for (const mod of ["@/lib/auth/server", "@/lib/forms/repository", "@/lib/forms/instances"]) vi.doUnmock(mod);
  vi.resetModules();
});

describe("creation from a chat card re-reads the conversation", () => {
  it("refuses the Jordan card once the manager corrected the employee to Avery — and creates nothing", async () => {
    const { route, created } = await load();
    const response = await route.POST(create("coaching", "Jordan Testperson", CORRECTED));
    expect(response.status).toBe(409);
    const body = (await response.json()) as { error: string; code: string };
    expect(body.code).toBe("proposal_superseded");
    expect(body.error).toContain("Avery Testperson");
    expect(created).toEqual([]);
  });

  it("creates the current card, for the corrected employee", async () => {
    const { route, created } = await load();
    const response = await route.POST(create("coaching", "Avery Testperson", CORRECTED));
    expect(response.status).toBe(200);
    expect(created.map((form) => form.employeeName)).toEqual(["Avery Testperson"]);
  });

  it("refuses a card for someone the manager said it is NOT for, even with no replacement yet", async () => {
    const { route, created } = await load();
    const response = await route.POST(
      create("coaching", "Jordan Testperson", [said("Coaching form for Jordan Testperson"), answered("…"), said("no, not Jordan")]),
    );
    expect(response.status).toBe(409);
    expect(created).toEqual([]);
  });

  it("refuses a card for a form the conversation has since switched away from", async () => {
    const { route, created } = await load();
    const response = await route.POST(
      create("coaching", "Avery Testperson", [
        said("Coaching form for Avery Testperson"),
        answered("…"),
        said("Actually make it a Policy Review instead"),
      ]),
    );
    expect(response.status).toBe(409);
    expect(created).toEqual([]);
  });

  it("refuses a card when the conversation now names two people", async () => {
    const { route } = await load();
    const response = await route.POST(
      create("coaching", "Avery Testperson", [said("coaching form for Avery Testperson and Jordan Testperson")]),
    );
    expect(response.status).toBe(409);
  });

  it("is not fooled by a topic word: 'policy review' as the topic keeps the Coaching card current", async () => {
    const { route, created } = await load();
    const response = await route.POST(
      create("coaching", "Avery Testperson", [said("coaching form for Avery Testperson; topic is policy review")]),
    );
    expect(response.status).toBe(200);
    expect(created).toHaveLength(1);
  });

  it("a question asked after the card does not make it stale", async () => {
    const { route } = await load();
    const response = await route.POST(
      create("coaching", "Avery Testperson", [said("Coaching form for Avery Testperson"), answered("…"), said("is there a transfer form?")]),
    );
    expect(response.status).toBe(200);
  });

  it("the manual builder, which sends no conversation, is unchanged", async () => {
    const { route, created } = await load();
    const response = await route.POST(
      post({ templateKey: "coaching", employeeName: "Jordan Testperson", locationId: null, source: "manual" }),
    );
    expect(response.status).toBe(200);
    expect(created).toHaveLength(1);
  });
});
