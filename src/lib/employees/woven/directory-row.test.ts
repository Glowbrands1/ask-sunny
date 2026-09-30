import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ getSupabaseAdmin: () => { throw new Error("no database in this test"); } }));

const { directoryRowFromView } = await import("./directory");

/** The directory view's primary_location_mapping_status reaches the screen, and nothing else is guessed. */
describe("directoryRowFromView: primary location mapping status", () => {
  const row = (status: unknown) => ({ id: "r1", external_employee_id: "1", employment_status: "active", primary_location_mapping_status: status });

  it("carries mapped, unmapped and ignored (Corporate) through", () => {
    expect(directoryRowFromView(row("mapped")).primaryLocationMappingStatus).toBe("mapped");
    expect(directoryRowFromView(row("unmapped")).primaryLocationMappingStatus).toBe("unmapped");
    expect(directoryRowFromView(row("ignored")).primaryLocationMappingStatus).toBe("ignored");
  });

  it("anything else, including no map row, is null — never read as the Corporate exception", () => {
    for (const bad of [null, undefined, "Ignored", "", 3]) expect(directoryRowFromView(row(bad)).primaryLocationMappingStatus, String(bad)).toBeNull();
  });
});
