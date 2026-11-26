// @vitest-environment jsdom
import * as React from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EmployeeFormSearchBox, EmployeeFormSearchResults, type EmployeeSearchRow } from "./employee-form-search";
import { REGISTER_HREF } from "./words";

/*
 * The forms list's employee search, rendered (leadership meeting, 24 Nov 2026): a box that searches by name, and the
 * person's forms — drafts included — each with its date and a View link to the form. Invented names only.
 */

vi.mock("@/lib/session/session-context", () => ({
  useSession: () => ({ user: { name: "Rowan Kestrel" }, role: "admin" }),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

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

  it("lists every form for the person, drafts included, with the date and a View button", () => {
    render(<EmployeeFormSearchResults query="Wren Oakhollow" searchable rows={ROWS} capped={false} />);
    expect(screen.getByText(/2 forms for .Wren Oakhollow., newest first/)).toBeTruthy();
    const rows = screen.getAllByRole("row").slice(1);
    expect(within(rows[0]).getByText("Draft")).toBeTruthy();
    expect(within(rows[0]).getAllByText("Nov 20, 2026", { selector: "td" }).length).toBe(2); // form date and created
    expect(within(rows[1]).getByText("Finalized")).toBeTruthy();
    expect(within(rows[1]).getByText("Approved by HR")).toBeTruthy();
    expect(within(rows[1]).getByRole("button", { name: /View Corrective Action — Wren Oakhollow, Feb 10, 2026/ })).toBeTruthy();
    // Not a link to another page: the form page does not exist while FORM_REVISIONS_ENABLED is off in production.
    expect(within(rows[1]).queryByRole("link")).toBeNull();
  });

  /*
   * Pau, 26 Nov 2026, of the View link opening "That screen does not exist": "when i click view it says this, i just
   * need a preview pop up please not another tabv".
   */
  it("View opens the form in a pop-up over the list, fetched as a preview (not an export)", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, blob: async () => new Blob(["%PDF-1.4"], { type: "application/pdf" }) }) as unknown as Response);
    vi.stubGlobal("fetch", fetchMock);
    const created = vi.fn(() => "blob:preview-1");
    const revoked = vi.fn();
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: created, revokeObjectURL: revoked }));
    const open = vi.fn();
    vi.stubGlobal("open", open);

    render(<EmployeeFormSearchResults query="Wren Oakhollow" searchable rows={ROWS} capped={false} />);
    fireEvent.click(screen.getAllByRole("button", { name: /^View / })[1]);

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Corrective Action — Wren Oakhollow, Feb 10, 2026", { selector: "h2" })).toBeTruthy();
    await waitFor(() => expect(screen.getByRole("dialog").querySelector("iframe")?.getAttribute("src")).toBe("blob:preview-1"));
    expect(fetchMock).toHaveBeenCalledWith("/api/forms/instances/final-1/pdf?preview=1", expect.anything());
    expect(open).not.toHaveBeenCalled();
  });

  it("says why when the form cannot be opened", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "That form is not on file." }), { status: 404 })));
    render(<EmployeeFormSearchResults query="Wren Oakhollow" searchable rows={ROWS} capped={false} />);
    fireEvent.click(screen.getAllByRole("button", { name: /^View / })[0]);
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "That form is not on file.");
  });

  it("says so when nothing is on file, and asks for two letters when too little was typed", () => {
    render(<EmployeeFormSearchResults query="Zed Nobody" searchable rows={[]} capped={false} />);
    expect(screen.getByText(/No forms on file for .Zed Nobody./)).toBeTruthy();
    cleanup();
    render(<EmployeeFormSearchResults query="z" searchable={false} rows={[]} capped={false} />);
    expect(screen.getByText(/at least two letters/)).toBeTruthy();
  });
});
