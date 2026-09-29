// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import { WOVEN_SAMPLE_DATASET as SAMPLE } from "@/data/demo/woven";
import { accessDrift, parseChangeQuery, parseDirectoryQuery, queryChanges, queryDirectory } from "@/lib/employees/woven/views";
import type { ViewData, WovenViewProps } from "./load";
import { WovenViewScreen } from "./woven-view-screen";

/**
 * The five tabs beyond the Overview, rendered as a demo build renders them
 * (the labelled sample set) and as a live deployment renders them before the
 * migration exists.
 */

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function sampleProps(data: ViewData, overrides: Partial<WovenViewProps> = {}): WovenViewProps {
  return { view: data.view, sampleLabel: SAMPLE.label, liveMode: false, content: { state: "ready", data }, ...overrides };
}

function renderView(props: WovenViewProps, params: Record<string, string | string[]> = {}) {
  return render(<WovenViewScreen props={props} params={params} />);
}

describe("Employee Directory", () => {
  const data = (params: Record<string, string | string[]> = {}): ViewData => ({
    view: "directory",
    page: queryDirectory(SAMPLE.directory, parseDirectoryQuery(params)),
  });

  it("shows every column the design lists", () => {
    renderView(sampleProps(data()));
    const headers = screen.getAllByRole("columnheader").map((h) => h.textContent);
    expect(headers).toEqual([
      "Woven ID",
      "Name",
      "Work email",
      "Status",
      "Position",
      "Position ID",
      "Primary location",
      "Additional locations",
      "Temporary or expiring access",
      "Hire date",
      "Termination date",
      "Last seen in Woven",
      "Last synced",
      "Last change",
      "Mapping",
    ]);
    expect(screen.getAllByRole("row")).toHaveLength(SAMPLE.directory.length + 1);
  });

  it("offers the nine filters as links that toggle, with counts", () => {
    renderView(sampleProps(data({ filter: "active" })), { filter: "active" });
    const filters = screen.getByRole("list", { name: "Filters" });
    const links = within(filters).getAllByRole("link");
    expect(links.map((l) => l.textContent?.replace(/\d+$/, ""))).toEqual([
      "Active",
      "Terminated",
      "New hire",
      "Position changed",
      "Transfer",
      "Multiple locations",
      "Missing email",
      "Unmapped position",
      "Unmapped location",
    ]);
    const active = links[0];
    expect(active.getAttribute("aria-pressed")).toBe("true");
    expect(active.getAttribute("href")).toBe("/admin/integrations/woven/directory");
    expect(links[1].getAttribute("href")).toBe("/admin/integrations/woven/directory?filter=active&filter=terminated");
  });

  it("marks a missing email, shows expiring access with its date, and never says 'borrowed'", () => {
    const { container } = renderView(sampleProps(data()));
    expect(screen.getAllByText("missing").length).toBeGreaterThan(0);
    expect(container.textContent).toContain("expires Oct 12, 2026");
    expect(container.textContent).not.toMatch(/borrow/i);
  });

  it("carries the sample banner on every tab", () => {
    renderView(sampleProps(data()));
    expect(screen.getByTestId("woven-sample-banner")).toBeTruthy();
  });
});

describe("Change Feed", () => {
  const data: ViewData = { view: "changes", page: queryChanges(SAMPLE.changes, parseChangeQuery({})) };

  it("offers every change type, including the normalised names", () => {
    renderView(sampleProps(data));
    const chips = within(screen.getByRole("list", { name: "Change type" })).getAllByRole("link").map((l) => l.textContent?.replace(/\d+$/, "").trim());
    expect(chips).toEqual([
      "All",
      "new_employee",
      "terminated",
      "reactivated",
      "position_changed",
      "primary_location_changed",
      "location_access_added",
      "location_access_removed",
      "email_changed",
      "missing_from_source",
    ]);
  });

  it("shows the columns the design lists, and says when Woven stated no effective date", () => {
    renderView(sampleProps(data));
    expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).toEqual([
      "Employee",
      "Change type",
      "Classification",
      "Old value",
      "New value",
      "Effective date",
      "Detected at",
      "Sync run",
      "Review",
    ]);
    expect(screen.getAllByText("Not stated by Woven").length).toBeGreaterThan(0);
    expect(screen.getByText("promotion_confirmed")).toBeTruthy();
    expect(screen.getByText("unclassified")).toBeTruthy();
  });

  it("disables review on sample data", () => {
    renderView(sampleProps(data));
    for (const button of screen.getAllByRole("button", { name: /acknowledge|dismiss|reopen/i })) {
      expect((button as HTMLButtonElement).disabled).toBe(true);
    }
  });

  it("enables review on real data in live mode, and sends only the review status", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ status: "reviewed" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    renderView({ ...sampleProps(data), sampleLabel: null, liveMode: true });
    fireEvent.click(screen.getAllByRole("button", { name: "Acknowledge" })[0]);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/^\/api\/admin\/employees\/woven\/changes\//);
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(String(init.body))).toEqual({ reviewStatus: "acknowledged" });
  });
});

describe("Sync History", () => {
  it("shows one row per run with every column the design lists", () => {
    renderView(sampleProps({ view: "runs", runs: [...SAMPLE.runs] }));
    expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).toEqual([
      "Started",
      "Completed",
      "Status",
      "Source",
      "Fetched",
      "Added",
      "Updated",
      "New hires",
      "Terminations",
      "Position changes",
      "Transfers",
      "Location access",
      "Errors",
      "Error summary",
    ]);
    expect(screen.getAllByRole("row")).toHaveLength(SAMPLE.runs.length + 1);
    expect(screen.getAllByText("polling · scheduled").length).toBeGreaterThan(0);
    expect(screen.getByText("polling · manual")).toBeTruthy();
    expect(screen.getByText("unexpectedly_small")).toBeTruthy();
    expect(screen.getByText("Refused")).toBeTruthy();
  });
});

describe("Mappings", () => {
  const data: ViewData = { view: "mappings", locations: [...SAMPLE.locations], positions: [...SAMPLE.positions] };

  it("says mappings are applied nowhere, and shows suggestions and non-locations", () => {
    const { container } = renderView(sampleProps(data));
    expect(screen.getByText("Mappings are reviewed here and applied nowhere in this phase")).toBeTruthy();
    expect(container.textContent).toContain("S103 · Sample Salon Lakeview");
    expect(screen.getByText("Suggest ignore")).toBeTruthy();
    expect(screen.getAllByText("No exact number match").length).toBeGreaterThan(0);
  });

  it("shows positions with role, scope and rank, and disables every form on sample data", () => {
    renderView(sampleProps(data));
    expect(screen.getAllByText("confirmed").length).toBe(4);
    for (const control of [...screen.getAllByRole("button"), ...screen.getAllByRole("combobox"), ...screen.getAllByRole("textbox")]) {
      expect((control as HTMLButtonElement).disabled, control.outerHTML.slice(0, 60)).toBe(true);
    }
  });
});

describe("Access Preview", () => {
  const data: ViewData = {
    view: "preview",
    rows: [...SAMPLE.accessPreview],
    drift: accessDrift(SAMPLE.accessPreview),
    loginEmailDomains: [...SAMPLE.loginEmailDomains],
    sampleRows: [...SAMPLE.accessPreview],
  };

  it("says it is read-only and counts what each later phase would do", () => {
    renderView(sampleProps(data));
    expect(screen.getByText("What later phases would do — read-only")).toBeTruthy();
    expect(screen.getByText("Logins disabled (phase 3)")).toBeTruthy();
  });

  it("checks an email against the sample rows, as a preview", async () => {
    renderView(sampleProps(data));
    fireEvent.change(screen.getByLabelText("Email address"), { target: { value: "marisol.quintero@sample-salons.test" } });
    fireEvent.click(screen.getByRole("button", { name: "Check" }));
    expect(await screen.findByText("Eligible")).toBeTruthy();
    expect(screen.getByText("Preview only. No account is created in this phase.")).toBeTruthy();
  });

  it("lists the disagreements with what a later phase would do", () => {
    const { container } = renderView(sampleProps(data));
    expect(container.textContent).toContain("Phase 3: disable the login (Woven: terminated)");
    expect(container.textContent).toContain("Phase 4: change role to salon director");
  });

  it("in live mode, posts the email in the body — never the URL", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ status: "ok", result: { verdict: "not_eligible", reasons: ["x"], employee: null, previewOnly: true } }), {
          status: 200,
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    renderView({ ...sampleProps({ ...data, sampleRows: null } as ViewData), sampleLabel: null, liveMode: true });
    fireEvent.change(screen.getByLabelText("Email address"), { target: { value: "a@b.test" } });
    fireEvent.click(screen.getByRole("button", { name: "Check" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/admin/employees/woven/eligibility");
    expect(url).not.toContain("a@b.test");
    expect(init.method).toBe("POST");
  });
});

describe("database states", () => {
  const base = { view: "directory" as const, sampleLabel: null, liveMode: true };

  it("a missing migration is said as such", () => {
    renderView({ ...base, content: { state: "missing" } });
    expect(screen.getByText("The Woven directory has not been created yet")).toBeTruthy();
  });

  it("a database that did not answer is not called missing", () => {
    renderView({ ...base, content: { state: "unavailable", code: "57014" } });
    expect(screen.getByText("The Woven directory could not be read")).toBeTruthy();
    expect(screen.getByText(/57014/)).toBeTruthy();
  });

  it("no sample banner on real data", () => {
    renderView({ ...base, content: { state: "missing" } });
    expect(screen.queryByTestId("woven-sample-banner")).toBeNull();
  });
});
