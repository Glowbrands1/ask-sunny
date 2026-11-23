// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";

import * as React from "react";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { HrApprovalTabs, HrQueueList, type HrQueueListRow } from "./hr-approval-lists";

/**
 * Form Monitoring's HR tab (Pau, via QA, 23 Nov 2026):
 *   - "HR sent a CA back, the manager replied with a note, and HR's list still shows ... 'Sent back for changes'.
 *     Meanwhile the tab says 'Pending HR approval (0)' even though the row is listed." The row now reads "Manager replied
 *     to changes", and the tab's number is exactly the rows under "Needs your decision".
 *   - "its so small pending approval, make it red button and animated shaking if theres a pending".
 * Invented forms and people.
 */

afterEach(() => cleanup());

const row = (id: string, state: HrQueueListRow["state"], managerReplied = false): HrQueueListRow => ({
  id,
  line: `Corrective Action Form for Invented Person ${id} at KC Wornall`,
  createdByName: "Marigold",
  state,
  requestedAt: "2026-11-23T15:00:00Z",
  waiting: "Sent today",
  overdue: false,
  managerReplied,
});

const decideCount = () => within(screen.getByTestId("hr-queue-decide")).queryAllByRole("listitem").length;

describe("HR's list on Form Monitoring", () => {
  it("a sent-back form the manager replied to reads \"Manager replied to changes\" and sits under Needs your decision", () => {
    render(<HrQueueList rows={[row("a", "changes_requested", true)]} />);
    const decide = screen.getByTestId("hr-queue-decide");
    expect(within(decide).getByText("Manager replied to changes")).toBeTruthy();
    expect(within(decide).getByRole("heading").textContent).toBe("Needs your decision (1)");
    expect(screen.queryByText("Sent back for changes")).toBeNull();
  });

  it("the tab's number matches the rows under Needs your decision, in every state", () => {
    const cases: { rows: HrQueueListRow[]; pending: number }[] = [
      { rows: [row("w", "pending")], pending: 1 },
      { rows: [row("s", "changes_requested")], pending: 0 },
      { rows: [row("r", "changes_requested", true)], pending: 1 },
      { rows: [row("w", "pending"), row("s", "changes_requested"), row("r", "changes_requested", true), row("x", "rejected")], pending: 2 },
    ];
    for (const { rows, pending } of cases) {
      render(
        <>
          <HrApprovalTabs active="hr" pending={pending} overdue={0} />
          <HrQueueList rows={rows} />
        </>,
      );
      expect(screen.getByTestId("hr-pending-tab").textContent).toContain(`Pending HR approval (${pending})`);
      expect(decideCount(), JSON.stringify(rows.map((entry) => [entry.state, entry.managerReplied]))).toBe(pending);
      const onManager = screen.queryByTestId("hr-queue-on-manager");
      expect(onManager ? within(onManager).queryAllByRole("listitem").length : 0).toBe(rows.length - pending);
      cleanup();
    }
  });

  it("with anything pending, the tab is a red button that shakes; with nothing, the ordinary tab", () => {
    render(<HrApprovalTabs active="all" pending={2} overdue={1} />);
    const urgent = screen.getByTestId("hr-pending-tab");
    expect(urgent.getAttribute("data-urgent")).toBe("true");
    expect(urgent.className).toContain("hr-pending-shake");
    expect(urgent.className).toContain("bg-status-failed");
    expect(urgent.textContent).toContain("1 overdue");
    cleanup();

    render(<HrApprovalTabs active="all" pending={0} overdue={0} />);
    const calm = screen.getByTestId("hr-pending-tab");
    expect(calm.getAttribute("data-urgent")).toBe("false");
    expect(calm.className).not.toContain("hr-pending-shake");
    expect(calm.className).not.toContain("bg-status-failed");
  });

  it("the shake is off under prefers-reduced-motion", () => {
    const css = readFileSync(join(process.cwd(), "src", "app", "globals.css"), "utf8");
    expect(css).toMatch(/@keyframes hr-pending-shake/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\.hr-pending-shake \{\s*animation: none;/);
  });
});
