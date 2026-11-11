import { afterEach, describe, expect, it, vi } from "vitest";

import { withoutUnseatedName } from "./roster-only-names";
import { withoutCreateNowWhenNoEmployee } from "./no-name-reply-wording";

/*
 * NO_NAME_REPLY_WORDING_ENABLED (QA, Sunny round 22 live test, 11 Nov 2026): "create a CA for ima employee" made no card,
 * but the reply said "for the the employee" twice and "You can create it now" with no Create button.
 */
const LINE = "I can create a **Corrective Action Form** for **ima employee**.\n\nManagement will review the applicable company policy with ima employee.";
const NOTE = "You can create it now and fill it in yourself, or tell me here what happened.";

describe("NO_NAME_REPLY_WORDING_ENABLED", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("on: the name's own word never matches inside its stand-in", () => {
    vi.stubEnv("NO_NAME_REPLY_WORDING_ENABLED", "true");
    const out = withoutUnseatedName(LINE, ["ima employee"], [], ["ima employee"]);
    expect(out).not.toMatch(/the the/i);
    expect(out).toContain("policy with the employee.");
  });

  it("off: as before (the doubled word this flag fixes)", () => {
    vi.stubEnv("NO_NAME_REPLY_WORDING_ENABLED", "");
    expect(withoutUnseatedName(LINE, ["ima employee"], [], ["ima employee"])).toMatch(/the the employee/);
  });

  it("no employee on the card: never \"You can create it now\"; with one, unchanged; off, unchanged", () => {
    vi.stubEnv("NO_NAME_REPLY_WORDING_ENABLED", "true");
    expect(withoutCreateNowWhenNoEmployee(NOTE, null)).toBe("Once you tell me who it's for, you can create it and fill it in yourself, or tell me here what happened.");
    expect(withoutCreateNowWhenNoEmployee(NOTE, "Brisa Talmadge")).toBe(NOTE);
    vi.stubEnv("NO_NAME_REPLY_WORDING_ENABLED", "");
    expect(withoutCreateNowWhenNoEmployee(NOTE, null)).toBe(NOTE);
  });
});
