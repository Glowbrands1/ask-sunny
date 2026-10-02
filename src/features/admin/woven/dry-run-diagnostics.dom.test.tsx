// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { buildSyncDiagnostics, type DiagnosticsInput } from "@/lib/employees/woven/diagnostics";
import { DryRunDiagnostics } from "./sync-panel";

afterEach(cleanup);

/** A diagnostics object with no employees: only the status-read rows under test carry numbers. */
function diagnostics(statusReads: DiagnosticsInput["statusReads"]) {
  return buildSyncDiagnostics({
    employees: [],
    resolved: [],
    currentListIds: new Set(),
    catalog: new Map(),
    candidates: [],
    details: { budget: 150, attempted: 0, fetched: 0, notFoundIds: new Set(), noUsableLocationList: 0, interrupted: false },
    statusLabels: { 1: "Active", 2: "Terminated" },
    terminationTypeLabels: {},
    today: "2026-09-30",
    statusReads,
    detailsStatusIds: new Set(),
  });
}

const READS: DiagnosticsInput["statusReads"] = {
  currentRecords: 150,
  withTerminatedRecords: 150,
  withTerminatedAdded: 0,
  terminatedStatusRead: "read",
  terminatedStatusCodes: [2],
  terminatedStatusRecords: 412,
  terminatedStatusMatched: 3,
  terminatedStatusMatchedOnFile: 0,
  terminatedStatusNotInListReads: 409,
  detailsWithStatus: 16,
  statusDiffersBetweenReads: 3,
};

describe("dry-run diagnostics: what each Woven read said about status", () => {
  it("shows the three list reads, the terminated filter and the disagreements", () => {
    render(<DryRunDiagnostics diagnostics={diagnostics(READS)} />);
    const row = screen.getByText("Status by read").nextElementSibling!.textContent!;
    expect(row).toContain("default 150");
    expect(row).toContain("with terminated 150 (0 added)");
    expect(row).toContain("terminated-status filter (Status 2): 412 returned, 3 also in the lists, 409 only there (not imported)");
    expect(row).toContain("16 details reads carried a Status");
    expect(row).toContain("3 employees whose Status differed between reads");
    expect(screen.getByText("Past TerminationDate")).toBeTruthy();
  });

  it("says plainly when the terminated filter did not run or failed", () => {
    render(<DryRunDiagnostics diagnostics={diagnostics({ ...READS, terminatedStatusRead: "skipped_no_terminated_code", terminatedStatusCodes: [] })} />);
    expect(screen.getByText("Status by read").nextElementSibling!.textContent).toContain("not run (no Terminated status in /lists/enums)");
    cleanup();
    render(<DryRunDiagnostics diagnostics={diagnostics({ ...READS, terminatedStatusRead: "failed" })} />);
    expect(screen.getByText("Status by read").nextElementSibling!.textContent).toContain("terminated-status filter failed");
  });

  it("a response without the new blocks still renders", () => {
    const { statusReads: _r, pastTerminationDate: _t, ...older } = diagnostics(READS);
    render(<DryRunDiagnostics diagnostics={older as ReturnType<typeof diagnostics>} />);
    expect(screen.queryByText("Status by read")).toBeNull();
    expect(screen.getByText("Missing PositionID")).toBeTruthy();
  });
});
