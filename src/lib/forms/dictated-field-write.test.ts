import { afterEach, describe, expect, it, vi } from "vitest";

/*
 * Batch J2 (G8 generalized) on G2 (QA's live run part 2, C20): a dictated field is written through the manager's own
 * save, saveInstanceValues(…, { via: "chat" }), which moves updated_at itself (tested over the real instances.ts in
 * save-touches-updated-at.test.ts), and a field that save rejects is not saved.
 */
const saved = vi.hoisted(() => ({ calls: [] as { id: string; values: Record<string, string>; options: unknown }[], reject: false }));

vi.mock("server-only", () => ({}));
vi.mock("./instances", () => ({
  saveInstanceValues: async (id: string, submitted: { values: Record<string, string> }, _actor: string, options: unknown) => {
    saved.calls.push({ id, values: submitted.values, options });
    const [key] = Object.keys(submitted.values);
    return saved.reject ? { rejected: [{ key, reason: "finalized" }], values: {} } : { rejected: [], values: submitted.values };
  },
}));

const { dictatedFieldWrite, dictatedPlanWrite } = await import("./form-write");

afterEach(() => {
  saved.calls = [];
  saved.reject = false;
});

describe("a dictated field, written as the manager's own save", () => {
  it("goes through saveInstanceValues via chat (the save that moves updated_at), only that field, and is returned", async () => {
    expect(await dictatedFieldWrite("i-1", "observation", "Juno completed onboarding.", "u-1")).toEqual({ saved: "Juno completed onboarding." });
    expect(saved.calls).toEqual([{ id: "i-1", values: { observation: "Juno completed onboarding." }, options: { via: "chat" } }]);
  });

  it("the dictated Action Plan (G8, G2) goes the same way", async () => {
    expect(await dictatedPlanWrite("i-1", "Juno will finish onboarding by 11/20.", "u-1")).toEqual({ saved: "Juno will finish onboarding by 11/20." });
    expect(saved.calls[0]).toMatchObject({ values: { action_plan: "Juno will finish onboarding by 11/20." }, options: { via: "chat" } });
  });

  it("a field the save rejects is not saved: null", async () => {
    saved.reject = true;
    expect(await dictatedFieldWrite("i-1", "observation", "Juno completed onboarding.", "u-1")).toEqual({ saved: null });
    expect(await dictatedPlanWrite("i-1", "Juno will finish onboarding by 11/20.", "u-1")).toEqual({ saved: null });
  });
});
