import { describe, expect, it } from "vitest";

import { ownPersonAccount } from "./observation-own-person";

/** OBSERVATION_OWN_PERSON_ONLY_ENABLED. QA's P7, Sunny live (10 Nov 2026), in the managers' words; the people invented. */
describe("ownPersonAccount", () => {
  it("the P7 Observation keeps neither the other people nor the command", () => {
    expect(ownPersonAccount("Corwin, and Ione for not closing duties correctly")).toBe("Not closing duties correctly");
    expect(ownPersonAccount("create draft for failure to do closing duties and staying over hours")).toBe("Failure to do closing duties and staying over hours");
    expect(ownPersonAccount("Corwin Halsey and Ione Marchetti for not closing duties correctly")).toBe("Not closing duties correctly");
  });

  it("an account that starts otherwise is as it was", () => {
    expect(ownPersonAccount("She left the closing duties undone on 11/8 and stayed over her hours.")).toBe("She left the closing duties undone on 11/8 and stayed over her hours.");
    expect(ownPersonAccount("Not closing duties correctly")).toBe("Not closing duties correctly");
    expect(ownPersonAccount("Late Opening for 3 days in a row")).toBe("Late Opening for 3 days in a row");
  });

  it("nothing left: null", () => {
    expect(ownPersonAccount("create draft for ")).toBeNull();
  });
});
