// @vitest-environment jsdom
import * as React from "react";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { EmployeeFormSearchBox, EmployeeFormSearchResults, type EmployeeSearchRow } from "./employee-form-search";
import { formPageHref } from "./form-page-href";
import { REGISTER_HREF } from "./words";

/*
 * The forms list's employee search, rendered (leadership meeting, 24 Nov 2026): a box that searches by name, and the
 * person's forms — drafts included — each with its date and a View link to the form. Invented names only.
 */

afterEach(cleanup);

const ROWS: EmployeeSearchRow[] = [
  {
    id: "draft-1",
    employeeName: "Wren Oakhollow",
    formName: "Corrective Action",
    variantKey: null,
    status: "draft",
    hrNote: null,
    formDate: "2026-11-20",
    createdAt: "2026-11-20T15:00:00Z",
    locationName: "Location A",
    createdByName: "You",
  },
  {
    id: "final-1",
    employeeName: "Wren Oakhollow",
    formName: "Corrective Action",
    variantKey: null,
    status: "finalized",
    hrNote: "Approved by HR",
    formDate: "2026-02-10",
    createdAt: "2026-02-10T15:00:00Z",
    locationName: "Location A",
    createdByName: "Pella Brightwater",
  },
];

describe("the employee search", () => {
  it("is a GET search on the forms list, keeping what was typed", () => {
    render(<EmployeeFormSearchBox query="wren" />);
    const form = screen.getByRole("search");
    expect(form.getAttribute("action")).toBe(REGISTER_HREF);
    expect(form.getAttribute("method")).toBe("get");
    const box = screen.getByRole("searchbox", { name: "Employee name" }) as HTMLInputElement;
    expect(box.name).toBe("employee");
    expect(box.value).toBe("wren");
    expect(screen.getByRole("link", { name: "Clear" }).getAttribute("href")).toBe(REGISTER_HREF);
    const filter = screen.getByRole("combobox", { name: "Show" }) as HTMLSelectElement;
    expect(filter.name).toBe("status");
    expect([...filter.options].map((option) => option.text)).toEqual(["All forms", "Drafts", "Finalized", "Approved by HR"]);
  });

  it("keeps the chosen filter, and says so when it hides every form", () => {
    render(<EmployeeFormSearchBox query="wren" status="draft" />);
    expect((screen.getByRole("combobox", { name: "Show" }) as HTMLSelectElement).value).toBe("draft");
    cleanup();
    render(<EmployeeFormSearchResults query="Wren" searchable rows={[]} capped={false} filtered />);
    expect(screen.getByText(/match this filter/)).toBeTruthy();
  });

  it("lists every form for the person, drafts included, with the date and a View link", () => {
    render(<EmployeeFormSearchResults query="Wren Oakhollow" searchable rows={ROWS} capped={false} />);
    expect(screen.getByText(/2 forms for .Wren Oakhollow., newest first/)).toBeTruthy();
    const rows = screen.getAllByRole("row").slice(1);
    expect(within(rows[0]).getByText("Draft")).toBeTruthy();
    expect(within(rows[0]).getAllByText("Nov 20, 2026", { selector: "td" }).length).toBe(2); // form date and created
    expect(within(rows[1]).getByText("Finalized")).toBeTruthy();
    expect(within(rows[1]).getByText("Approved by HR")).toBeTruthy();
    const view = within(rows[1]).getByRole("link", { name: /View the Corrective Action for Wren Oakhollow dated Feb 10, 2026/ });
    expect(view.getAttribute("href")).toBe(formPageHref("final-1"));
  });

  it("says so when nothing is on file, and asks for two letters when too little was typed", () => {
    render(<EmployeeFormSearchResults query="Zed Nobody" searchable rows={[]} capped={false} />);
    expect(screen.getByText(/No forms on file for .Zed Nobody./)).toBeTruthy();
    cleanup();
    render(<EmployeeFormSearchResults query="z" searchable={false} rows={[]} capped={false} />);
    expect(screen.getByText(/at least two letters/)).toBeTruthy();
  });
});
