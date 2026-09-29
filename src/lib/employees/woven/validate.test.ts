import { describe, expect, it } from "vitest";

import { WovenClient } from "./client";
import { readWovenConfig } from "./config";
import {
  createFakeWoven,
  FAKE_COMPANY_ID,
  FAKE_CREDENTIALS,
  FAKE_ENUMS,
  FAKE_STATUS,
  SENSITIVE_MARKER,
  wovenDetails,
  wovenEmployee,
  wovenLocation,
} from "./test-support";
import { runWovenLiveValidation, type ValidationReport } from "./validate";

/**
 * ============================================================================
 * LIVE VALIDATION — what it reports, and what it must never report
 * ============================================================================
 *
 * Against the fake Operations API, shaped like the OpenAPI export. The report
 * must say whether the real API matches the spec, and carry counts, KEY NAMES
 * and Woven's own vocabulary only — no person's id, name, email, date or title.
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
      email: i % 10 === 0 ? `quinlan${i}@gmail.test` : `quinlan${i}@suntancity.test`,
      primaryLocationId: `WL-${i % 4}`,
      hasMultipleLocationAccess: i < 3,
      allLocationAccess: i === 3,
    }),
  );
  const terminated = Array.from({ length: 30 }, (_, i) =>
    wovenEmployee(`T${i}`, { status: FAKE_STATUS.terminated, terminationDate: "2025-01-31T00:00:00" }),
  );
  const details = Object.fromEntries(
    active.slice(0, 12).map((_, i) => [
      `A${i}`,
      i === 3
        ? { ...wovenDetails(`A${i}`, []) }
        : wovenDetails(`A${i}`, [{ id: `WL-${i % 4}` }, { id: "WL-9", expires: "2026-12-31T00:00:00" }, { id: "WL-8" }]),
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
  const fake = createFakeWoven({
    employees,
    details,
    tokenLifetimeSeconds: 1800,
    locations: [wovenLocation("WL-0", { number: "0306" }), wovenLocation("WL-HQ", { nonLocation: true })],
    ...fakeOptions,
  });
  prepare?.(fake);
  const cfg = config(extraConfig);
  const report = await runWovenLiveValidation({
    config: cfg,
    client: new WovenClient({
      baseUrl: cfg.baseUrl,
      credentials: FAKE_CREDENTIALS,
      companyId: cfg.companyId,
      fetch: fake.fetch,
      sleep: async () => {},
    }),
    now: () => new Date("2026-09-28T15:00:00Z"),
  });
  return { report, fake };
}

const verdicts = (report: ValidationReport, area: string) => report.findings.filter((f) => f.area === area).map((f) => f.verdict);
const message = (report: ValidationReport, area: string) => report.findings.filter((f) => f.area === area).map((f) => f.message).join(" ");

describe("a matching API", () => {
  it("passes sign-in, status values, both reads, locations and the catalog", async () => {
    const { report } = await validate();
    expect(report.ok).toBe(true);
    expect(verdicts(report, "Sign-in")).toContain("pass");
    expect(verdicts(report, "Status values")).toEqual(["pass"]);
    expect(verdicts(report, "Terminated employees")).toEqual(["pass"]);
    expect(verdicts(report, "Locations")).toEqual(["pass"]);
    expect(verdicts(report, "Location catalog")).toEqual(["pass"]);
    expect(report.normalized).toMatchObject({ employees: 70, active: 40, terminated: 30, statusUnknown: 0 });
    expect(report.passes.map((p) => [p.label, p.records])).toEqual([
      ["current", 40],
      ["with_terminated", 70],
    ]);
    expect(report.locations).toMatchObject({ outcome: "answered", records: 2, withNumber: 1, nonLocations: 1 });
  });

  it("resolves Status integers from /lists/enums and reports the labels", async () => {
    const { report } = await validate();
    expect(report.enums?.statusEnumeration).toBe("EmployeeStatus");
    expect(report.enums?.statusLabels).toMatchObject({ 1: "Active", 2: "Terminated", 3: "On Leave" });
    expect(report.passes[1].statusCodes).toEqual({ 1: 40, 2: 30 });
  });

  it("discovers the CompanyID when none is configured", async () => {
    const { report } = await validate();
    expect(report.token.ok && report.token.companyId).toBe(FAKE_COMPANY_ID);
    expect(report.token.ok && report.token.companyIdSent).toBe(false);
    expect(message(report, "Company")).toContain(FAKE_COMPANY_ID);
  });

  it("sends a configured CompanyID and says so", async () => {
    const { report, fake } = await validate({ requiredCompanyId: FAKE_COMPANY_ID }, { WOVEN_COMPANY_ID: FAKE_COMPANY_ID });
    expect(report.token.ok && report.token.companyIdSent).toBe(true);
    expect(JSON.parse(fake.calls[0].body ?? "{}").CompanyID).toBe(FAKE_COMPANY_ID);
    expect(verdicts(report, "Company")).toEqual([]);
  });

  it("samples all-location and multi-location employees first, and keeps an empty all-location list as unknown", async () => {
    const { report } = await validate();
    expect(report.details?.allLocationEmployeesSampled).toBe(1);
    expect(report.details?.allLocationEmployeesWithEmptyList).toBe(1);
    expect(report.details?.entriesWithExpiresOn).toBeGreaterThan(0);
    expect(verdicts(report, "Temporary access")).toEqual(["warn"]);
    expect(message(report, "Temporary access")).toMatch(/Before any of them is called "borrowed"/);
  });

  it("is read-only: only the token POST, everything else a GET to a spec read endpoint", async () => {
    const { fake } = await validate();
    expect(fake.calls.filter((c) => c.method !== "GET").map((c) => c.path)).toEqual(["/tokens/v2"]);
    for (const call of fake.calls.filter((c) => c.method === "GET")) {
      expect(["/employees", "/lists/enums", "/locations"].includes(call.path) || /^\/employees\/[^/]+\/details$/.test(call.path)).toBe(true);
    }
  });
});

describe("webhooks, from Woven's own vocabulary", () => {
  it("reports trigger names and says none is about employees", async () => {
    const { report } = await validate();
    expect(Object.keys(report.enums!.webhookTriggerVocabularies)).toEqual(["CompanyWebhookNotificationTrigger"]);
    expect(report.enums!.employeeWebhookTriggers).toEqual([]);
    expect(message(report, "Webhooks")).toMatch(/polling stays the baseline/);
  });

  it("names employee triggers when Woven lists them — and says registering one needs approval", async () => {
    const { report } = await validate({
      enums: [
        ...FAKE_ENUMS,
        { EnumerationName: "CompanyWebhookNotificationTrigger", PropertyName: "EmployeeTerminated", PropertyDisplayName: "Employee Terminated", PropertyValue: 70 },
      ],
    });
    expect(report.enums!.employeeWebhookTriggers).toEqual(["Employee Terminated"]);
    expect(message(report, "Webhooks")).toMatch(/needs its own approval/);
  });
});

describe("what the report must never contain", () => {
  it("no names, emails, employee ids, dates, titles or sensitive values", async () => {
    const { report } = await validate();
    const text = JSON.stringify(report);
    for (const forbidden of ["Quinlan", "quinlan", "A1\"", "T1\"", "2025-01-31", "Salon Consultant", "KS Manhattan", SENSITIVE_MARKER, "token-1", FAKE_CREDENTIALS.password]) {
      expect(text).not.toContain(forbidden);
    }
  });

  it("names the sensitive-looking KEYS the application user received, as a scoping test", async () => {
    const { report } = await validate();
    for (const key of ["CellPhone", "DateOfBirth", "RateOfPay", "TerminationReason", "TerminatedAllowRehire", "Gender", "EmergencyContactName"]) {
      expect(report.sensitiveKeysReturned).toContain(key);
    }
    expect(report.sensitiveKeysReturned).not.toContain("EmailAddress");
    expect(verdicts(report, "Access scope")).toEqual(["warn"]);
  });
});

describe("what it catches", () => {
  it("a refused sign-in stops the check and says where", async () => {
    const { report } = await validate({ password: "different" });
    expect(report.ok).toBe(false);
    expect(report.token.ok).toBe(false);
    expect(verdicts(report, "Sign-in")).toEqual(["fail"]);
  });

  it("a subscription that is not active for the product (403 on the token)", async () => {
    const { report } = await validate({}, {}, (fake) => fake.override((c) => c.path === "/tokens/v2", () => fake.json({}, 403)));
    expect(message(report, "Sign-in")).toMatch(/403/);
  });

  it("an unavailable enum list: a fail, because a real sync would be refused", async () => {
    const { report } = await validate({ enums: null });
    expect(report.ok).toBe(false);
    expect(verdicts(report, "Status values")).toContain("fail");
  });

  it("an enum list with no employee-status enumeration", async () => {
    const { report } = await validate({ enums: FAKE_ENUMS.filter((e) => e.EnumerationName !== "EmployeeStatus") });
    expect(verdicts(report, "Status values")).toContain("fail");
    expect(report.normalized.statusUnknown).toBe(70);
  });

  it("statuses that are neither Active nor Terminated", async () => {
    const { report } = await validate({}, {}, (fake) => {
      fake.state.employees = [...fake.state.employees, wovenEmployee("L1", { status: FAKE_STATUS.onLeave })];
    });
    expect(report.normalized.statusUnknown).toBe(1);
    expect(message(report, "Status values")).toMatch(/neither Active nor Terminated/);
  });

  it("a with-terminated read that is not a superset", async () => {
    const { report } = await validate({}, {}, (fake) =>
      fake.override((c) => c.query.includeterminatedemployee === "true", () => fake.json([]), 10),
    );
    expect(report.currentNotInWithTerminated).toBe(40);
    expect(verdicts(report, "Terminated employees")).toEqual(["warn"]);
  });

  it("a capped page size, with the value to set", async () => {
    const { report } = await validate({ maxTake: 10 });
    expect(message(report, "Pagination")).toMatch(/WOVEN_PAGE_SIZE=10/);
  });

  it("a field the spec names but the response lacks", async () => {
    const { report } = await validate({}, {}, (fake) => {
      fake.state.employees = fake.state.employees.map((e) => {
        const { EmailAddress: _e, ...rest } = e;
        void _e;
        return rest;
      });
    });
    expect(message(report, "Fields")).toMatch(/EmailAddress/);
  });

  it("details with no Locations array", async () => {
    const { report } = await validate({}, {}, (fake) => {
      for (const key of Object.keys(fake.state.details)) fake.state.details[key] = { EmployeeID: key };
    });
    expect(verdicts(report, "Locations")).toEqual(["fail"]);
  });

  it("no login-email domain: warns, lists domains, and says nobody is eligible", async () => {
    const { report } = await validate();
    expect(report.normalized.emailDomains).toEqual({ "suntancity.test": 66, "gmail.test": 4 });
    expect(message(report, "Email")).toMatch(/nobody is login-eligible/);
  });

  it("with WOVEN_LOGIN_EMAIL_DOMAINS: counts what the rule accepts, and still stores everything", async () => {
    const { report } = await validate({}, { WOVEN_LOGIN_EMAIL_DOMAINS: "suntancity.test" });
    expect(report.normalized.loginEligibleByDomain).toBe(66);
    expect(verdicts(report, "Email")).toEqual(["pass"]);
  });

  it("a page that keeps failing mid-read is reported, not thrown", async () => {
    const { report } = await validate({}, {}, (fake) =>
      fake.override((c) => c.path === "/employees" && c.query.queryskip === "25", () => fake.json({}, 500), 20),
    );
    expect(verdicts(report, "Pagination")).toContain("fail");
    expect(report.ok).toBe(false);
  });

  it("a token response with no TokenExpirationDate", async () => {
    const { report } = await validate({ tokenLifetimeSeconds: undefined });
    expect(message(report, "Sign-in")).toMatch(/TokenExpirationDate/);
  });
});
