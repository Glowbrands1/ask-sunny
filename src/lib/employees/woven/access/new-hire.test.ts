import { describe, expect, it } from "vitest";

import { isNewHire, readNewHireConfig } from "./new-hire";

/* NEW_HIRE_INVITES_ENABLED (Pau, 28 Oct 2026): every switch closed by default; a misconfiguration is off, never wider. */
const NOW = new Date("2026-10-30T12:00:00Z");

describe("readNewHireConfig", () => {
  it("off by default, whatever else is set", () => {
    expect(readNewHireConfig({}, NOW)).toMatchObject({ enabled: false, rule: null, problem: null });
    expect(readNewHireConfig({ NEW_HIRE_INVITE_SINCE: "2026-10-28", NEW_HIRE_INVITE_ROLES: "employee" }, NOW).enabled).toBe(false);
  });

  it("on needs a date: without one it is off and says why", () => {
    const config = readNewHireConfig({ NEW_HIRE_INVITES_ENABLED: "true" }, NOW);
    expect(config.enabled).toBe(false);
    expect(config.problem).toContain("NEW_HIRE_INVITE_SINCE");
  });

  it("a name that is not a role turns it off", () => {
    const config = readNewHireConfig({ NEW_HIRE_INVITES_ENABLED: "true", NEW_HIRE_INVITE_SINCE: "2026-10-28", NEW_HIRE_INVITE_ROLES: "employee,boss" }, NOW);
    expect(config.enabled).toBe(false);
    expect(config.problem).toContain("boss");
  });

  it("on: the date, the roles (none by default), today, and one an hour unless 2 is asked for", () => {
    expect(readNewHireConfig({ NEW_HIRE_INVITES_ENABLED: "true", NEW_HIRE_INVITE_SINCE: "2026-10-28" }, NOW)).toEqual({
      enabled: true,
      rule: { since: "2026-10-28", extraRoles: [], today: "2026-10-30" },
      perHour: 1,
      problem: null,
    });
    const two = { NEW_HIRE_INVITES_ENABLED: "on", NEW_HIRE_INVITE_SINCE: "2026-10-28", NEW_HIRE_INVITE_ROLES: " employee ", NEW_HIRE_INVITES_PER_HOUR: "2" };
    expect(readNewHireConfig(two, NOW)).toMatchObject({ rule: { extraRoles: ["employee"] }, perHour: 2 });
    for (const asked of ["3", "50", "0", "x"]) {
      expect(readNewHireConfig({ ...two, NEW_HIRE_INVITES_PER_HOUR: asked }, NOW).perHour).toBe(1);
    }
  });
});

describe("isNewHire", () => {
  const rule = { since: "2026-10-28", extraRoles: [], today: "2026-10-30" };
  it("from the date through today; not before, not after, not without a date", () => {
    expect(isNewHire("2026-10-28", rule)).toBe(true);
    expect(isNewHire("2026-10-30T00:00:00Z", rule)).toBe(true);
    expect(isNewHire("2026-10-27", rule)).toBe(false);
    expect(isNewHire("2026-10-31", rule)).toBe(false);
    expect(isNewHire(null, rule)).toBe(false);
    expect(isNewHire("soon", rule)).toBe(false);
  });
});
