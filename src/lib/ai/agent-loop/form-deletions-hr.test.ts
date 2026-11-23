import { describe, expect, it, vi } from "vitest";

/**
 * Owner, 23 Nov 2026: "are u sure this doesnt leak information, that other people cant see what a certain manager
 * created?". A form deleted while it was with HR is left out of the deletion record administrators read. Invented names.
 */
const read = vi.hoisted(() => ({ select: "" }));
const ROWS = [
  { template_name: "Corrective Action Form", employee_name: "Rosalind Vane", form_date: "2026-11-20", status: "draft", location_name: "Invented Salon", deleted_by: null, deleted_by_role: "salon_director", deleted_via: "route", deleted_at: "2026-11-23T15:00:00Z", hr_state: "rejected" },
  { template_name: "Corrective Action Form", employee_name: "Rosalind Vane", form_date: "2026-11-10", status: "finalized", location_name: "Invented Salon", deleted_by: null, deleted_by_role: "admin", deleted_via: "route", deleted_at: "2026-11-22T15:00:00Z", hr_state: "approved" },
  { template_name: "Resignation/Exit Form", employee_name: "Rosalind Vane", form_date: "2026-11-01", status: "draft", location_name: "Invented Salon", deleted_by: null, deleted_by_role: "salon_director", deleted_via: "route", deleted_at: "2026-11-21T15:00:00Z", hr_state: null },
];

vi.mock("@/lib/supabase/server", () => {
  const builder = {
    select(columns: string) {
      read.select = columns;
      return builder;
    },
    or: () => builder,
    order: () => builder,
    limit: async () => ({ data: ROWS, error: null }),
  };
  return { getSupabaseAdmin: () => ({ from: () => builder }) };
});
vi.mock("@/lib/admin/user-directory", () => ({ readUser: async () => ({ displayName: null }) }));

const { DEFAULT_DATA_TOOL_DEPS } = await import("./data-tools");

describe("read_form_deletions leaves out a form deleted while it was with HR", () => {
  it("only the ordinary deletions reach the model", async () => {
    const rows = await DEFAULT_DATA_TOOL_DEPS.loadFormDeletions({ employeeName: "Rosalind Vane", limit: 20 });
    expect(read.select).toContain("hr_state:snapshot->instance->>hr_approval_state");
    expect(rows.map((row) => row.formDate)).toEqual(["2026-11-10", "2026-11-01"]);
  });
});
