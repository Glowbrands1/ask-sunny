import { describe, expect, it } from "vitest";

import { readWovenConfig } from "./config";

/** Configuration: off by default, credentials by name only, and no insecure base URL. */

describe("readWovenConfig", () => {
  it("is off, with the documented default base URL, when nothing is set", () => {
    const config = readWovenConfig({});
    expect(config.enabled).toBe(false);
    expect(config.validationEnabled).toBe(false);
    expect(config.scheduleEnabled).toBe(false);
    expect(config.baseUrl).toBe("https://gateway-api.woven.team/api");
    expect(config.credentials).toBeNull();
    expect(config.missingCredentials).toEqual(["WOVEN_SUBSCRIPTION_KEY", "WOVEN_USERNAME", "WOVEN_PASSWORD"]);
    expect(config.problems).toEqual([]);
  });

  it("reports a missing credential by NAME and never echoes a value", () => {
    const config = readWovenConfig({
      WOVEN_SYNC_ENABLED: "true",
      WOVEN_SUBSCRIPTION_KEY: "sk-live-very-secret-value",
      WOVEN_USERNAME: "ask-sunny",
    });
    expect(config.credentials).toBeNull();
    expect(config.problems.join(" ")).toContain("WOVEN_PASSWORD");
    expect(JSON.stringify(config.problems)).not.toContain("sk-live-very-secret-value");
  });

  it("assembles credentials when all three are present", () => {
    const config = readWovenConfig({
      WOVEN_SUBSCRIPTION_KEY: " key ",
      WOVEN_USERNAME: " user ",
      WOVEN_PASSWORD: " pass with spaces ",
    });
    expect(config.credentials).toEqual({ subscriptionKey: "key", username: "user", password: " pass with spaces " });
  });

  it("reads the validation switch independently, and it never turns on a sync", () => {
    const creds = { WOVEN_SUBSCRIPTION_KEY: "k", WOVEN_USERNAME: "u", WOVEN_PASSWORD: "p" };
    const validationOnly = readWovenConfig({ ...creds, WOVEN_VALIDATION_ENABLED: "true", WOVEN_SYNC_ENABLED: "false" });
    expect(validationOnly.validationEnabled).toBe(true);
    expect(validationOnly.enabled).toBe(false);
    expect(validationOnly.scheduleEnabled).toBe(false);
    expect(validationOnly.problems).toEqual([]);

    const syncOnly = readWovenConfig({ ...creds, WOVEN_SYNC_ENABLED: "true" });
    expect(syncOnly.enabled).toBe(true);
    expect(syncOnly.validationEnabled).toBe(false);
  });

  it("flags the validation switch on without credentials, by name only", () => {
    const config = readWovenConfig({ WOVEN_VALIDATION_ENABLED: "true", WOVEN_USERNAME: "someone" });
    expect(config.problems.join(" ")).toContain("WOVEN_VALIDATION_ENABLED is on but WOVEN_SUBSCRIPTION_KEY, WOVEN_PASSWORD are not set");
    expect(JSON.stringify(config.problems)).not.toContain("someone");
  });

  it("flags a schedule switched on without the master switch", () => {
    const config = readWovenConfig({ WOVEN_SYNC_SCHEDULE_ENABLED: "true" });
    expect(config.problems.join(" ")).toContain("WOVEN_SYNC_ENABLED is off");
  });

  it("refuses a non-HTTPS or credential-bearing base URL", () => {
    for (const url of ["http://gateway-api.woven.team/api", "https://user:pw@evil.test/api", "https://x.test/api?k=1", "nonsense"]) {
      const config = readWovenConfig({ WOVEN_API_BASE_URL: url });
      expect(config.baseUrl).toBe("https://gateway-api.woven.team/api");
      expect(config.problems).toHaveLength(1);
    }
    expect(readWovenConfig({ WOVEN_API_BASE_URL: "https://sandbox.woven.test/api/" }).baseUrl).toBe(
      "https://sandbox.woven.test/api",
    );
  });

  it("refuses out-of-range numbers rather than clamping them", () => {
    const config = readWovenConfig({ WOVEN_PAGE_SIZE: "5000", WOVEN_MIN_COMPLETENESS_PERCENT: "10" });
    expect(config.pageSize).toBe(100);
    expect(config.minCompletenessPercent).toBe(80);
    expect(config.problems).toHaveLength(2);
  });

  it("reads login-email domains from WOVEN_LOGIN_EMAIL_DOMAINS", () => {
    const config = readWovenConfig({ WOVEN_LOGIN_EMAIL_DOMAINS: "SunTanCity.com, @glowbrands.com, bad domain" });
    expect(config.loginEmailDomains).toEqual(["suntancity.com", "glowbrands.com"]);
    expect(config.problems).toHaveLength(1);
  });

  it("leaves nobody login-eligible when WOVEN_LOGIN_EMAIL_DOMAINS is unset", () => {
    expect(readWovenConfig({}).loginEmailDomains).toEqual([]);
  });

  it("does not read the retired WOVEN_WORK_EMAIL_DOMAINS name", () => {
    expect(readWovenConfig({ WOVEN_WORK_EMAIL_DOMAINS: "suntancity.com" }).loginEmailDomains).toEqual([]);
  });

  it("reads an optional CompanyID and Platform, refusing malformed ones by name", () => {
    const good = readWovenConfig({ WOVEN_COMPANY_ID: "11111111-1111-1111-1111-111111111111", WOVEN_PLATFORM: "2" });
    expect(good.companyId).toBe("11111111-1111-1111-1111-111111111111");
    expect(good.platform).toBe(2);
    const bad = readWovenConfig({ WOVEN_COMPANY_ID: "not-a-guid", WOVEN_PLATFORM: "9" });
    expect(bad.companyId).toBeNull();
    expect(bad.platform).toBeNull();
    expect(bad.problems.join(" ")).toContain("WOVEN_COMPANY_ID");
    expect(bad.problems.join(" ")).not.toContain("not-a-guid");
  });

  it("leaves CompanyID unset by default, so Woven chooses and the live check reports it", () => {
    expect(readWovenConfig({}).companyId).toBeNull();
  });
});
