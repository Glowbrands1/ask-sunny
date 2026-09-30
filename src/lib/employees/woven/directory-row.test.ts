import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ getSupabaseAdmin: () => { throw new Error("no database in this test"); } }));

const { directoryRowFromView } = await import("./directory");
const { matchesFilter, parseDirectoryQuery, queryDirectory } = await import("./views");

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

/** Status as the Employee Directory shows and filters it: Woven's normalised status from the view, nothing inferred. */
describe("directory status display and the Active / Terminated filter", () => {
  const view = (id: string, status: unknown, terminationDate: string | null = null) =>
    directoryRowFromView({ id: `r${id}`, external_employee_id: id, employment_status: status, termination_date: terminationDate, first_name: `F${id}`, last_name: `L${id}` });
  const rows = [
    view("1", "active"),
    /* Active in Woven with a past TerminationDate: shown Active. The date alone terminates nobody. */
    view("2", "active", "2026-05-04"),
    view("3", "terminated", "2026-05-04"),
    view("4", "terminated"),
    view("5", "unknown"),
  ];

  it("shows Woven's own status", () => {
    expect(rows.map((r) => r.employmentStatus)).toEqual(["active", "active", "terminated", "terminated", "unknown"]);
    /* A status the view does not know is never read as Terminated. */
    expect(view("6", "Terminated").employmentStatus).toBe("unknown");
    expect(view("7", null, "2020-01-01").employmentStatus).toBe("unknown");
  });

  it("the status dropdown and the Terminated / Active chips select exactly those rows", () => {
    const ids = (q: Record<string, string | string[]>) => queryDirectory(rows, parseDirectoryQuery(q)).rows.map((r) => r.externalEmployeeId).sort();
    expect(ids({ status: "terminated" })).toEqual(["3", "4"]);
    expect(ids({ status: "active" })).toEqual(["1", "2"]);
    expect(ids({ filter: "terminated" })).toEqual(["3", "4"]);
    expect(ids({ filter: "active" })).toEqual(["1", "2"]);
    expect(queryDirectory(rows, parseDirectoryQuery({})).statusCounts).toEqual({ active: 2, terminated: 2, unknown: 1 });
    expect(rows.filter((r) => matchesFilter(r, "terminated")).every((r) => r.employmentStatus === "terminated")).toBe(true);
  });
});
