import { afterEach, describe, expect, it, vi } from "vitest";

import { roleNamedPeople } from "./role-named-person";

afterEach(() => vi.unstubAllEnvs());

/* QA's J11 (15 Nov 2026): a person the account names in a role is not the form's subject. Names invented. */
const SAID = "Juno completed onboarding with new hire Corran Vale on 9-28-26. As of 10-16-26 Corran had not acknowledged onboarding policies.";

describe("people named in a role", () => {
  it("off: none", () => {
    expect(roleNamedPeople(SAID, ["Juno", "Corran Vale", "Corran"])).toEqual([]);
  });

  it("on: the new hire, and their first name alone later in the message", () => {
    vi.stubEnv("ACCOUNT_PERSON_NOT_SUBJECT_ENABLED", "true");
    expect(roleNamedPeople(SAID, ["Juno", "Corran Vale", "Corran"])).toEqual(["Corran Vale", "Corran"]);
    expect(roleNamedPeople("a guest named Tamsin Orwell complained about Juno Paxton", ["Tamsin Orwell", "Juno Paxton"])).toEqual(["Tamsin Orwell"]);
  });

  it("on: a person named with no role is a subject", () => {
    vi.stubEnv("ACCOUNT_PERSON_NOT_SUBJECT_ENABLED", "true");
    expect(roleNamedPeople("actually this is for remy calder", ["remy calder"])).toEqual([]);
    expect(roleNamedPeople("ca for juno paxton, she was late", ["juno paxton"])).toEqual([]);
  });
});
