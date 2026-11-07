import { describe, expect, it } from "vitest";

import { citesSetAside, policiesSetAside, takesPolicyOff, valuesWithPolicySetAside, withPolicySetAside, withoutPolicyTakeOff } from "./policy-set-aside";

// QA, 8 Nov 2026 (live in both apps), word for word.
const SAID = "take the attendance policy off the form";
const NAMED = "create a corrective action for marnie holloway for violating the attendance policy, she was 30 minutes late to her shift on 10/31";

describe("takesPolicyOff", () => {
  it.each([
    SAID,
    "take the policy off",
    "please remove the attendance policy",
    "leave the attendance policy off",
    "don't cite the attendance policy",
    "get the dress code off the card",
  ])("%s", (sentence) => expect(takesPolicyOff(sentence)).toBe(true));

  it.each([
    NAMED,
    "she took the trash out after close",
    "she removed the towels from the beds",
    "take the date off",
    "actually it is the attendance policy",
  ])("not: %s", (sentence) => expect(takesPolicyOff(sentence)).toBe(false));
});

describe("policiesSetAside", () => {
  it("sets aside the policy named in the take-off, until it is named again", () => {
    expect([...policiesSetAside([NAMED, SAID]).names]).toEqual(["attendance"]);
    expect([...policiesSetAside([NAMED, SAID, "she also left early"]).names]).toEqual(["attendance"]);
    expect([...policiesSetAside([NAMED, SAID, "actually it is the attendance policy"]).names]).toEqual([]);
    expect(policiesSetAside([NAMED]).names.size).toBe(0);
  });

  it("\"take the policy off\" with none named sets aside whatever the card cites", () => {
    expect(policiesSetAside([NAMED, "take the policy off"]).any).toBe(true);
    expect(policiesSetAside([NAMED, "take the policy off", "use the dress code policy"]).any).toBe(false);
  });
});

describe("withoutPolicyTakeOff", () => {
  it("keeps the account and drops the ask", () => {
    expect(withoutPolicyTakeOff([NAMED, SAID])).toEqual([NAMED]);
    expect(withoutPolicyTakeOff(["she was late. take the attendance policy off the form."])).toEqual(["she was late."]);
  });
});

describe("the card and the draft", () => {
  const setAside = policiesSetAside([NAMED, SAID]);

  it("drops the policy row and the manual citation, and says so", () => {
    const card = [
      "I'll draft a **Corrective Action Form** for **Marnie Holloway**.",
      "",
      "**Policy:** Attendance, as you said. I'll quote that section from the current policy manual on the draft.",
      "",
      "Attendance Policy, JBA Policy Manual p.14",
      "",
      "**Observation of Offense:** she was 30 minutes late to her shift on 10/31",
    ].join("\n");
    expect(withPolicySetAside(card, setAside)).toBe(
      [
        "I'll draft a **Corrective Action Form** for **Marnie Holloway**.",
        "",
        "**Observation of Offense:** she was 30 minutes late to her shift on 10/31",
        "",
        "**Policy:** none — you took the Attendance policy off, so I won't cite it on the draft. Tell me if a different policy applies.",
      ].join("\n"),
    );
  });

  it("keeps a policy that was not taken off", () => {
    expect(citesSetAside("Dress Code Policy, JBA Policy Manual p.20", setAside)).toBe(false);
    expect(withPolicySetAside("**Date:** 10/31/2026", policiesSetAside([NAMED]))).toBe("**Date:** 10/31/2026");
  });

  it("empties the policy fields and the Policy reference line that cite it", () => {
    expect(
      valuesWithPolicySetAside(
        {
          policy_violated: "Attendance Policy, JBA Policy Manual p.14",
          policy_language: "Each employee knows their schedule … Source: 2025 JBA Policy Manual - — Attendance, p. 14",
          coaching_details: "Observed:\nShe was late.\n\nPolicy reference: Attendance Policy, JBA Policy Manual p.14",
          observation: "Observed:\nShe was late.",
        },
        setAside,
      ),
    ).toEqual({ policy_violated: "", policy_language: "", coaching_details: "Observed:\nShe was late.", observation: "Observed:\nShe was late." });
  });
});
