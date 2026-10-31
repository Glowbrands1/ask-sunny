import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * ============================================================================
 * AN ASSISTANT SALON DIRECTOR'S CORRECTIVE ACTION COUNTS EVERY EARLIER WARNING
 * ============================================================================
 *
 * Independent review, 31 Oct 2026, item 15a, decided by Pau ("Yes option A"):
 * with NEXT_PUBLIC_ASSISTANT_MANAGER_CREATE_ENABLED on, an Assistant Salon
 * Director sees only the forms they created, so the history on their
 * Corrective Action read only their own — an employee with a Verbal CA from
 * the Salon Director could get a "first warning". AM_PRIOR_WARNINGS_ENABLED:
 * earlier warnings from anyone at their salons count, by level and date only.
 * Names are invented.
 */

vi.setConfig({ testTimeout: 30_000 });

const rows = vi.hoisted(() => ({ list: [] as Record<string, unknown>[], levels: [] as { instance_id: string; checked: string[] }[] }));

vi.mock("@/lib/supabase/server", () => ({
  getSupabaseAdmin: () => ({
    from: () => ({ select: () => ({ eq: () => ({ in: async () => ({ data: rows.levels, error: null }) }) }) }),
  }),
}));
vi.mock("./instances", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./instances")>()),
  listInstances: async (_view: string, limit: number) => rows.list.slice(0, limit),
}));

function form(id: string, templateKey: string, createdBy: string, formDate: string, locationId = "loc-0309") {
  return {
    id,
    templateKey,
    templateName: templateKey === "dpoa" ? "Corrective Action Form" : "Coaching Form",
    layoutFamily: templateKey === "dpoa" ? "corrective_action" : "coaching",
    employeeName: "Dana Moss",
    status: "finalized",
    locationId,
    locationName: "Private salon label",
    createdBy,
    formDate,
    createdAt: `${formDate}T12:00:00Z`,
    archivedAt: null,
  };
}

const assistant = {
  id: "asd-1",
  role: "assistant_salon_director",
  verified: true,
  visibility: { level: "salon", primaryAreaId: "loc-0309", alsoCoversAreaIds: [] },
} as never;

afterEach(() => {
  delete process.env.NEXT_PUBLIC_ASSISTANT_MANAGER_CREATE_ENABLED;
  delete process.env.AM_PRIOR_WARNINGS_ENABLED;
  vi.resetModules();
});

async function reading(on: boolean) {
  process.env.NEXT_PUBLIC_ASSISTANT_MANAGER_CREATE_ENABLED = "true";
  if (on) process.env.AM_PRIOR_WARNINGS_ENABLED = "true";
  rows.list = [
    form("c-1", "coaching", "director-1", "2026-09-02"),
    form("ca-1", "dpoa", "director-1", "2026-09-21"),
    // Another salon: never this reader's, whoever filed it.
    form("ca-x", "dpoa", "director-2", "2026-09-25", "loc-0468"),
  ];
  rows.levels = [
    { instance_id: "ca-1", checked: ["verbal"] },
    { instance_id: "ca-x", checked: ["written"] },
  ];
  const { readPriorFormsOnFile } = await import("./prior-forms");
  return readPriorFormsOnFile({ actor: assistant, employeeName: "Dana Moss", locationId: "loc-0309", before: "2026-10-31" });
}

describe("an Assistant Salon Director drafting a Corrective Action for an employee the Salon Director already warned", () => {
  it("off (production today): only their own forms count, so the Verbal CA is not on the history", async () => {
    const result = await reading(false);
    expect(result.attach).toEqual([]);
    expect(result.identity).toBe("none");
  });

  it("AM_PRIOR_WARNINGS: the Salon Director's coaching and Verbal CA count, by level and date only", async () => {
    const result = await reading(true);
    expect(result.identity).toBe("unambiguous");
    expect(result.attach.map((entry) => entry.line)).toEqual([
      expect.stringMatching(/^Coaching\b.*09\/02\/2026/),
      expect.stringMatching(/^Verbal corrective action\b.*09\/21\/2026/),
    ]);
    // Nothing else of another manager's form: no salon label, and never another salon's form.
    for (const entry of result.attach) expect(entry.locationName).toBeNull();
    expect(result.attach.map((entry) => entry.instanceId)).not.toContain("ca-x");
  });
});
