import { beforeEach, describe, expect, it, vi } from "vitest";

import { cardInstanceId } from "@/lib/forms/instances";

/*
 * PR 4 (QA's review of #1022): the form Create made from a card is found by the id Create derived for it
 * (`cardInstanceId`), however old it is and however many forms other managers have made since; a lookup that cannot be
 * read is "failed", never "not created" (which would tell the model to make the card again and can duplicate a form).
 */
vi.mock("server-only", () => ({}));

const MANAGER = "manager-sub-1";
const OTHER = "manager-sub-2";
const PROPOSAL = "7f1d6d3a-5c0b-4f3e-9b8e-2a6c1f4d9e01";
const state = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[], fail: false }));

vi.mock("@/lib/forms/repository", () => ({
  listTemplateSummaries: async () => [
    { key: "dpoa", name: "Corrective Action Form", active: true, currentVersion: 1, requiredPermission: "create_form" },
    { key: "coaching", name: "Coaching Form", active: true, currentVersion: 1, requiredPermission: "create_form" },
  ],
}));
vi.mock("@/lib/supabase/server", () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => {
      if (table !== "form_instances") throw new Error(`unexpected table ${table}`);
      let ids: string[] | null = null;
      let creator: string | null = null;
      const builder = {
        select: () => builder,
        in: (_column: string, values: string[]) => ((ids = values), builder),
        eq: (_column: string, value: string) => ((creator = value), builder),
        limit: async () => {
          if (state.fail) return { data: null, error: { message: "boom" } };
          const data = state.rows.filter((row) => (ids ? ids.includes(String(row.id)) : true) && (creator ? row.created_by === creator : true)).slice(0, 1);
          return { data, error: null };
        },
      };
      return builder;
    },
  }),
}));
vi.mock("@/lib/permissions", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/permissions")>()), hasPermission: () => true }));

const { instanceCreatedFromProposal, editForm } = await import("./tools");
const context = { actor: { subject: MANAGER, role: "salon_director" } } as never;

beforeEach(() => {
  state.fail = false;
  state.rows = [];
});

describe("instanceCreatedFromProposal", () => {
  it("finds the form Create made from the card, though 600 newer forms by other managers exist", async () => {
    const target = cardInstanceId(MANAGER, "dpoa", PROPOSAL, null);
    state.rows = [
      { id: target, created_by: MANAGER },
      ...Array.from({ length: 600 }, (_, index) => ({ id: cardInstanceId(OTHER, "dpoa", `${index}-card`, null), created_by: OTHER })),
    ];
    expect(await instanceCreatedFromProposal(context, PROPOSAL)).toEqual({ kind: "created", id: target });
  });
  it("finds it under the chat's conversation key too", async () => {
    const conversationId = "11111111-2222-4333-8444-555555555555";
    const target = cardInstanceId(MANAGER, "coaching", PROPOSAL, conversationId);
    state.rows = [{ id: target, created_by: MANAGER }];
    expect(await instanceCreatedFromProposal({ ...(context as object), conversationId } as never, PROPOSAL)).toEqual({ kind: "created", id: target });
  });
  it("another manager's form from the same card id is not this manager's", async () => {
    state.rows = [{ id: cardInstanceId(OTHER, "dpoa", PROPOSAL, null), created_by: OTHER }];
    expect(await instanceCreatedFromProposal(context, PROPOSAL)).toEqual({ kind: "none" });
  });
  it("a card nobody created is none", async () => {
    expect(await instanceCreatedFromProposal(context, PROPOSAL)).toEqual({ kind: "none" });
  });
  it("a lookup that cannot be read is failed, never none", async () => {
    state.fail = true;
    expect(await instanceCreatedFromProposal(context, PROPOSAL)).toEqual({ kind: "failed" });
  });
});

describe("edit_form on a shown card's id", () => {
  const shown = { proposal: { proposalId: PROPOSAL, templateKey: "dpoa", employeeName: "Remy Calder" }, formUpdate: null } as never;
  const ctx = { actor: { subject: MANAGER, role: "salon_director" }, question: "change the date", history: [], openFormId: null } as never;
  it("a card nobody created is not_a_saved_form", async () => {
    expect((await editForm(ctx, shown, { instance_id: PROPOSAL })).reason_code).toBe("not_a_saved_form");
  });
  it("a lookup that cannot be read is write_failed, never \"isn't created yet\"", async () => {
    state.fail = true;
    const result = await editForm(ctx, shown, { instance_id: PROPOSAL });
    expect(result.reason_code).toBe("write_failed");
    expect(String(result.error)).not.toMatch(/isn't created yet/);
  });
});
