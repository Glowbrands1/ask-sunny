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
import { runWovenLiveValidation, type SalonComparisonInput, type ValidationReport } from "./validate";

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
    WOVEN_VALIDATION_ENABLED: "true",
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
  run: { salons?: SalonComparisonInput; includeLocationReview?: boolean } = {},
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
    ...run,
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
  });

  it("labels the details read as a sample, and counts records naming more than one location", async () => {
    const { report } = await validate();
    expect(report.details).toMatchObject({ isSample: true, eligible: 40, sampleLimit: 10, sampled: 10, failed: 0, withMoreThanOneLocation: 9 });
    expect(report.normalized).toMatchObject({ multipleLocationFlagTrue: 3, allLocationAccess: 1 });
    expect(message(report, "Locations")).toMatch(/a SAMPLE of 10 employee-detail records \(of 40 employees not terminated/);
    expect(message(report, "Locations")).toMatch(/9 named more than one location/);
  });

  it("reports ExpiresOn as a count whose meaning needs live operational confirmation — never as borrowed", async () => {
    const { report } = await validate();
    expect(report.details?.entriesWithExpiresOn).toBe(9);
    expect(report.details?.expiresOnMeaning).toBe("needs_live_operational_confirmation");
    expect(verdicts(report, "ExpiresOn")).toEqual(["warn"]);
    expect(message(report, "ExpiresOn")).toMatch(/^ExpiresOn present: 9 affiliations \(in the sample\)\. Meaning: needs live operational confirmation\./);
    expect(JSON.stringify(report)).not.toMatch(/borrow/i);
  });

  it("sees no difference from the OpenAPI export when the API matches it", async () => {
    const { report } = await validate();
    expect(report.specDiscrepancies).toEqual([]);
    expect(verdicts(report, "OpenAPI contract")).toEqual(["pass"]);
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

describe("salon coverage: Woven /locations against salons.salon_number", () => {
  const SALONS: SalonComparisonInput = {
    outcome: "loaded",
    salons: [
      { number: "0306", name: "Salon Three-Oh-Six" },
      { number: "0412", name: "Salon Four-Twelve" },
      { number: "0520", name: "Salon Five-Twenty" },
    ],
  };
  const LOCATIONS = [
    wovenLocation("WL-0", { number: "0306", name: "Woven Store 306" }),
    wovenLocation("WL-1", { number: "412", name: "Woven Store 412" }),
    wovenLocation("WL-2", { number: "0777", name: "Woven Store 777", closed: true }),
    wovenLocation("WL-3", { number: "0888", name: "Woven Store 888" }),
    wovenLocation("WL-HQ", { name: "Head Office", nonLocation: true }),
  ];

  it("counts exact matches, unmatched locations, uncovered salons, closed and non-locations", async () => {
    const { report } = await validate({ locations: LOCATIONS }, {}, undefined, { salons: SALONS });
    expect(report.locations).toMatchObject({ records: 5, withNumber: 4, closed: 1, nonLocations: 1 });
    expect(report.locations?.salonCoverage).toEqual({
      outcome: "compared",
      salons: 3,
      exactMatches: 1,
      salonsMatched: 1,
      unmatchedWovenLocations: 4,
      unmatchedOpenWovenLocations: 2,
      salonsWithoutWovenLocation: 2,
      leadingZeroOnlyMatches: 1,
      duplicateWovenNumbers: 0,
    });
    expect(verdicts(report, "Salon coverage")).toEqual(["warn"]);
    expect(message(report, "Salon coverage")).toMatch(/1 would match only if leading zeros were ignored; they are not counted/);
    expect(message(report, "Salon coverage")).toMatch(/Nothing is mapped or confirmed/);
  });

  it("passes when every salon and every open location match", async () => {
    const { report } = await validate(
      { locations: [wovenLocation("WL-0", { number: "0306" }), wovenLocation("WL-HQ", { nonLocation: true })] },
      {},
      undefined,
      { salons: { outcome: "loaded", salons: [{ number: "0306", name: "x" }] } },
    );
    expect(verdicts(report, "Salon coverage")).toEqual(["pass"]);
  });

  it("gives location numbers and names only when asked (manage_users), and never an employee or a location's other fields", async () => {
    const without = await validate({ locations: LOCATIONS }, {}, undefined, { salons: SALONS });
    expect(without.report.locationReview).toBeNull();
    expect(JSON.stringify(without.report)).not.toContain("Woven Store 306");
    expect(JSON.stringify(without.report)).not.toContain("Salon Four-Twelve");

    const { report } = await validate({ locations: LOCATIONS }, {}, undefined, { salons: SALONS, includeLocationReview: true });
    expect(report.locationReview?.wovenLocations[0]).toEqual({ number: "0306", name: "Woven Store 306", closed: false, nonLocation: false, matchedSalonNumber: "0306" });
    expect(report.locationReview?.salonsWithoutWovenLocation).toEqual([
      { number: "0412", name: "Salon Four-Twelve" },
      { number: "0520", name: "Salon Five-Twenty" },
    ]);
    const text = JSON.stringify(report);
    for (const forbidden of ["SENSITIVE-MANAGER-NAME", "SENSITIVE-LOCATION-PHONE", "Quinlan", "quinlan", "WL-0\"", "A1\""]) {
      expect(text).not.toContain(forbidden);
    }
  });

  it("says so when the salons could not be read, and still runs every Woven check", async () => {
    const { report } = await validate({}, {}, undefined, { salons: { outcome: "unavailable", salons: [] } });
    expect(report.locations?.salonCoverage.outcome).toBe("salons_unavailable");
    expect(message(report, "Salon coverage")).toMatch(/could not be read/);
    expect(report.ok).toBe(true);
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
    /* A refused sign-in is a credentials answer, not a contract difference. */
    expect(report.specDiscrepancies).toEqual([]);
    expect(JSON.stringify(report)).not.toContain("different");
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
    expect(report.specDiscrepancies.join(" ")).toMatch(/did not return a superset/);
    expect(verdicts(report, "OpenAPI contract")).toEqual(["warn"]);
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
    expect(report.specDiscrepancies.join(" ")).toMatch(/No employee record carries EmailAddress/);
  });

  it("details with no Locations array", async () => {
    const { report } = await validate({}, {}, (fake) => {
      for (const key of Object.keys(fake.state.details)) fake.state.details[key] = { EmployeeID: key };
    });
    expect(verdicts(report, "Locations")).toEqual(["fail"]);
    expect(report.specDiscrepancies.join(" ")).toMatch(/Locations\[\]/);
  });

  it("a failed details read is reported by code only — never by its URL, which carries an employee id", async () => {
    const { report } = await validate({}, {}, (fake) => fake.override((c) => c.path === "/employees/A0/details", () => fake.json({}, 404), 5));
    expect(report.details?.failed).toBe(1);
    expect(report.details?.failureCodes).toEqual({ not_found: 1 });
    expect(message(report, "Employee details")).toMatch(/not_found ×1/);
    expect(JSON.stringify(report)).not.toContain("/employees/A0");
    expect(report.specDiscrepancies.join(" ")).toMatch(/details answered in a way the spec does not describe \(not_found ×1\)/);
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
    expect(report.specDiscrepancies.join(" ")).toMatch(/no usable TokenExpirationDate/);
  });
});
