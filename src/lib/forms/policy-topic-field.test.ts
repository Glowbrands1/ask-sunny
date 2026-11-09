import { describe, expect, it } from "vitest";

import { JBA_MANUAL_CA_CHUNKS } from "@/test/fixtures/jba-manual-ca-sections";

import { fieldNamedIn, pointsAtManual, policyFieldText, policyTopicAsked, sectionForTopic } from "./policy-topic-field";

/**
 * POLICY_TOPIC_INTO_FIELD_ENABLED. Ported from the sibling app (QA, a manager's 1★ rating there, 10 Nov 2026): "I asked it to write a coaching form on our
 * policy for finding a cover and the sentence it gave me was to refer to the woven policy manual for finding a cover."
 * The edit, in the manager's words (their typo kept): "In details of coaching inlude our woven policy on finding a cover
 * for your shift". The manual fixture's wording is invented; its headings and pages are the manual's.
 */
const EDIT = "In details of coaching inlude our woven policy on finding a cover for your shift";
const LABELS = { coaching_details: "Details of Coaching", coaching_topic: "Coaching Topic", form_date: "Date" };

describe("policyTopicAsked", () => {
  it("the manager's edit asks for the policy on finding a cover", () => {
    expect(policyTopicAsked(EDIT)).toBe("finding a cover for your shift");
  });

  it("other ways of asking", () => {
    expect(policyTopicAsked("add the company policy about cell phones to the details")).toBe("cell phones");
    expect(policyTopicAsked("please include our shift replacement policy")).toBe("shift replacement");
  });

  it("a question about a policy, or an edit with no policy asked, is not this", () => {
    expect(policyTopicAsked("what is our woven policy on finding a cover for your shift?")).toBeNull();
    expect(policyTopicAsked("make it about showing up late")).toBeNull();
    expect(policyTopicAsked("the policy manual says to call your supervisor")).toBeNull();
  });
});

describe("fieldNamedIn", () => {
  it("\"In details of coaching …\" names Details of Coaching", () => {
    expect(fieldNamedIn(EDIT, LABELS)).toBe("coaching_details");
    expect(fieldNamedIn("add our policy on cell phones", LABELS)).toBeNull();
  });
});

describe("sectionForTopic", () => {
  it("finding a cover for your shift is Shift Replacement, printed page 37", () => {
    const section = sectionForTopic("finding a cover for your shift", JBA_MANUAL_CA_CHUNKS);
    expect(section).toMatchObject({ heading: "Shift Replacement", page: 37 });
  });

  it("a section named outright is that section", () => {
    expect(sectionForTopic("visitors in the workplace", JBA_MANUAL_CA_CHUNKS)?.heading).toBe("Visitors in the Workplace");
  });

  it("a topic the manual has no section on: none, never a guess", () => {
    expect(sectionForTopic("pet insurance", JBA_MANUAL_CA_CHUNKS)).toBeNull();
    expect(sectionForTopic("finding a cover for your shift", [])).toBeNull();
  });
});

describe("policyFieldText", () => {
  it("the section's own text and its citation, never a pointer to the manual", () => {
    const section = sectionForTopic("finding a cover for your shift", JBA_MANUAL_CA_CHUNKS)!;
    const text = policyFieldText(section, JBA_MANUAL_CA_CHUNKS);
    expect(text).toMatch(/^Shift Replacement: Trading shifts is discouraged/);
    expect(text).toMatch(/finds their own replacement/);
    expect(text).toMatch(/\nPolicy reference: Shift Replacement Policy, JBA Policy Manual p\.37$/);
    expect(pointsAtManual(text)).toBe(false);
  });
});

describe("pointsAtManual", () => {
  it("the sentence the manager got is a pointer", () => {
    expect(pointsAtManual("Refer to the Woven policy manual for finding a cover for your shift.")).toBe(true);
    expect(pointsAtManual("See the employee handbook for details.")).toBe(true);
    expect(pointsAtManual("Find a replacement and get your manager's approval.")).toBe(false);
  });
});

describe("a salon policy topic", () => {
  it("\"our policy on cell phone use on the salon floor\" is the Cell Phone/Smart Watch Policy, printed page 19", () => {
    const edit = "In details of coaching include our policy on cell phone use on the salon floor";
    const topic = policyTopicAsked(edit)!;
    expect(topic).toBe("cell phone use on the salon floor");
    expect(sectionForTopic(topic, JBA_MANUAL_CA_CHUNKS)).toMatchObject({ heading: "Cell Phone/Smart Watch Policy", page: 19 });
  });
});
