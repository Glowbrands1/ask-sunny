import { describe, expect, it } from "vitest";

import { WovenClient } from "./client";
import { readWovenConfig } from "./config";
import { createFakeWoven, FAKE_CREDENTIALS, SENSITIVE_MARKER, wovenDetails, wovenEmployee } from "./test-support";
import { runWovenLiveValidation, type ValidationReport } from "./validate";

/**
 * ============================================================================
 * LIVE VALIDATION — what it reports, and what it must never report
 * ============================================================================
 *
 * Against the fake Operations API. What matters most: the report says whether
 * the real API matches `contract.ts`, and it carries counts and KEY NAMES only
 * — no id, name, email, date or any other value.
 */

function config(extra: Record<string, string> = {}) {
  return readWovenConfig({
    WOVEN_SYNC_ENABLED: "true",
    WOVEN_SUBSCRIPTION_KEY: FAKE_CREDENTIALS.subscriptionKey,
    WOVEN_USERNAME: FAKE_CREDENTIALS.username,
    WOVEN_PASSWORD: FAKE_CREDENTIALS.password,
    WOVEN_PAGE_SIZE: "25",
    ...extra,
  });
}

function estate() {
  const active = Array.from({ length: 40 }, (_, i) =>
    wovenEmployee(`A${i}`, {
      firstName: `Quinlan${i}`,
      workEmail: i % 10 === 0 ? `quinlan${i}@gmail.test` : `quinlan${i}@suntancity.test`,
      primaryLocationId: `WL-${i % 4}`,
      hasMultipleLocations: i < 3,
    }),
  );
  const terminated = Array.from({ length: 30 }, (_, i) =>
    wovenEmployee(`T${i}`, { status: "Terminated", terminationDate: "2025-01-31" }),
  );
  const details = Object.fromEntries(
    active.slice(0, 12).map((_, i) => [
      `A${i}`,
      wovenDetails(`A${i}`, [
        { id: `WL-${i % 4}`, primary: true },
        { id: "WL-9", borrowed: true, expires: "2026-12-31" },
        { id: "WL-8" },
      ]),
    ]),
  );
  return { employees: [...active, ...terminated], details };
}

async function validate(
  fakeOptions: Partial<Parameters<typeof createFakeWoven>[0]> = {},
  extraConfig: Record<string, string> = {},
  prepare?: (fake: ReturnType<typeof createFakeWoven>) => void,
): Promise<{ report: ValidationReport; fake: ReturnType<typeof createFakeWoven> }> {
  const { employees, details } = estate();
  const fake = createFakeWoven({ employees, details, tokenLifetimeSeconds: 1800, ...fakeOptions });
  prepare?.(fake);
  const cfg = config(extraConfig);
  const report = await runWovenLiveValidation({
    config: cfg,
    client: new WovenClient({ baseUrl: cfg.baseUrl, credentials: FAKE_CREDENTIALS, fetch: fake.fetch, sleep: async () => {} }),
    now: () => new Date("2026-09-28T15:00:00Z"),
  });
  return { report, fake };
}

const verdicts = (report: ValidationReport, area: string) =>
  report.findings.filter((f) => f.area === area).map((f) => f.verdict);

describe("a matching API", () => {
  it("passes sign-in, pagination, the status filter and locations", async () => {
    const { report } = await validate({ references: { "/positions": [{ PositionID: "P1", PositionName: "Consultant" }] } });

    expect(report.ok).toBe(true);
    expect(report.token).toMatchObject({ ok: true, lifetimeSource: "expires_in", lifetimeSeconds: 1800, responseKeys: ["AccessToken", "ExpiresIn"] });
    expect(report.passes.map((p) => [p.label, p.records])).toEqual([["active", 40], ["terminated", 30]]);
    expect(report.passes[0].pageSizes).toEqual([25, 15, 0]);
    expect(report.idsInBothPasses).toBe(0);
    expect(verdicts(report, "Sign-in")).toEqual(["pass"]);
    expect(verdicts(report, "Status filter")).toEqual(["pass"]);
    expect(verdicts(report, "Locations")).toContain("pass");
    expect(report.details).toMatchObject({ sampled: 10, withLocationsArray: 10, entriesFlaggedBorrowed: 10, entriesWithExpiry: 10 });
    expect(report.details!.affiliationKinds).toEqual({ primary: 10, additional: 10, temporary: 10 });
    expect(report.normalized).toMatchObject({ employees: 70, active: 40, terminated: 30, distinctPositionIds: 1, distinctPrimaryLocations: 5 });
    expect(report.normalized.multipleLocationFlagTrue).toBe(3);
  });

  it("samples multi-location employees first for details", async () => {
    const { fake } = await validate();
    const detailCalls = fake.calls.filter((c) => c.path.endsWith("/details")).map((c) => c.path);
    expect(detailCalls.slice(0, 3)).toEqual(["/employees/A0/details", "/employees/A1/details", "/employees/A2/details"]);
  });

  it("is read-only: only the token POST, everything else GET", async () => {
    const { fake } = await validate();
    expect(fake.calls.filter((c) => c.method !== "GET").map((c) => c.path)).toEqual(["/tokens/v2"]);
  });

  it("reports reference endpoints by outcome, count and key names", async () => {
    const { report } = await validate({ references: { "/positions": [{ PositionID: "P1", PositionName: "Consultant" }] } });
    expect(report.references).toEqual([
      { path: "/positions", outcome: "answered", status: 200, shape: "array", records: 1, keysReturned: ["PositionID", "PositionName"] },
      { path: "/locations", outcome: "not_found", status: 404, shape: null, records: null, keysReturned: [] },
    ]);
  });
});

describe("what the report must never contain", () => {
  it("no names, emails, ids, dates, titles or sensitive values — only key names and counts", async () => {
    const { report } = await validate();
    const text = JSON.stringify(report);
    for (const forbidden of [SENSITIVE_MARKER, "Quinlan", "quinlan", "@suntancity.test\"", "A12", "T3\"", "2025-01-31", "2024-03-11", "Salon Consultant", "KS Manhattan", "WL-0306", FAKE_CREDENTIALS.subscriptionKey, FAKE_CREDENTIALS.password, "token-1"]) {
      expect(text, forbidden).not.toContain(forbidden);
    }
  });

  it("names the sensitive-looking KEYS the application user received, as a scoping test", async () => {
    const { report } = await validate();
    expect(report.sensitiveKeysReturned).toEqual(expect.arrayContaining(["PayRate", "DateOfBirth", "SSN", "BankAccount", "HomeAddress", "SupervisorPhone"]));
    expect(report.sensitiveKeysReturned).not.toContain("WorkEmail");
    expect(verdicts(report, "Access scope")).toEqual(["warn"]);
  });

  it("passes the scoping test when no sensitive key comes back", async () => {
    const clean = Array.from({ length: 12 }, (_, i) => {
      const { FirstName, LastName, WorkEmail, Status, EmployeeID, PositionID, PrimaryLocationID } = wovenEmployee(`C${i}`);
      return { FirstName, LastName, WorkEmail, Status, EmployeeID, PositionID, PrimaryLocationID };
    });
    const { report } = await validate({ employees: clean, details: {} });
    expect(report.sensitiveKeysReturned).toEqual([]);
    expect(verdicts(report, "Access scope")).toEqual(["pass"]);
  });
});

describe("what it catches", () => {
  it("a refused sign-in stops the check and says where", async () => {
    const { report, fake } = await validate({ password: "different" });
    expect(report.ok).toBe(false);
    expect(report.token).toMatchObject({ ok: false, code: "auth_failed", status: 401 });
    expect(report.findings[0]).toMatchObject({ verdict: "fail", area: "Sign-in" });
    expect(fake.calls.filter((c) => c.path === "/employees")).toHaveLength(0);
  });

  it("a subscription that is not active for the product (403 on the token)", async () => {
    const { report } = await validate({}, {}, (fake) => fake.override((c) => c.path === "/tokens/v2", () => fake.json({}, 403)));
    expect(report.token).toMatchObject({ ok: false, code: "forbidden" });
    expect(report.findings[0].message).toMatch(/subscription key may not be active/);
  });

  it("a status filter Woven ignores", async () => {
    const { report } = await validate({ ignoreStatusFilter: true });
    expect(report.ok).toBe(false);
    expect(verdicts(report, "Status filter")).toEqual(["fail"]);
  });

  it("a capped page size, with the value to set", async () => {
    const { report } = await validate({ maxTake: 10 });
    const finding = report.findings.find((f) => f.area === "Pagination" && f.verdict === "warn")!;
    expect(finding.message).toContain("WOVEN_PAGE_SIZE=10");
    expect(report.passes[0].records).toBe(40);
  });

  it("a field whose key differs from contract.ts", async () => {
    const renamed = estate().employees.map((r) => {
      const { WorkEmail, ...rest } = r;
      return { ...rest, EmailWork: WorkEmail };
    });
    const { report } = await validate({ employees: renamed });
    expect(report.ok).toBe(false);
    const finding = report.findings.find((f) => f.area === "Fields")!;
    expect(finding.message).toContain("workEmail");
    expect(report.passes[0].keysNotInContract).toContain("EmailWork");
  });

  it("details with no Locations array", async () => {
    const bare = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`A${i}`, { EmployeeID: `A${i}`, Sites: [] }]));
    const { report } = await validate({ details: bare });
    expect(verdicts(report, "Locations")).toEqual(["fail"]);
    expect(report.details!.keysReturned).toEqual(["EmployeeID", "Sites"]);
  });

  it("employees whose status neither pass returns, and their unmapped status values", async () => {
    const employees = [...estate().employees, wovenEmployee("L1", { status: "On Leave" })];
    const { report } = await validate({ employees });
    expect(report.unfiltered).toEqual({ records: 71, notInEitherPass: 1, statusValues: { "On Leave": 1 } });
    expect(report.findings.find((f) => f.area === "Status coverage")).toMatchObject({ verdict: "warn" });
    expect(report.findings.find((f) => f.area === "Status coverage")!.message).toContain("On Leave (1)");
    expect(report.findings.find((f) => f.area === "Status values")!.message).toContain("On Leave");
  });

  it("no domain filter: warns and lists domains with counts", async () => {
    const { report } = await validate();
    expect(report.normalized.workEmailDomains).toEqual({ "suntancity.test": 66, "gmail.test": 4 });
    expect(report.findings.find((f) => f.area === "Work email")!.message).toContain("WOVEN_WORK_EMAIL_DOMAINS");
  });

  it("with a domain filter: counts what it would drop", async () => {
    const { report } = await validate({}, { WOVEN_WORK_EMAIL_DOMAINS: "suntancity.test" });
    expect(report.normalized.droppedByDomainFilter).toBe(4);
    expect(report.findings.some((f) => f.area === "Work email")).toBe(false);
  });

  it("a page that keeps failing mid-read is reported, not thrown", async () => {
    const { report } = await validate({}, {}, (fake) =>
      fake.override((c) => c.path === "/employees" && c.query.queryskip === "25", () => fake.json({}, 500), 10),
    );
    expect(report.ok).toBe(false);
    expect(report.findings.at(-1)).toMatchObject({ verdict: "fail", area: "Pagination" });
  });

  it("a token response with no lifetime", async () => {
    const { report } = await validate({ tokenLifetimeSeconds: undefined });
    expect(report.token).toMatchObject({ ok: true, lifetimeSource: "default" });
    expect(verdicts(report, "Sign-in")).toEqual(["pass", "warn"]);
  });
});
