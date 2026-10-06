// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import { WOVEN_SAMPLE_DATASET as SAMPLE } from "@/data/demo/woven";
import { parseChangeQuery, parseDirectoryQuery, queryChanges, queryDirectory } from "@/lib/employees/woven/views";
import type { ViewData, WovenViewProps } from "./load";
import { sampleAccessPlan } from "./sample-plan";
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

describe("Employee Directory: the status dropdown and the change label", () => {
  const data = (params: Record<string, string | string[]> = {}): ViewData => ({
    view: "directory",
    page: queryDirectory(SAMPLE.directory, parseDirectoryQuery(params)),
  });

  it("sits beside Location and Position, with counts, and keeps the current selection", () => {
    renderView(sampleProps(data({ status: "terminated" })), { status: "terminated" });
    const select = screen.getByRole("combobox", { name: /Status/ }) as HTMLSelectElement;
    expect(select.name).toBe("status");
    expect(select.value).toBe("terminated");
    const active = SAMPLE.directory.filter((r) => r.employmentStatus === "active").length;
    expect([...select.options].map((o) => o.textContent)).toEqual([
      `All statuses (${SAMPLE.directory.length})`,
      `Active (${active})`,
      "Terminated (2)",
      "Unknown (0)",
    ]);
    /* The same form carries search, location and position, so changing status keeps them. */
    const form = select.form!;
    expect(["q", "status", "location", "position"].every((n) => form.elements.namedItem(n) !== null)).toBe(true);
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows).toHaveLength(2);
  });

  it("chip and page links keep the chosen status", () => {
    renderView(sampleProps(data({ status: "active" })), { status: "active" });
    const chip = screen.getByRole("link", { name: /Multiple locations/ });
    expect(chip.getAttribute("href")).toContain("status=active");
  });

  it("says Initial import for the first load and New hire for a hire, keeping the code in the title", () => {
    const initial = { ...SAMPLE.directory[1]!, lastChangeKind: "new_employee" as const, lastChangeClassification: "initial_load", lastChangeAt: "2026-09-29T22:50:56Z" };
    const rowsIn = [SAMPLE.directory[0]!, initial];
    renderView(sampleProps({ view: "directory", page: queryDirectory(rowsIn, parseDirectoryQuery({})) }));
    const table = screen.getByRole("table");
    expect(within(table).getByText("Initial import").getAttribute("title")).toBe("new_employee · initial_load");
    expect(within(table).getByText("New hire").getAttribute("title")).toBe("new_employee · new_hire");
    expect(within(table).queryByText("new_employee")).toBeNull();
  });
});

describe("Directory mapping column", () => {
  it("shows Corporate staff as '[position] + All locations', and salon rows as before", () => {
    const corporate = {
      ...SAMPLE.directory.find((r) => r.lastName === "Farthing")!,
      primaryLocationName: "JB & Associates - Corporate",
      primaryLocationMappingStatus: "ignored" as const,
      positionName: "Maintenance",
      hasAllLocationAccess: true,
    };
    const salon = SAMPLE.directory.find((r) => r.lastName === "Quintero")!;
    renderView(sampleProps({ view: "directory", page: queryDirectory([corporate, salon], parseDirectoryQuery({})) }));
    const table = screen.getByRole("table");
    const badge = within(table).getByText("Maintenance + All locations");
    expect(badge.getAttribute("title")).toContain("is not a salon");
    expect(within(table).getByText("Mapped")).toBeTruthy();
    expect(within(table).queryByText("Position + location")).toBeNull();
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
  const plan = sampleAccessPlan(SAMPLE);
  const data: ViewData = {
    view: "preview",
    plan: { state: "ready", plan },
    accessMode: "off",
    actionFilter: null,
    loginEmailDomains: [...SAMPLE.loginEmailDomains],
    sampleRows: [...SAMPLE.accessPreview],
    applyHistory: null,
  };

  it("says it is read-only, names the access mode, and shows the guard verdict", () => {
    renderView(sampleProps(data));
    expect(screen.getByText("What the access sync would do — read-only")).toBeTruthy();
    expect(screen.getByText("off (preview only)")).toBeTruthy();
    expect(screen.getByText(/Safety guards:/)).toBeTruthy();
  });

  it("shows every column the owner asked for, one row per employee or account", () => {
    const { container } = renderView(sampleProps(data));
    for (const header of [
      "Employee", "Woven ID", "Email", "Woven status", "Woven position", "Woven primary location", "Ask Sunny account",
      "Current role", "Current scope / salon", "Proposed role", "Proposed salon", "Proposed action", "Reason",
    ]) {
      expect(screen.getByRole("columnheader", { name: header })).toBeTruthy();
    }
    expect(container.querySelectorAll("tbody tr[data-actions]").length).toBe(plan.rows.length);
  });

  it("filters by action: only rows carrying that action, with a chip per action present", () => {
    const action = plan.rows.find((r) => r.actions[0] !== "NO_CHANGE")!.actions[0]!;
    const { container } = renderView(sampleProps({ ...data, actionFilter: action } as ViewData));
    const shown = [...container.querySelectorAll("tbody tr[data-actions]")];
    expect(shown.length).toBe(plan.rows.filter((r) => r.actions.includes(action)).length);
    for (const tr of shown) expect(tr.getAttribute("data-actions")!.split(" ")).toContain(action);
    expect(screen.getByRole("navigation", { name: "Filter by proposed action" })).toBeTruthy();
  });

  it("the 'would change access' filter shows only mutating rows", () => {
    const { container } = renderView(sampleProps({ ...data, actionFilter: "changes" } as ViewData));
    for (const tr of container.querySelectorAll("tbody tr[data-actions]")) {
      expect(tr.getAttribute("data-actions")).toMatch(/CREATE_USER|UPDATE_PRIMARY_LOCATION|UPDATE_ROLE|DISABLE_TERMINATED/);
    }
  });

  it("an existing login that only shares an email is shown as an unconfirmed link, never as a change", () => {
    const { container } = renderView(sampleProps({ ...data, actionFilter: "FLAG_LINK_REVIEW" } as ViewData));
    if (plan.counts.FLAG_LINK_REVIEW > 0) {
      expect(container.textContent).toContain("email match, unconfirmed");
      expect(container.textContent).toContain("A person must confirm the link before Woven manages it.");
    }
  });

  it("LINK REVIEW: one card per exact-email match, Ask Sunny account ↔ Woven EmployeeID, everything disabled on sample data", () => {
    const pending = plan.rows.filter((r) => r.actions.includes("FLAG_LINK_REVIEW"));
    expect(pending.length).toBeGreaterThan(0);
    renderView(sampleProps(data));
    const panel = screen.getByRole("region", { name: "Link review" });
    expect(within(panel).getByText(`Link review · ${pending.length}`)).toBeTruthy();
    for (const row of pending) expect(panel.textContent).toContain(`EmployeeID ${row.externalEmployeeId}`);
    for (const control of [...within(panel).getAllByRole("button"), ...within(panel).getAllByRole("checkbox")]) {
      expect((control as HTMLButtonElement).disabled).toBe(true);
    }
  });

  it("LINK REVIEW (live): Confirm stays disabled until the same-person box is ticked, then posts the decision in the body", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ status: "linked" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    renderView({ ...sampleProps(data), sampleLabel: null, liveMode: true });
    const panel = screen.getByRole("region", { name: "Link review" });
    const card = within(panel).getAllByRole("listitem")[0]!;
    const confirm = within(card).getByRole("button", { name: "Confirm link" }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.click(within(card).getByRole("checkbox", { name: /are the same person/ }));
    expect(confirm.disabled).toBe(false);
    fireEvent.click(confirm);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/admin/employees/woven/links");
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({ decision: "confirm", samePersonConfirmed: true, managedStatus: false, managedLocation: false, managedRole: false });
    expect(url).not.toContain("@");
    vi.unstubAllGlobals();
  });

  it("says plainly when the access-sync migration has not been applied", () => {
    renderView(sampleProps({ ...data, plan: { state: "not_applied" } } as ViewData));
    expect(screen.getByText("The access-sync migration has not been applied")).toBeTruthy();
  });

  it("checks an email against the sample rows, as a preview", async () => {
    renderView(sampleProps(data));
    fireEvent.change(screen.getByLabelText("Email address"), { target: { value: "marisol.quintero@sample-salons.test" } });
    fireEvent.click(screen.getByRole("button", { name: "Check" }));
    expect(await screen.findByText("Eligible")).toBeTruthy();
    expect(screen.getByText("Preview only. No account is created in this phase.")).toBeTruthy();
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
