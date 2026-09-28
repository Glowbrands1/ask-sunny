import { describe, expect, it } from "vitest";

import { readWovenConfig } from "./config";

/** Configuration: off by default, credentials by name only, and no insecure base URL. */

describe("readWovenConfig", () => {
  it("is off, with the documented default base URL, when nothing is set", () => {
    const config = readWovenConfig({});
    expect(config.enabled).toBe(false);
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

  it("reads approved work-email domains", () => {
    const config = readWovenConfig({ WOVEN_WORK_EMAIL_DOMAINS: "SunTanCity.com, @glowbrands.com, bad domain" });
    expect(config.workEmailDomains).toEqual(["suntancity.com", "glowbrands.com"]);
    expect(config.problems).toHaveLength(1);
  });
});
