// @vitest-environment jsdom
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import type { WovenSyncStatus } from "@/lib/employees/woven/status";
import type { OverviewCounts } from "@/lib/employees/woven/view-types";
import { cronDeployed, type WovenSyncPageProps } from "./load";
import { stepsFor, WovenSyncScreen } from "./woven-sync-screen";

/**
 * The Woven Employee Sync screen reports measured and evidenced state, step by
 * step. It never claims Woven is the only thing left, never calls a switch a
 * schedule, never calls every database error a missing table, and never
 * claims an email is login-eligible without a configured login-email rule.
 */

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const BASE: WovenSyncPageProps = {
  enabled: false,
  syncWritesEnabled: false,
  validationEnabled: false,
  validationAccessCodeConfigured: false,
  scheduleEnabled: false,
  scheduleDeployed: false,
  liveMode: true,
  missingCredentials: ["WOVEN_SUBSCRIPTION_KEY", "WOVEN_USERNAME", "WOVEN_PASSWORD"],
  loginEmailDomains: [],
  database: { state: "missing" },
  overview: null,
  sampleLabel: null,
};

function counts(overrides: Partial<OverviewCounts> = {}): OverviewCounts {
  return {
    lastSuccessAt: "2026-10-05T11:31:00Z",
    lastAttemptAt: "2026-10-05T11:30:00Z",
    lastAttemptStatus: "succeeded",
    totalActive: 412,
    totalTerminated: 57,
    totalStatusUnknown: 0,
    newHiresSinceLast: 3,
    initialLoadCount: null,
    terminationsSinceLast: 2,
    positionChangesSinceLast: 4,
    confirmedPromotionsDemotionsSinceLast: 1,
    transfersSinceLast: 1,
    locationAccessAddedSinceLast: 2,
    locationAccessRemovedSinceLast: 1,
    lastRunErrorCount: 0,
    recordsWithIssues: 5,
    unmappedLocations: 3,
    unmappedPositions: 2,
    employeesMissingEmail: 1,
    unreviewedChanges: 9,
    recentRuns: [{ status: "succeeded", employeesFetched: 469 }],
    ...overrides,
  };
}

function status(overrides: Partial<WovenSyncStatus> = {}): WovenSyncStatus {
  return {
    enabled: true,
    scheduleEnabled: false,
    missingCredentials: [],
    problems: [],
    lastSuccessAt: null,
    lastCronSuccessAt: null,
    signInEvidence: null,
    unmappedLocations: 0,
    unreviewedChanges: 0,
    recentRuns: [],
    ...overrides,
  };
}

const step = (props: WovenSyncPageProps, key: string) => stepsFor(props).find((s) => s.key === key)!;

describe("go-live steps", () => {
  it("distinguishes every step and marks none complete from configuration alone", () => {
    const steps = stepsFor(BASE);
    expect(steps.map((s) => s.key)).toEqual(["subscription", "credentials", "signin", "response", "directory", "first", "schedule"]);
    expect(steps.filter((s) => s.state === "done")).toEqual([]);
  });

  it("never says Waiting on Woven, and does not claim Woven is the only dependency", () => {
    const { container } = render(<WovenSyncScreen {...BASE} />);
    expect(container.textContent).not.toMatch(/waiting on woven|only remaining|one remaining dependency/i);
  });

  it("reports the subscription as reported-active until a run proves sign-in, and confirmed after", () => {
    expect(step(BASE, "subscription")).toMatchObject({ state: "reported", label: "Reported active" });
    const signedIn = { ...BASE, missingCredentials: [], database: { state: "ready" as const, status: status({ signInEvidence: "succeeded" }) } };
    expect(step(signedIn, "subscription").state).toBe("done");
    expect(step(signedIn, "signin").state).toBe("done");
    const refused = { ...BASE, database: { state: "ready" as const, status: status({ signInEvidence: "failed" }) } };
    expect(step(refused, "signin").state).toBe("attention");
  });

  it("credentials configured is NOT sign-in succeeded", () => {
    const configured = { ...BASE, missingCredentials: [] };
    expect(step(configured, "credentials").state).toBe("done");
    expect(step(configured, "signin")).toMatchObject({ state: "pending", label: "Not yet confirmed" });
    expect(step(configured, "response").state).toBe("pending");
  });

  it("names missing credential variables, never values", () => {
    expect(step(BASE, "credentials").detail).toContain("WOVEN_SUBSCRIPTION_KEY");
  });

  it("keeps a missing table apart from a database that did not answer", () => {
    expect(step(BASE, "directory")).toMatchObject({ label: "Not created" });
    const down = { ...BASE, database: { state: "unavailable" as const, code: "57014" } };
    expect(step(down, "directory")).toMatchObject({ state: "attention", label: "Could not be read" });
    expect(step(down, "directory").detail).toContain("57014");
    expect(step(down, "directory").detail).toMatch(/not the same as the tables being missing/);
  });

  describe("the daily schedule", () => {
    it("a switch alone is not a schedule", () => {
      const s = step({ ...BASE, scheduleEnabled: true }, "schedule");
      expect(s.state).toBe("attention");
      expect(s.label).toBe("Switch on, not scheduled");
    });

    it("deployed and switched on, without a successful scheduled run, is not complete", () => {
      const s = step({ ...BASE, scheduleEnabled: true, scheduleDeployed: true, database: { state: "ready", status: status({ lastSuccessAt: "2026-10-01T11:00:00Z" }) } }, "schedule");
      expect(s.state).toBe("pending");
    });

    it("is complete only with the entry deployed, the switch on and a scheduled run that succeeded", () => {
      const s = step(
        {
          ...BASE,
          scheduleEnabled: true,
          scheduleDeployed: true,
          database: { state: "ready", status: status({ lastSuccessAt: "2026-10-05T11:31:00Z", lastCronSuccessAt: "2026-10-05T11:31:00Z" }) },
        },
        "schedule",
      );
      expect(s).toMatchObject({ state: "done", label: "Running daily" });
      expect(s.detail).toContain("Oct 5, 6:31 AM");
    });

    it("reads the deployed cron entry from vercel.json, not from a flag", () => {
      expect(cronDeployed({ crons: [{ path: "/api/reviews/apify/cron" }] })).toBe(false);
      expect(cronDeployed({ crons: [{ path: "/api/employees/woven/cron" }] })).toBe(true);
      expect(cronDeployed({})).toBe(false);
    });
  });
});

describe("the screen", () => {
  it("leads with the next step", () => {
    render(<WovenSyncScreen {...BASE} />);
    expect(screen.getByText("Next step: Server-side credentials")).toBeTruthy();
  });

  it("says emails are stored as provided and nobody is login-eligible without WOVEN_LOGIN_EMAIL_DOMAINS", () => {
    const { container } = render(<WovenSyncScreen {...BASE} />);
    expect(screen.getByText("No login-email domain is set")).toBeTruthy();
    expect(container.textContent).toMatch(/nobody is\s+login-eligible/);
    expect(screen.getByText("Email address, as Woven provides it")).toBeTruthy();
    expect(container.textContent).not.toContain("WOVEN_WORK_EMAIL_DOMAINS");
  });

  it("names the login-email domains when they are set, and never presents them as a storage filter", () => {
    const { container } = render(<WovenSyncScreen {...BASE} loginEmailDomains={["suntancity.com"]} />);
    expect(screen.queryByText("No login-email domain is set")).toBeNull();
    expect(container.textContent).toMatch(/Only addresses at suntancity\.com would ever be\s+login-eligible/);
  });

  it("never calls temporary or expiring access 'borrowed'", () => {
    const { container } = render(<WovenSyncScreen {...BASE} />);
    expect(container.textContent).not.toMatch(/borrow/i);
    expect(screen.getByText("Temporary or expiring access, with end date")).toBeTruthy();
  });

  it("shows all six tabs, with the people tabs marked", () => {
    render(<WovenSyncScreen {...BASE} />);
    const nav = screen.getByRole("navigation", { name: "Woven Employee Sync" });
    const links = [...nav.querySelectorAll("a")].map((a) => a.textContent?.trim());
    expect(links).toEqual(["Overview", "Employee Directory", "Change Feed", "Sync History", "Mappings", "Access Preview"]);
    expect(nav.querySelectorAll('[aria-label="Needs Manage users"]')).toHaveLength(4);
    expect(nav.querySelector('[aria-current="page"]')?.textContent).toBe("Overview");
  });

  const validationButton = () => screen.getByRole("button", { name: "Run read-only validation" }) as HTMLButtonElement;
  const syncButton = () => screen.getByRole("button", { name: "Run employee sync" }) as HTMLButtonElement;

  it("shows the connection test and the employee sync as two separate actions", () => {
    render(<WovenSyncScreen {...BASE} />);
    expect(within(screen.getByTestId("woven-validation-panel")).getByRole("heading", { name: "Test Woven connection" })).toBeTruthy();
    expect(within(screen.getByTestId("woven-sync-panel")).getByRole("heading", { name: "Run employee sync" })).toBeTruthy();
    expect(within(screen.getByTestId("woven-validation-panel")).queryByRole("button", { name: "Run employee sync" })).toBeNull();
    expect(within(screen.getByTestId("woven-sync-panel")).queryByRole("button", { name: "Run read-only validation" })).toBeNull();
  });

  it("disables both in demo mode while the sync switch is on, and says why", () => {
    render(<WovenSyncScreen {...BASE} liveMode={false} missingCredentials={[]} enabled validationEnabled validationAccessCodeConfigured />);
    expect(validationButton().disabled).toBe(true);
    expect(syncButton().disabled).toBe(true);
    expect(screen.getByText(/connection test runs only while WOVEN_SYNC_ENABLED is off/)).toBeTruthy();
    expect(screen.queryByLabelText("Access code")).toBeNull();
  });

  it("demo mode without an access code configured: the test stays disabled and names the variable", () => {
    render(<WovenSyncScreen {...BASE} liveMode={false} missingCredentials={[]} validationEnabled />);
    expect(validationButton().disabled).toBe(true);
    expect(screen.getByText(/also needs WOVEN_VALIDATION_ACCESS_CODE set/)).toBeTruthy();
    expect(screen.queryByLabelText("Access code")).toBeNull();
  });

  describe("demo mode with the access code configured", () => {
    const DEMO = { ...BASE, liveMode: false, missingCredentials: [], validationEnabled: true, validationAccessCodeConfigured: true };
    const CODE = "typed-access-code-0000";

    it("shows a password field; the button waits for a code; the sync stays disabled", () => {
      render(<WovenSyncScreen {...DEMO} />);
      const field = screen.getByLabelText("Access code") as HTMLInputElement;
      expect(field.type).toBe("password");
      expect(field.autocomplete).toBe("off");
      expect(validationButton().disabled).toBe(true);
      fireEvent.change(field, { target: { value: CODE } });
      expect(validationButton().disabled).toBe(false);
      expect(syncButton().disabled).toBe(true);
      expect(screen.getByText(/real Woven data, not sample data/)).toBeTruthy();
    });

    it("sends the code in the POST body only — never the URL — stores it nowhere, and clears the field", async () => {
      const fetchMock = vi.fn(async () => new Response(JSON.stringify({ status: "refused", reason: "The access code is missing or incorrect." }), { status: 403 }));
      vi.stubGlobal("fetch", fetchMock);
      const setItem = vi.spyOn(Storage.prototype, "setItem");
      render(<WovenSyncScreen {...DEMO} />);
      fireEvent.change(screen.getByLabelText("Access code"), { target: { value: CODE } });
      fireEvent.click(validationButton());
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toBe("/api/admin/employees/woven/validate");
      expect(url).not.toContain(CODE);
      expect(init.method).toBe("POST");
      expect(JSON.parse(String(init.body))).toEqual({ accessCode: CODE });
      expect(setItem).not.toHaveBeenCalled();
      expect((screen.getByLabelText("Access code") as HTMLInputElement).value).toBe("");
      expect(await screen.findByText("The access code is missing or incorrect.")).toBeTruthy();
      expect(document.body.textContent).not.toContain(CODE);
      setItem.mockRestore();
    });
  });

  it("live mode shows no access-code field and sends no body", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ status: "disabled", reason: "off" }), { status: 409 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<WovenSyncScreen {...BASE} missingCredentials={[]} validationEnabled validationAccessCodeConfigured />);
    expect(screen.queryByLabelText("Access code")).toBeNull();
    fireEvent.click(validationButton());
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body).toBeUndefined();
  });

  it("WOVEN_VALIDATION_ENABLED on, WOVEN_SYNC_ENABLED off: the test runs, the sync stays disabled", () => {
    render(<WovenSyncScreen {...BASE} missingCredentials={[]} validationEnabled enabled={false} />);
    expect(validationButton().disabled).toBe(false);
    expect(syncButton().disabled).toBe(true);
    expect(screen.getByText(/Disabled: WOVEN_SYNC_ENABLED is off for this deployment, so no employee sync can run/)).toBeTruthy();
  });

  it("the sync switch alone does not open the connection test", () => {
    render(<WovenSyncScreen {...BASE} missingCredentials={[]} enabled validationEnabled={false} />);
    expect(validationButton().disabled).toBe(true);
    expect(screen.getByText(/Turn on WOVEN_VALIDATION_ENABLED/)).toBeTruthy();
  });

  it("neither runs without credentials", () => {
    render(<WovenSyncScreen {...BASE} enabled validationEnabled />);
    expect(validationButton().disabled).toBe(true);
    expect(syncButton().disabled).toBe(true);
  });

  it("with the sync switched on, the sync button asks for a dry run only", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ status: "disabled", reason: "x" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<WovenSyncScreen {...BASE} missingCredentials={[]} enabled />);
    fireEvent.click(syncButton());
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/admin/employees/woven/sync");
    expect(JSON.parse(String(init.body))).toEqual({ dryRun: true });
  });

  it("the connection test calls only the validation route", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ status: "disabled", reason: "off" }), { status: 409 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<WovenSyncScreen {...BASE} missingCredentials={[]} validationEnabled />);
    fireEvent.click(validationButton());
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe("/api/admin/employees/woven/validate");
  });

  it("shows the eleven summary cards once the directory exists, counts only", () => {
    const { container } = render(
      <WovenSyncScreen
        {...BASE}
        missingCredentials={[]}
        overview={counts()}
        database={{ state: "ready", status: status({ lastSuccessAt: "2026-10-05T11:31:00Z" }) }}
      />,
    );
    for (const label of [
      "Last successful sync",
      "Last attempted sync",
      "Sync status",
      "Active employees",
      "Terminated employees",
      "New hires since last sync",
      "Terminations since last sync",
      "Position changes since last sync",
      "Location transfers since last sync",
      "Location access changes",
      "Sync errors / unmapped records",
    ]) {
      expect(screen.getByText(label), label).toBeTruthy();
    }
    expect(screen.getAllByText("Oct 5, 6:31 AM").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("412")).toBeTruthy();
    expect(screen.getByText("1 confirmed promotion or demotion")).toBeTruthy();
    expect(screen.getByText("2 added · 1 removed")).toBeTruthy();
    expect(container.textContent).not.toMatch(/@/);
  });

  it("calls the first run an initial load, not a hiring wave", () => {
    render(<WovenSyncScreen {...BASE} overview={counts({ newHiresSinceLast: null, initialLoadCount: 469 })} />);
    expect(screen.getByText("Initial load: 469 employees")).toBeTruthy();
  });

  it("labels sample data plainly", () => {
    render(<WovenSyncScreen {...BASE} overview={counts()} sampleLabel="Sample data — invented records, not from Woven" />);
    expect(screen.getByText("Sample data — invented records, not from Woven")).toBeTruthy();
    expect(screen.getByTestId("woven-sample-banner").textContent).toMatch(/every action is disabled/);
  });

  it("shows no cards, and no sample banner, when there is nothing to count", () => {
    render(<WovenSyncScreen {...BASE} />);
    expect(screen.queryByText("Active employees")).toBeNull();
    expect(screen.queryByTestId("woven-sample-banner")).toBeNull();
  });
});

describe("6. the page cannot ask for a stored sync", () => {
  function sources(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return sources(path);
      return /\.(ts|tsx)$/.test(name) && !/\.test\./.test(name) ? [path] : [];
    });
  }

  it("no page or component source sends dryRun:false", () => {
    const root = join(__dirname, "..", "..", "..");
    for (const file of [...sources(join(root, "features")), ...sources(join(root, "app", "(app)")), ...sources(join(root, "components"))]) {
      const code = readFileSync(file, "utf8");
      expect(code, file).not.toMatch(/dryRun["']?\s*:\s*false/);
    }
  });

  it("the button sends { dryRun: true } even when writes are on, and says when stored syncs are off", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ status: "disabled", reason: "x" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const { unmount } = render(<WovenSyncScreen {...BASE} missingCredentials={[]} enabled syncWritesEnabled={false} />);
    expect(screen.getByText(/Stored syncs are off \(WOVEN_SYNC_WRITES_ENABLED is not on\)/)).toBeTruthy();
    unmount();
    render(<WovenSyncScreen {...BASE} missingCredentials={[]} enabled syncWritesEnabled />);
    expect(screen.queryByText(/Stored syncs are off/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Run employee sync" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body))).toEqual({ dryRun: true });
  });

  it("shows the dry-run counts the review asks for — and no per-person detail", async () => {
    const summary = {
      dryRun: true,
      requestsMade: 61,
      pagesFetched: 4,
      employeesReceived: 150,
      employeesActive: 148,
      employeesTerminated: 0,
      employeesStatusUnknown: 2,
      employeesCreated: null,
      employeesUpdated: null,
      employeesUnchanged: 0,
      employeesMissing: 0,
      detailsFetched: 51,
      detailsSkipped: 2,
      recordsRejected: 0,
      unmappedLocations: 16,
      unmappedPositions: 13,
      statusSource: "enums",
      changesByKind: {
        new_employee: 150,
        terminated: 0,
        reactivated: 0,
        position_changed: 0,
        primary_location_changed: 0,
        location_access_added: 0,
        location_access_removed: 0,
        email_changed: 0,
        missing_from_source: 0,
      },
      newEmployeesByClassification: { initial_load: 150, new_hire: 0, newly_visible: 0 },
      issueCounts: { details_not_found: 2, unmapped_location: 150, unmapped_position: 150 },
      fieldCoverage: {
        emailAddress: 150,
        positionId: 150,
        positionName: 150,
        primaryLocationId: 150,
        hireDate: 149,
        terminationDateAmongTerminated: 0,
        multipleLocationFlag: 150,
      },
    };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ status: "succeeded", runId: null, summary }), { status: 200 })));
    render(<WovenSyncScreen {...BASE} missingCredentials={[]} enabled />);
    fireEvent.click(screen.getByRole("button", { name: "Run employee sync" }));
    const dl = await screen.findByTestId("woven-dry-run-summary");
    const row = (label: string) => within(dl).getByText(label, { selector: "dt" }).nextElementSibling?.textContent ?? "";
    expect(row("Mode")).toBe("Dry run — nothing was saved");
    expect(row("Employees received")).toBe("150");
    expect(row("Status")).toBe("148 active · 0 terminated · 2 unknown");
    expect(row("New employees")).toBe("150 · 150 initial load · 0 new hires · 0 newly visible");
    expect(row("Position changes")).toBe("0");
    expect(row("Primary-location changes")).toBe("0");
    expect(row("Location access")).toBe("0 added · 0 removed");
    expect(row("Employee-detail reads")).toBe("51 read · 2 not found · 2 skipped");
    expect(row("Unmapped")).toBe("16 locations · 13 positions");
    expect(row("Issue counts")).toContain("details not found (2)");
    expect(row("Field coverage")).toContain("EmailAddress 150");
    expect(screen.getByText("Dry run finished. 150 employees read; nothing was saved.")).toBeTruthy();
  });

  it("shows the server's refusal of a save plainly", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ status: "writes_disabled", reason: "WOVEN_SYNC_WRITES_ENABLED is not on, so only a dry run is possible. Nothing was read or saved." }), { status: 409 })),
    );
    render(<WovenSyncScreen {...BASE} missingCredentials={[]} enabled />);
    fireEvent.click(screen.getByRole("button", { name: "Run employee sync" }));
    expect(await screen.findByText(/only a dry run is possible/)).toBeTruthy();
    expect(screen.queryByTestId("woven-dry-run-summary")).toBeNull();
  });
});
