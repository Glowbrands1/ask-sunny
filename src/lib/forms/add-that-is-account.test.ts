import { afterEach, describe, expect, it, vi } from "vitest";

import { addsAccountClause, readPolicyChange } from "./policy-change";

/** ADD_THAT_IS_ACCOUNT_ENABLED. Ported from the sibling app: QA's live test there on a saved Corrective Action draft (10 Nov 2026), in the manager's words. */
const SAID = "add that she was reminded of the policy";

afterEach(() => vi.unstubAllEnvs());

describe("readPolicyChange with an add that introduces a clause", () => {
  it("off: read as a policy to add (the bug)", () => {
    expect(readPolicyChange(SAID)).toBe("add");
  });

  it("on: the manager's add is the account, never a policy change", () => {
    vi.stubEnv("ADD_THAT_IS_ACCOUNT_ENABLED", "true");
    expect(readPolicyChange(SAID)).toBeNull();
    expect(readPolicyChange("please note that he was told about the cell phone policy")).toBeNull();
    expect(readPolicyChange("add to the observation that she signed the policy acknowledgement")).toBeNull();
  });

  it("on: a policy named to add is still one", () => {
    vi.stubEnv("ADD_THAT_IS_ACCOUNT_ENABLED", "true");
    expect(readPolicyChange("add that policy too")).toBe("add");
    expect(readPolicyChange("add the attendance policy")).toBe("add");
    expect(readPolicyChange("also cite the late opening policy")).toBe("add");
  });
});

describe("addsAccountClause", () => {
  it("a clause after add / note / include; never a demonstrative that", () => {
    expect(addsAccountClause(SAID)).toBe(true);
    expect(addsAccountClause("add that section as well")).toBe(false);
    expect(addsAccountClause("add the attendance policy")).toBe(false);
  });
});
