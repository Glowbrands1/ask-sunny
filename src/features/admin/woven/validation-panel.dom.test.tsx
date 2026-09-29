// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

import { WovenClient } from "@/lib/employees/woven/client";
import { readWovenConfig } from "@/lib/employees/woven/config";
import {
  createFakeWoven,
  FAKE_COMPANY_ID,
  FAKE_CREDENTIALS,
  SENSITIVE_MARKER,
  wovenDetails,
  wovenEmployee,
  wovenLocation,
} from "@/lib/employees/woven/test-support";
import { runWovenLiveValidation, type ValidationReport } from "@/lib/employees/woven/validate";
import { ValidationPanel } from "./validation-panel";

/**
 * The connection test's report, as an administrator sees it. The report is a
 * REAL one, produced by the validation against the fake Operations API, so
 * this checks what actually reaches the screen: the summary the review asks
 * for, and no employee name, email or id anywhere on the page.
 */

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function realReport(includeLocationReview: boolean): Promise<ValidationReport> {
  const employees = [
    ...Array.from({ length: 6 }, (_, i) =>
      wovenEmployee(`A${i}`, {
        firstName: `Rosalind${i}`,
        email: `rosalind${i}@suntancity.test`,
        primaryLocationId: "WL-0",
        hasMultipleLocationAccess: i < 2,
        allLocationAccess: i === 2,
      }),
    ),
    wovenEmployee("T0", { firstName: "Bartholomew", status: 2, terminationDate: "2025-01-31T00:00:00" }),
  ];
  const details: Record<string, Record<string, unknown>> = {
    A0: wovenDetails("A0", [{ id: "WL-0" }, { id: "WL-1", expires: "2026-12-31T00:00:00" }]),
    A1: wovenDetails("A1", [{ id: "WL-0" }, { id: "WL-1" }]),
    A2: wovenDetails("A2", []),
    A3: wovenDetails("A3", [{ id: "WL-0" }]),
    A4: wovenDetails("A4", [{ id: "WL-0" }]),
    A5: wovenDetails("A5", [{ id: "WL-0" }]),
  };
  const fake = createFakeWoven({
    employees,
    details,
    tokenLifetimeSeconds: 1800,
    locations: [wovenLocation("WL-0", { number: "0306", name: "Woven Store 306" }), wovenLocation("WL-1", { number: "0999", name: "Woven Store 999" })],
  });
  const config = readWovenConfig({
    WOVEN_VALIDATION_ENABLED: "true",
    WOVEN_SUBSCRIPTION_KEY: FAKE_CREDENTIALS.subscriptionKey,
    WOVEN_USERNAME: FAKE_CREDENTIALS.username,
    WOVEN_PASSWORD: FAKE_CREDENTIALS.password,
  });
  return runWovenLiveValidation({
    config,
    client: new WovenClient({ baseUrl: config.baseUrl, credentials: FAKE_CREDENTIALS, fetch: fake.fetch, sleep: async () => {} }),
    now: () => new Date("2026-09-28T15:00:00Z"),
    salons: { outcome: "loaded", salons: [{ number: "0306", name: "Salon 306" }, { number: "0412", name: "Salon 412" }] },
    includeLocationReview,
  });
}

async function show(report: ValidationReport) {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ status: "ok", report }), { status: 200 })));
  const view = render(<ValidationPanel available reason={null} />);
  fireEvent.click(screen.getByRole("button", { name: "Run read-only validation" }));
  await screen.findByTestId("woven-validation-summary");
  return view;
}

const row = (label: string) => {
  const term = within(screen.getByTestId("woven-validation-summary")).getByText(label, { selector: "dt" });
  return term.nextElementSibling?.textContent ?? "";
};

describe("the connection test's summary", () => {
  it("shows every item the review asks for", async () => {
    await show(await realReport(false));
    expect(row("Authentication")).toBe("Succeeded");
    expect(row("CompanyID")).toContain(FAKE_COMPANY_ID);
    expect(row("Company options")).toBeTruthy();
    expect(row("Employee-status values")).toContain("1 = Active");
    expect(row("Termination types")).toBeTruthy();
    expect(row("Webhook triggers")).toBeTruthy();
    expect(row("Employee-related triggers")).toBe("none found");
    expect(row("Employees")).toBe("6 active · 1 terminated · 0 other status · 7 unique");
    expect(row("Unique PositionIDs")).toMatch(/^\d+$/);
    expect(row("Woven locations")).toContain("2 total");
    expect(row("Ask Sunny salon match")).toContain("1 exact Number matches, covering 1 of 2 salons");
    expect(row("Ask Sunny salon match")).toContain("1 salons with no Woven location");
    expect(row("Email domains")).toMatch(/^suntancity\.test \(\d+\)/);
    expect(row("Email domains")).not.toContain("@");
    expect(row("Location access flags")).toBe("2 with HasMultipleLocationAccess · 1 with AllLocationAccess");
    expect(row("Employee details")).toBe("6 checked · 2 with more than one location");
    expect(row("ExpiresOn")).toMatch(/^ExpiresOn present: 1 affiliations\. Needs live operational confirmation$/);
    expect(row("Sensitive HR field names")).toContain("DateOfBirth");
    expect(row("Differences from the OpenAPI spec")).toBe("none seen");
  });

  it("labels a sample as a sample", async () => {
    const report = await realReport(false);
    await show({ ...report, details: { ...report.details!, isSample: true, eligible: 40 } });
    expect(row("Employee details (sample)")).toMatch(/checked of 40 employees not terminated — a sample/);
    expect(row("ExpiresOn")).toContain("(in the sample)");
  });

  it("flags an employee-related webhook trigger when Woven lists one", async () => {
    const report = await realReport(false);
    await show({ ...report, enums: { ...report.enums!, employeeWebhookTriggers: ["Employee Terminated"] } });
    expect(row("Employee-related triggers")).toBe("Found: Employee Terminated");
  });

  it("shows a refused sign-in by code and status only", async () => {
    const report = await realReport(false);
    await show({ ...report, token: { ok: false, code: "auth_failed", status: 401 } });
    expect(row("Authentication")).toBe("Failed (auth_failed, HTTP 401)");
  });

  it("never shows an employee name, email, id or sensitive value — and never says borrowed", async () => {
    const { container } = await show(await realReport(true));
    const text = container.textContent ?? "";
    for (const forbidden of ["Rosalind", "rosalind", "Bartholomew", "@suntancity.test", "A0", "T0", SENSITIVE_MARKER, "SENSITIVE-MANAGER-NAME", FAKE_CREDENTIALS.password, FAKE_CREDENTIALS.subscriptionKey]) {
      expect(text, forbidden).not.toContain(forbidden);
    }
    expect(text).not.toMatch(/borrow/i);
  });
});

describe("the location review area", () => {
  it("is absent when the server sent no review (a caller without manage_users)", async () => {
    await show(await realReport(false));
    expect(screen.queryByTestId("woven-location-review")).toBeNull();
    expect(screen.queryByText("Woven Store 306")).toBeNull();
  });

  it("lists location numbers and names, and salons with no Woven location, when the server sent one", async () => {
    await show(await realReport(true));
    const area = screen.getByTestId("woven-location-review");
    expect(within(area).getByText("Woven Store 306")).toBeTruthy();
    expect(within(area).getByText("salon 0306")).toBeTruthy();
    expect(within(area).getByText("Salon 412")).toBeTruthy();
    expect(area.textContent).toContain("nothing is mapped");
  });
});
