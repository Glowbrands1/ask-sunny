// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { EMPTY_FILTERS } from "@/lib/analytics/filters";
import type { LeaderRow, LocationRow } from "@/lib/analytics/queries";
import { LeadersTable, LocationsTable } from "./tables";

/**
 * THE OVERVIEW CARDS, AFTER THE SPACING PASS.
 *
 * REPORTED: "Activity and Leaders are pushed too far right", "very large empty
 * gaps between Leader, Role and Activity", "the cards feel stretched". All of
 * it was one cause — a `width: 100%` table with automatic layout hands its
 * spare width to every column in proportion, and in a 550px card holding three
 * two-digit figures almost all the width is spare.
 *
 * The fix is `data-width` on the columns that should shrink to their content,
 * so one flexible column absorbs the rest. These tests pin the structure that
 * produces it — and, more importantly, pin that NOTHING WAS LOST making the
 * cards tighter, which is the failure mode of a layout pass.
 */

const LOCATION: LocationRow = {
  salonId: "11111111-1111-4111-8111-111111111111",
  salonNumber: "0306",
  storeName: "MO Kansas City Wornall",
  district: "Patterson, Madeline",
  events: 12,
  activeLeaders: 3,
  assignedLeaders: 5,
  forms: 4,
  reports: 1,
  topCategory: "coaching_guidance",
  lastActive: "2026-09-15T10:00:00.000Z",
};

const SILENT_LOCATION: LocationRow = {
  ...LOCATION,
  salonId: "22222222-2222-4222-8222-222222222222",
  storeName: "TN Oak Ridge",
  events: 0,
  activeLeaders: 0,
  lastActive: null,
};

const LEADER: LeaderRow = {
  userId: "33333333-3333-4333-8333-333333333333",
  displayName: "Pau",
  role: "regional_manager",
  status: "active",
  salonId: LOCATION.salonId,
  storeName: "MO Kansas City Wornall",
  district: "Patterson, Madeline",
  events: 9,
  forms: 2,
  documents: 0,
  chatEvents: 7,
  topCategory: "daily_stats",
  lastActive: "2026-09-15T10:00:00.000Z",
};

const INVITED_LEADER: LeaderRow = {
  ...LEADER,
  userId: "44444444-4444-4444-8444-444444444444",
  displayName: "Curt Bowen",
  status: "invited",
  events: 0,
  forms: 0,
  chatEvents: 0,
  topCategory: null,
  lastActive: null,
};

afterEach(cleanup);

function locations(compact = true) {
  return render(
    <LocationsTable
      rows={[LOCATION, SILENT_LOCATION]}
      filters={EMPTY_FILTERS}
      base="/admin/analytics/locations"
      compact={compact}
    />,
  );
}

function leaders(compact = true) {
  return render(
    <LeadersTable
      rows={[LEADER, INVITED_LEADER]}
      filters={EMPTY_FILTERS}
      base="/admin/analytics/leaders"
      compact={compact}
    />,
  );
}

/* ------------------------------------------------------- nothing was lost -- */

describe("both Overview cards still render everything they did", () => {
  it("keeps the location columns and their values", () => {
    locations();
    for (const heading of ["Location", "Activity", "Leaders"]) {
      expect(screen.getByRole("columnheader", { name: heading })).toBeDefined();
    }
    /*
     * SCOPED TO ITS OWN ROW. Both fixtures carry "/ 5" — one salon has three of
     * five leaders active and the other none — so a page-wide query finds two.
     * Asserting within the row is also the more honest check: it proves the
     * figures sit in the row they describe.
     */
    const link = screen.getByRole("link", { name: "MO Kansas City Wornall" });
    const row = link.closest("tr");
    expect(row).not.toBeNull();

    expect(within(row!).getByText("12")).toBeDefined();
    /* Active out of assigned, which is the half that is actionable. */
    expect(within(row!).getByText("3")).toBeDefined();
    expect(within(row!).getByText(/\/\s*5/)).toBeDefined();
  });

  it("keeps the leader columns and their values", () => {
    leaders();
    for (const heading of ["Leader", "Role", "Activity"]) {
      expect(screen.getByRole("columnheader", { name: heading })).toBeDefined();
    }
    const link = screen.getByRole("link", { name: "Pau" });
    const row = link.closest("tr");
    expect(row).not.toBeNull();

    /* Both fixtures are Regional Managers, so this is scoped too. */
    expect(within(row!).getByText("Regional Manager")).toBeDefined();
    expect(within(row!).getByText("9")).toBeDefined();
  });

  it("keeps the No activity and Invited badges", () => {
    leaders();
    expect(screen.getAllByText(/no activity/i).length).toBeGreaterThan(0);
    expect(screen.getByText("Invited")).toBeDefined();
  });

  it("keeps every full-view column when not compact", () => {
    leaders(false);
    for (const heading of [
      "Leader",
      "Role",
      "Location",
      "Activity",
      "Forms",
      "Questions",
      "Top use",
      "Last active",
    ]) {
      expect(screen.getByRole("columnheader", { name: heading })).toBeDefined();
    }
  });
});

/* --------------------------------------------------- deliberate columns ---- */

describe("columns are sized deliberately rather than stretched", () => {
  it("shrinks the numeric location columns and leaves Location flexible", () => {
    const { container } = locations();

    const flexible = screen.getByRole("columnheader", { name: "Location" });
    expect(flexible.getAttribute("data-width")).toBeNull();

    for (const heading of ["Activity", "Leaders"]) {
      const header = screen.getByRole("columnheader", { name: heading });
      expect(header.getAttribute("data-width"), heading).toBe("compact");
      expect(header.getAttribute("data-align"), heading).toBe("right");
    }

    /* The body cells carry it too, or the column still stretches. */
    const compactCells = container.querySelectorAll('td[data-width="compact"]');
    expect(compactCells.length).toBeGreaterThanOrEqual(4);
  });

  it("sizes Role to its label and keeps Leader flexible", () => {
    leaders();

    expect(
      screen.getByRole("columnheader", { name: "Leader" }).getAttribute("data-width"),
    ).toBeNull();
    expect(
      screen.getByRole("columnheader", { name: "Role" }).getAttribute("data-width"),
    ).toBe("fit");

    const activity = screen.getByRole("columnheader", { name: "Activity" });
    expect(activity.getAttribute("data-width")).toBe("compact");
    expect(activity.getAttribute("data-align")).toBe("right");
  });

  it("right-aligns every numeric column consistently", () => {
    const { container } = leaders(false);
    for (const heading of ["Activity", "Forms", "Questions"]) {
      expect(
        screen.getByRole("columnheader", { name: heading }).getAttribute("data-align"),
        heading,
      ).toBe("right");
    }
    /* No numeric column is left-aligned by omission. */
    const numericCells = container.querySelectorAll('td[data-align="right"]');
    expect(numericCells.length).toBeGreaterThanOrEqual(6);
  });
});

/* ------------------------------------------------------- identity group ---- */

describe("a name and the badges about it read as one thing", () => {
  it("keeps Curt Bowen, No activity and Invited in a single group", () => {
    /*
     * THE REPORTED SYMPTOM: they read as "three items spread across the card".
     * Being inside one inline-flex element is what makes them one identity and
     * what lets them wrap together rather than stranding a badge on its own
     * line in a narrow column.
     */
    leaders();
    const link = screen.getByRole("link", { name: "Curt Bowen" });
    const group = link.parentElement;

    expect(group).not.toBeNull();
    expect(group!.className).toContain("inline-flex");
    expect(within(group!).getByText("Invited")).toBeDefined();
    expect(within(group!).getByText(/no activity/i)).toBeDefined();
  });

  it("groups a silent location with its badge too", () => {
    locations();
    const link = screen.getByRole("link", { name: "TN Oak Ridge" });
    const group = link.parentElement;

    expect(group!.className).toContain("inline-flex");
    expect(within(group!).getByText(/no activity/i)).toBeDefined();
  });
});

/* ------------------------------------------------------------ responsive --- */

describe("the cards still behave on a narrow screen", () => {
  it("keeps a compact card narrow enough for a stacked phone layout", () => {
    /*
     * The two cards stack below `xl`, so a compact table has the full page
     * width on a phone. Its floor stays 380px — comfortably inside a 400px
     * viewport minus gutters — so stacking does not introduce a sideways
     * scroll that was not there before.
     */
    const { container } = locations();
    const table = container.querySelector("table");
    expect(table?.className).toContain("min-w-[380px]");
  });

  it("wraps the wide full-view table in a scroller rather than the page", () => {
    /*
     * A full table is genuinely wider than a phone. It scrolls inside its own
     * container — which is the one place horizontal scrolling is right, and is
     * why the page itself never does.
     */
    const { container } = leaders(false);
    const scroller = container.querySelector(".overflow-x-auto");
    expect(scroller).not.toBeNull();
    expect(scroller!.querySelector("table")).not.toBeNull();
  });
});
