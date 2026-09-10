import { describe, expect, it } from "vitest";

import {
  POLICY_SEPARATION_RULES,
  stripUnsupportedPolicyClaims,
  stripUnsupportedPolicyRequirements,
} from "./policy-claim-guard";

/**
 * ============================================================================
 * THE OBSERVATION KEEPS THE FACT AND LOSES THE FINDING
 * ============================================================================
 *
 * The failure this guard exists for, from QA, verbatim:
 *
 *   "On September 10, 2026, Sarah Test was observed wearing a mini skirt at
 *    the Kearny salon location, which is not in compliance with the Sun Tan
 *    City dress code policy."
 *
 * on a form whose Policy Violated field was blank, because retrieval had found
 * nothing to put in it. The record asserted a breach and declined to name the
 * rule.
 *
 * TWO PROPERTIES, AND THE SECOND IS AS IMPORTANT AS THE FIRST:
 *
 *   the finding goes, and
 *   THE FACT STAYS. Emptying Observation of Offense on a corrective action
 *   record would be a worse document than the one being fixed, so a clause is
 *   cut wherever the sentence survives without it.
 */

const NONE: ReadonlySet<string> = new Set();

function strip(values: Record<string, string>, skip: ReadonlySet<string> = NONE) {
  return stripUnsupportedPolicyClaims(values, skip);
}

describe("1. the QA sentence", () => {
  const OBSERVED =
    "On September 10, 2026, Sarah Test was observed wearing a mini skirt at the Kearny salon location, which is not in compliance with the Sun Tan City dress code policy.";

  it("keeps what was seen and drops what was concluded", () => {
    const result = strip({ observation: OBSERVED });

    expect(result.values.observation).toBe(
      "On September 10, 2026, Sarah Test was observed wearing a mini skirt at the Kearny salon location.",
    );
    expect(result.adjusted).toEqual(["observation"]);
    expect(result.emptied).toEqual([]);
  });
});

describe("2. the shapes a finding arrives in", () => {
  const FACT = "Sarah arrived twenty minutes after her scheduled start time";

  it.each([
    ["which violates", `${FACT}, which violates the attendance policy.`],
    ["which is a violation of", `${FACT}, which is a violation of company policy.`],
    ["in violation of", `${FACT}, in violation of the attendance policy.`],
    ["which is prohibited", `${FACT}, which is prohibited under the handbook.`],
    ["contrary to", `${FACT}, contrary to the dress code.`],
    ["which does not comply", `${FACT}, which does not comply with our standards.`],
    ["which is not in keeping", `${FACT}, which is not in keeping with company policy.`],
    ["and which breaches", `${FACT} and which breaches the standards of conduct.`],
  ])("cuts the clause — %s", (_label, text) => {
    const result = strip({ observation: text });

    expect(result.values.observation).toBe(`${FACT}.`);
    expect(result.adjusted).toEqual(["observation"]);
  });

  it("drops a whole sentence that is nothing but a finding", () => {
    const result = strip({
      observation: `${FACT}. This is a violation of the dress code policy.`,
    });

    expect(result.values.observation).toBe(`${FACT}.`);
    expect(result.adjusted).toEqual(["observation"]);
  });

  it("leaves the field empty, and says so, when nothing survives", () => {
    const result = strip({
      observation: "This is a clear breach of the standards of conduct policy.",
    });

    expect(result.values.observation).toBeUndefined();
    expect(result.emptied).toEqual(["observation"]);
    expect(result.adjusted).toEqual([]);
  });
});

describe("3. what it must not touch", () => {
  it.each([
    [
      "a plain observation",
      "On Tuesday, Sarah clocked in twenty minutes after her scheduled start time.",
    ],
    [
      "a policy DISCUSSED rather than breached",
      "The dress code was discussed with Sarah at her onboarding in March.",
    ],
    [
      "a forward-looking expectation",
      "Sarah is expected to comply with the current dress code requirements for every scheduled shift.",
    ],
    [
      "management's own commitment",
      "Management will review the applicable dress code expectation with Sarah and confirm understanding.",
    ],
    [
      "an account with no rule in it at all",
      "Sarah left the salon floor unattended for fifteen minutes during her closing shift.",
    ],
  ])("%s", (_label, text) => {
    const result = strip({ observation: text });

    expect(result.values.observation).toBe(text);
    expect(result.adjusted).toEqual([]);
    expect(result.emptied).toEqual([]);
  });

  it("preserves the line structure of a labelled field", () => {
    const text = [
      "Observed: Sarah clocked in twenty minutes late.",
      "",
      "Expectation: employees are ready to work at their scheduled start time.",
    ].join("\n");

    expect(strip({ details: text }).values.details).toBe(text);
  });

  /*
   * THE GROUNDED FIELDS BELONG TO `policy-grounding.ts`, which refuses them
   * outright when retrieval found nothing — a stronger rule than this one.
   * Tidying a value that is about to be refused would only risk making it look
   * keepable.
   */
  it("does not touch the fields the policy guard owns", () => {
    const values = {
      policy_violated: "Dress Code Violation, which is a violation of policy.",
      observation: "Sarah wore a mini skirt, which violates the dress code.",
    };

    const result = strip(values, new Set(["policy_violated"]));

    expect(result.values.policy_violated).toBe(values.policy_violated);
    expect(result.values.observation).toBe("Sarah wore a mini skirt.");
    expect(result.adjusted).toEqual(["observation"]);
  });

  it("leaves an empty or absent value alone", () => {
    expect(strip({ observation: "" }).values.observation).toBe("");
    expect(strip({}).adjusted).toEqual([]);
  });
});

describe("4. the same separation, said to the model", () => {
  it("tells it an observation states what was seen and not what it broke", () => {
    expect(POLICY_SEPARATION_RULES.join(" ")).toMatch(
      /An observation states WHAT WAS SEEN OR HEARD and never whether it broke a rule/,
    );
  });

  it("tells it an offense category is not a policy", () => {
    expect(POLICY_SEPARATION_RULES.join(" ")).toMatch(
      /The Type of Offense boxes are CATEGORIES you may tick\. They are not policies\./,
    );
  });

  it("tells it not to invent a requirement the retrieved policy does not state", () => {
    expect(POLICY_SEPARATION_RULES.join(" ")).toMatch(
      /Never state a specific rule the approved policy in front of you does not state/,
    );
  });
});

/* ==================================================================== */
/*  AN ACTION PLAN MAY SET AN EXPECTATION. IT MAY NOT WRITE A RULE.     */
/* ==================================================================== */

/**
 * QA's own case: told "she was wearing mini skirt today", with no dress code
 * retrieved, the draft's Action Plan read
 *
 *   "Sarah must wear pants instead of skirts."
 *
 * Nothing in the corpus says this company requires trousers. It is an invented
 * rule, and it is more dangerous than an invented quotation — it reads as the
 * manager's own instruction and is what the employee gets held to.
 */
describe("5. unsourced requirements in the Action Plan", () => {
  const FALLBACK =
    "Sarah Test is expected to comply with the current Sun Tan City requirements for each scheduled shift. Management will review the applicable expectation with Sarah Test, confirm understanding, and monitor compliance.";

  function strip(values: Record<string, string>, retrieved = "") {
    return stripUnsupportedPolicyRequirements(values, NONE, retrieved, FALLBACK);
  }

  it("removes the mini-skirt rule and puts the safe expectation in its place", () => {
    const result = strip({ action_plan: "Sarah must wear pants instead of skirts." });

    expect(result.values.action_plan).toBe(FALLBACK);
    expect(result.values.action_plan).not.toMatch(/must wear pants/i);
    expect(result.values.action_plan).not.toMatch(/skirt/i);
    expect(result.adjusted).toEqual(["action_plan"]);
    expect(result.replaced).toEqual(["action_plan"]);
  });

  it.each([
    ["prohibition", "Skirts are prohibited on the salon floor."],
    ["name badge", "Sarah must wear her name badge at all times."],
    ["tucked in", "Her shirt must be tucked in for every shift."],
    ["footwear", "Sarah is required to wear closed-toe shoes."],
    ["phone in a locker", "Her personal phone must remain in a locker during her shift."],
    ["notice period", "Sarah must give 4 hours notice before a call-out."],
    ["hemline", "Skirts must reach mid-thigh or longer."],
  ])("removes an unsourced requirement — %s", (_label, sentence) => {
    const result = strip({ action_plan: sentence });

    expect(result.adjusted).toEqual(["action_plan"]);
    expect(result.values.action_plan).toBe(FALLBACK);
  });

  /*
   * THE DISCRIMINATOR IS THE OBJECT, NOT THE VERB. These are behaviours a
   * manager may set without any manual behind them, and they are the whole
   * reason the Action Plan exists.
   */
  it.each([
    ["punctuality", "Sarah must arrive on time and be ready to work at the start of her shift."],
    ["assigned work", "Sarah is required to complete her assigned closing duties before leaving."],
    ["client engagement", "Sarah must engage each client with relevant questions."],
    ["the safe generic", FALLBACK],
    [
      "generic compliance with a named rule",
      "Sarah is expected to comply with the current Sun Tan City dress code requirements for each scheduled shift.",
    ],
    [
      "management's own commitment",
      "Management will review the applicable dress code expectation with Sarah and confirm understanding.",
    ],
  ])("leaves a legitimate plan alone — %s", (_label, sentence) => {
    const result = strip({ action_plan: sentence });

    expect(result.values.action_plan).toBe(sentence);
    expect(result.adjusted).toEqual([]);
  });

  it("keeps a requirement the retrieved policy actually states", () => {
    const retrieved = "Skirts and dresses must reach mid-thigh or longer while on the salon floor.";
    const sentence = "Sarah must ensure skirts reach mid-thigh or longer on every shift.";

    const result = strip({ action_plan: sentence }, retrieved);

    expect(result.values.action_plan).toBe(sentence);
    expect(result.adjusted).toEqual([]);
  });

  it("still removes a requirement the retrieved policy does NOT state", () => {
    // The manual covers hemlines. It says nothing about footwear, and one
    // sourced requirement does not license a second.
    const retrieved = "Skirts and dresses must reach mid-thigh or longer while on the salon floor.";

    const result = strip(
      { action_plan: "Sarah must wear closed-toe shoes on every shift." },
      retrieved,
    );

    expect(result.adjusted).toEqual(["action_plan"]);
    expect(result.values.action_plan).toBe(FALLBACK);
  });

  it("keeps the surviving sentences and appends the safe expectation", () => {
    const result = strip({
      action_plan:
        "Sarah must arrive on time for every shift. Sarah must wear pants instead of skirts.",
    });

    expect(result.values.action_plan).toContain("Sarah must arrive on time for every shift.");
    expect(result.values.action_plan).not.toMatch(/pants/i);
    expect(result.values.action_plan).toContain(FALLBACK);
    expect(result.replaced).toEqual([]);
  });

  it("does not touch the fields the policy guard owns", () => {
    const result = stripUnsupportedPolicyRequirements(
      { policy_language: "Employees must wear closed-toe shoes." },
      new Set(["policy_language"]),
      "",
      FALLBACK,
    );

    expect(result.values.policy_language).toBe("Employees must wear closed-toe shoes.");
    expect(result.adjusted).toEqual([]);
  });
});
