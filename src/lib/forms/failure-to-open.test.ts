import { afterEach, describe, expect, it } from "vitest";

import { readCaPolicy } from "./ca-policy";
import { describesIncident } from "./corrective-action-intake";
import { saysFailureToOpen } from "./late-open";

/* FAILURE_TO_OPEN_IS_LATE_OPENING_ENABLED. Pau's P16 wording verbatim (invented name). The replay case runs the route. */
const P16 = "Can you make a CA for Corisande Pell for failure to open on time?";

describe("FAILURE_TO_OPEN_IS_LATE_OPENING_ENABLED", () => {
  afterEach(() => {
    delete process.env.FAILURE_TO_OPEN_IS_LATE_OPENING_ENABLED;
  });

  it("off: P16's request is no account and names no policy (as production)", () => {
    expect(describesIncident(P16)).toBe(false);
    expect(readCaPolicy(P16).stated).toBeNull();
  });

  it("on: P16's request is an account, and Late Opening", () => {
    process.env.FAILURE_TO_OPEN_IS_LATE_OPENING_ENABLED = "true";
    expect(describesIncident(P16)).toBe(true);
    expect(readCaPolicy(P16).stated).toBe("late_opening");
  });

  it.each([
    "she failed to open the salon",
    "failing to open on time this morning",
    "she did not open on time",
    "she didn't open the salon",
    "couldn't open on time",
  ])("on: %s", (said) => {
    process.env.FAILURE_TO_OPEN_IS_LATE_OPENING_ENABLED = "true";
    expect(saysFailureToOpen(said)).toBe(true);
  });

  it.each([
    "she failed to open the register drawer",
    "it failed to open the form",
    "I can't open the draft",
    "she did not open the email from her manager",
    "please open a ca for her",
  ])("on, not a late opening: %s", (said) => {
    process.env.FAILURE_TO_OPEN_IS_LATE_OPENING_ENABLED = "true";
    expect(saysFailureToOpen(said)).toBe(false);
  });
});
