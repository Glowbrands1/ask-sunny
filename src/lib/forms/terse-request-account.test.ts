import { afterEach, describe, expect, it, vi } from "vitest";

import { observationAccount, readCaPolicy } from "./ca-policy";

/**
 * TERSE_REQUEST_ACCOUNT_ENABLED — QA's #745 follow-up (12 Nov 2026; ported from the sibling app's #842), in the
 * manager's words (U4's terse typo wording; the employee is the replay pack's invented Rowan Kestrel).
 */
const TERSE = "writen ca rowan kestrel not atending monthly meeting 12-20-26";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("TERSE_REQUEST_ACCOUNT_ENABLED", () => {
  it("off: as before", () => {
    // Pinned off (QA, 12 Nov 2026): the suite also runs with production's or a gate's flags in the environment.
    vi.stubEnv("TERSE_REQUEST_ACCOUNT_ENABLED", "");
    vi.stubEnv("SALES_OBSERVATION_ACCOUNT_ENABLED", "true");
    vi.stubEnv("SALES_SHORTFALL_OBJECT_ENABLED", "true");
    expect(observationAccount(TERSE, "Rowan Kestrel")).toBe(TERSE);
    expect(JSON.stringify(readCaPolicy(TERSE))).not.toMatch(/monthly meeting/);
  });

  it.each([TERSE, "Writen ca rowan kestrel not atending monthly meeting 12-20-26", "written c/a Rowan Kestrel - not atending monthly meeting 12-20-26."])(
    "on: %s → the account after the name",
    (said) => {
      vi.stubEnv("TERSE_REQUEST_ACCOUNT_ENABLED", "true");
      expect(observationAccount(said, "Rowan Kestrel")).toBe("not atending monthly meeting 12-20-26");
    },
  );

  it("on: 'atending' reads as the missed meeting", () => {
    vi.stubEnv("TERSE_REQUEST_ACCOUNT_ENABLED", "true");
    expect(JSON.stringify(readCaPolicy(TERSE))).toMatch(/monthly meeting/);
  });

  it("on: another person's name, or nothing after the name, is left to the usual reading", () => {
    vi.stubEnv("TERSE_REQUEST_ACCOUNT_ENABLED", "true");
    const other = "writen ca brisa talmadge not atending monthly meeting";
    expect(observationAccount(other, "Rowan Kestrel")).toBe(other);
    expect(observationAccount("a corrective action for Rowan Kestrel for not attending the meeting", "Rowan Kestrel")).toBe(
      "a corrective action for Rowan Kestrel for not attending the meeting",
    );
  });
});
