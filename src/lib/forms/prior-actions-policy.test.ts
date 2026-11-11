import { afterEach, describe, expect, it, vi } from "vitest";

import { priorFormsFromRows } from "./prior-forms-lines";

/**
 * ============================================================================
 * PRIOR_ACTIONS_POLICY_ENABLED — THE POLICY ON EACH HISTORY LINE
 * ============================================================================
 *
 * Pau, 3 Nov 2026 (through QA): "Verbal corrective action (Attendance) —
 * signed 11/02/2026". A Corrective Action's history read from Form Monitoring
 * said only the step and the date, so a manager could not see which policy an
 * earlier warning was for. The person is invented.
 */

vi.setConfig({ testTimeout: 30_000 });

const db = vi.hoisted(() => ({
  rows: [] as Record<string, unknown>[],
  values: [] as { instance_id: string; field_key: string; value?: string; checked?: string[] }[],
}));

vi.mock("@/lib/supabase/server", () => ({
  getSupabaseAdmin: () => ({
    from: () => ({
      select: () => ({
        eq: (_column: string, key: string) => ({
          in: async (_idColumn: string, ids: string[]) => ({
            data: db.values.filter((row) => row.field_key === key && ids.includes(row.instance_id)),
            error: null,
          }),
        }),
      }),
    }),
  }),
}));
vi.mock("./instances", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./instances")>()),
  listInstances: async () => db.rows,
}));

const actor = { id: "manager-1", role: "salon_director", verified: true, visibility: { level: "global" } } as never;

function finalized(id: string, templateKey: string, formDate: string) {
  return {
    id,
    templateKey,
    templateName: templateKey === "coaching" ? "Coaching Form" : "Corrective Action Form",
    employeeName: "Wren Talley",
    status: "finalized",
    locationId: "loc-0309",
    createdBy: "manager-1",
    formDate,
    createdAt: `${formDate}T12:00:00.000Z`,
    archivedAt: null,
  };
}

afterEach(() => {
  delete process.env.PRIOR_ACTIONS_POLICY_ENABLED;
  vi.resetModules();
});

async function lines(flag: boolean) {
  if (flag) process.env.PRIOR_ACTIONS_POLICY_ENABLED = "true";
  db.rows = [finalized("c-1", "coaching", "2026-10-20"), finalized("ca-1", "dpoa", "2026-11-02")];
  db.values = [
    { instance_id: "ca-1", field_key: "warning_type", checked: ["verbal"] },
    { instance_id: "ca-1", field_key: "policy_violated", value: "Attendance" },
  ];
  const { readPriorFormsOnFile } = await import("./prior-forms");
  const reading = await readPriorFormsOnFile({ actor, employeeName: "Wren Talley", locationId: "loc-0309" });
  return reading.attach.map((form) => form.line);
}

describe("the policy on each Corrective Action history line", () => {
  it("on: Pau's example, word for word; the Coaching line is unchanged", async () => {
    expect(await lines(true)).toEqual(["Coaching — signed 10/20/2026", "Verbal corrective action (Attendance) — signed 11/02/2026"]);
  });

  it("off: as before", async () => {
    expect(await lines(false)).toEqual(["Coaching — signed 10/20/2026", "Verbal corrective action — signed 11/02/2026"]);
  });
});

describe("what goes in the brackets", () => {
  const row = { id: "ca-1", templateKey: "dpoa", employeeName: "Wren Talley", status: "finalized", formDate: "2026-11-02" };
  const line = (policy: string | undefined) =>
    priorFormsFromRows({
      rows: [row],
      employeeName: "Wren Talley",
      warningLevels: new Map([["ca-1", ["written"]]]),
      policies: policy === undefined ? undefined : new Map([["ca-1", policy]]),
    })[0]!.line;

  it("the policy's first line, without brackets of its own", () => {
    expect(line("Tardiness/Leaving Early\nShe was late three times.")).toBe("Written corrective action (Tardiness/Leaving Early) — signed 11/02/2026");
    expect(line("Standards of Conduct (Section 4)")).toBe("Written corrective action (Standards of Conduct Section 4) — signed 11/02/2026");
  });

  it("nothing, a blank or a sentence too long to be a policy name: no brackets", () => {
    expect(line(undefined)).toBe("Written corrective action — signed 11/02/2026");
    expect(line("   ")).toBe("Written corrective action — signed 11/02/2026");
    expect(line("x".repeat(61))).toBe("Written corrective action — signed 11/02/2026");
  });
});
