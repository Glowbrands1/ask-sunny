import { afterEach, describe, expect, it, vi } from "vitest";

import { installAcceptedOffRoster } from "./off-roster-confirm";
import { notAPerson } from "./person-guard";
import { installRequestMessage } from "./request-slot";

/**
 * OFFERED_NAME_ACCEPTED_ENABLED — QA (12 Nov 2026): "CA for <C>, do not terminate yet, she was late" → "use <C>" was
 * refused, the request reading "<C>," as a list item. <C> is invented.
 */
const C = "Brisa Talmadge";

afterEach(() => {
  vi.unstubAllEnvs();
  installAcceptedOffRoster(() => undefined);
});

function guardOn() {
  vi.stubEnv("PERSON_GUARD_ENABLED", "true");
  vi.stubEnv("FORM_NAME_FROM_ROSTER_ENABLED", "true");
  vi.stubEnv("OFF_ROSTER_CONFIRM_ENABLED", "true");
  installRequestMessage(() => `CA for ${C}, do not terminate yet, she was late`);
  installAcceptedOffRoster(() => C);
}

describe("OFFERED_NAME_ACCEPTED_ENABLED", () => {
  it("off: the accepted name is still ruled out by the request's shape (as before)", () => {
    guardOn();
    expect(notAPerson(C)).toBe(true);
  });

  it("on: the name taken with \"use <C>\" is a person; another name is judged as before", () => {
    guardOn();
    vi.stubEnv("OFFERED_NAME_ACCEPTED_ENABLED", "true");
    expect(notAPerson(C)).toBe(false);
    installAcceptedOffRoster(() => "Rowan Kestrel");
    expect(notAPerson(C)).toBe(true);
  });
});
