import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * ============================================================================
 * "COMPLETE" MEANS EVERY VISIBLE FORM WAS READ (review item 15b, 31 Oct 2026)
 * ============================================================================
 *
 * With NEXT_PUBLIC_ASSISTANT_MANAGER_CREATE_ENABLED on, every bounded read asks
 * for four times its page (private-creator over-read). An employee with 300
 * matching forms then read as "complete" though only the newest 200 were used,
 * so prior forms were attached as the whole history. Names are invented.
 */

vi.setConfig({ testTimeout: 30_000 });

const rows = vi.hoisted(() => ({ list: [] as Record<string, unknown>[] }));

vi.mock("@/lib/supabase/server", () => ({
  getSupabaseAdmin: () => ({
    from: () => ({ select: () => ({ eq: () => ({ in: async () => ({ data: [], error: null }) }) }) }),
  }),
}));
vi.mock("./instances", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./instances")>()),
  listInstances: async (_view: string, limit: number) => rows.list.slice(0, limit),
}));

function form(index: number) {
  return {
    id: `f-${index}`,
    templateKey: "coaching",
    templateName: "Coaching Form",
    employeeName: "Dana Moss",
    status: "finalized",
    locationId: "loc-0309",
    createdBy: "manager-1",
    formDate: "2026-01-01",
    createdAt: new Date(Date.UTC(2026, 0, 1) + index * 60_000).toISOString(),
    archivedAt: null,
  };
}

const actor = { id: "manager-1", role: "salon_director", verified: true, visibility: { level: "global" } } as never;

afterEach(() => {
  delete process.env.NEXT_PUBLIC_ASSISTANT_MANAGER_CREATE_ENABLED;
  vi.resetModules();
});

async function reading(count: number, amFlag: boolean) {
  if (amFlag) process.env.NEXT_PUBLIC_ASSISTANT_MANAGER_CREATE_ENABLED = "true";
  rows.list = Array.from({ length: count }, (_, index) => form(index));
  const { readPriorFormsOnFile } = await import("./prior-forms");
  return readPriorFormsOnFile({ actor, employeeName: "Dana Moss", locationId: "loc-0309" });
}

describe("prior forms with more than one page on file", () => {
  it("AM flag on, 300 matching forms: incomplete, nothing attached as the whole history", async () => {
    const result = await reading(300, true);
    expect(result.attach).toEqual([]);
    expect(result.identity).toBe("incomplete");
  });

  it("AM flag off, 300 matching forms: incomplete, as before", async () => {
    const result = await reading(300, false);
    expect(result.identity).toBe("incomplete");
  });

  it("AM flag on, 50 matching forms: complete, attached", async () => {
    const result = await reading(50, true);
    expect(result.identity).toBe("unambiguous");
    expect(result.attach.length).toBeGreaterThan(0);
  });
});
