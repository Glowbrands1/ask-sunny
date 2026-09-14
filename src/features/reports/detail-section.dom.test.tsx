// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { AdminOnly, ExplainerNote, ReportDetailSection } from "./detail-section";

afterEach(cleanup);

/**
 * The 14 September review, on every report tab:
 *
 *   "Every report currently opens at maximum detail... The detailed work is
 *    valuable; it just should not be the landing view."
 *
 * and, on the diagnostics:
 *
 *   "'Data Source & Quality,' including the parser name, parser version, and
 *    source columns, is engineering-facing information and should be
 *    admin-only."
 */

describe("the detail section hides nothing — it defers it", () => {
  it("keeps the content in the document, so find-in-page still reaches it", () => {
    render(
      <ReportDetailSection title="Sessions by salon and equipment" weight="57 rows">
        <p>MO Kansas City Wornall</p>
      </ReportDetailSection>,
    );
    // Present but not expanded: nothing was dropped from the markup.
    expect(screen.getByText("MO Kansas City Wornall")).toBeTruthy();
    expect(document.querySelector("details")?.open).toBe(false);
  });

  it("says how much is inside before it is opened", () => {
    render(
      <ReportDetailSection title="Sessions by salon and equipment" weight="57 rows">
        <p>rows</p>
      </ReportDetailSection>,
    );
    expect(screen.getByText("57 rows")).toBeTruthy();
    expect(screen.getByText("Sessions by salon and equipment")).toBeTruthy();
  });

  it("opens by default when asked, for a table short enough not to need hiding", () => {
    render(
      <ReportDetailSection title="All measures by salon" defaultOpen>
        <p>one salon</p>
      </ReportDetailSection>,
    );
    expect(document.querySelector("details")?.open).toBe(true);
  });

  it("is a native disclosure, so it works without JavaScript and by keyboard", () => {
    render(
      <ReportDetailSection title="Salon detail">
        <p>rows</p>
      </ReportDetailSection>,
    );
    expect(document.querySelector("details > summary")).toBeTruthy();
  });
});

describe("a paragraph defending a metric sits behind one line", () => {
  it("shows the label and keeps the explanation available", () => {
    render(
      <ExplainerNote label="What PPTA is, and what it is not">
        <span>Product sales divided by total tans.</span>
      </ExplainerNote>,
    );
    expect(screen.getByText("What PPTA is, and what it is not")).toBeTruthy();
    expect(screen.getByText("Product sales divided by total tans.")).toBeTruthy();
    expect(document.querySelector("details")?.open).toBe(false);
  });
});

describe("engineering lineage is admin-only", () => {
  it("renders nothing for a manager", () => {
    render(
      <AdminOnly isAdmin={false}>
        <p>Parser sales_totals_daily v1</p>
      </AdminOnly>,
    );
    /*
     * NOT PRESENT AND HIDDEN — absent. A parser key in the markup with
     * `display:none` is still in the page a reader can read.
     */
    expect(screen.queryByText("Parser sales_totals_daily v1")).toBeNull();
    expect(document.body.textContent).not.toContain("sales_totals_daily");
  });

  it("renders it for an administrator", () => {
    render(
      <AdminOnly isAdmin>
        <p>Parser sales_totals_daily v1</p>
      </AdminOnly>,
    );
    expect(screen.getByText("Parser sales_totals_daily v1")).toBeTruthy();
  });
});
