import { describe, expect, it } from "vitest";

import {
  applyEmployeeName,
  employeeFirstName,
  employeeNameRules,
  nameInsteadOfPronouns,
} from "./employee-reference";
import { TEAM_SUBJECT_LABEL } from "./team-subject";

/**
 * HR feedback, 3 Oct 2026: "Stop using pronouns in verbiage for forms — site
 * employee first name." Shared by every drafting path; see
 * `employee-reference.ts` for the rules and for why the rewrite is cautious.
 */

const rewrite = (text: string, name = "Jessica Moss") => nameInsteadOfPronouns(text, name).text;

describe("the employee's first name", () => {
  it("is the first word of the record's subject", () => {
    expect(employeeFirstName("Jessica Moss")).toBe("Jessica");
    expect(employeeFirstName("Paulyne Test")).toBe("Paulyne");
  });

  it("is written as a name even when the record was typed in one case", () => {
    expect(employeeFirstName("colene schildt")).toBe("Colene");
    expect(employeeFirstName("DANA MOSS")).toBe("Dana");
    expect(employeeFirstName("McKenna Ray")).toBe("McKenna");
  });

  it("is nobody on a team form, or with no subject", () => {
    expect(employeeFirstName(TEAM_SUBJECT_LABEL)).toBeNull();
    expect(employeeFirstName("")).toBeNull();
    expect(employeeFirstName(null)).toBeNull();
  });
});

describe("the drafting rule every form prompt carries", () => {
  it("names the employee and forbids the pronouns", () => {
    const rules = employeeNameRules("Jessica Moss").join(" ");
    expect(rules).toMatch(/first name, "Jessica"/);
    expect(rules).toMatch(/never by a pronoun/);
    expect(rules).toMatch(/Jessica failed to follow the attendance policy/);
    // And protects what is quoted.
    expect(rules).toMatch(/quotation marks.*stays exactly as it was written/);
  });

  it("is absent on a team-wide form", () => {
    expect(employeeNameRules(TEAM_SUBJECT_LABEL)).toEqual([]);
  });
});

describe("pronouns become the first name", () => {
  it("the example HR gave", () => {
    expect(rewrite("She failed to follow the attendance policy.")).toBe(
      "Jessica failed to follow the attendance policy.",
    );
  });

  it.each([
    ["He arrived 20 minutes late.", "Jessica arrived 20 minutes late."],
    ["Moving forward, she should arrive on time.", "Moving forward, Jessica should arrive on time."],
    ["She did not clock in for her shift.", "Jessica did not clock in for Jessica's shift."],
    ["He left his station unattended.", "Jessica left Jessica's station unattended."],
    ["The manager spoke with her about it.", "The manager spoke with her about it."], // another person in the sentence: left alone
    ["I spoke to her directly.", "I spoke to Jessica directly."],
    ["She's been late twice this week.", "Jessica has been late twice this week."],
    ["She's expected to be on time.", "Jessica is expected to be on time."],
    ["She'll review the standard.", "Jessica will review the standard."],
    ["Observed:\nShe arrived late.", "Observed:\nJessica arrived late."],
  ])("%s", (before, after) => {
    expect(rewrite(before)).toBe(after);
  });

  it("does they/their/them with the verb agreeing", () => {
    expect(rewrite("They are expected to arrive on time.")).toBe("Jessica is expected to arrive on time.");
    expect(rewrite("They were late today.")).toBe("Jessica was late today.");
    expect(rewrite("They have not completed the task.")).toBe("Jessica has not completed the task.");
    expect(rewrite("They arrived 30 minutes late.")).toBe("Jessica arrived 30 minutes late.");
    expect(rewrite("Moving forward, they should check their schedule.")).toBe(
      "Moving forward, Jessica should check Jessica's schedule.",
    );
  });

  it("rewrites the whole Action Plan the drafting prompt asks for", () => {
    const plan =
      "Jessica is expected to adhere to the Sun Tan City attendance policy by arriving on time. Moving forward, she should arrive ready to work at the start of her shift. Management will monitor compliance and provide coaching as needed.";
    const result = nameInsteadOfPronouns(plan, "Jessica Moss", ["Sun Tan City"]);
    expect(result.text).toBe(
      "Jessica is expected to adhere to the Sun Tan City attendance policy by arriving on time. Moving forward, Jessica should arrive ready to work at the start of Jessica's shift. Management will monitor compliance and provide coaching as needed.",
    );
    expect(result.replaced).toBe(2);
    expect(result.text).not.toMatch(/\b(?:she|her|he|his|they|their)\b/i);
  });
});

describe("what is never rewritten", () => {
  it("text in quotation marks — somebody's words, or the manual's", () => {
    expect(rewrite('She said "he told me I could leave early" before her shift.')).toBe(
      'Jessica said "he told me I could leave early" before Jessica\'s shift.',
    );
    const manual = "“An employee must notify her manager before she leaves the salon.”";
    expect(rewrite(manual)).toBe(manual);
  });

  it("a sentence that names another person, who the pronoun could mean", () => {
    for (const sentence of [
      "A client complained that she was ignored.",
      "Jessica told Maria she would cover the shift.",
      "Sarah clocked in twenty minutes after her scheduled start time.",
      "A coworker said he saw the drawer open.",
    ]) {
      expect(rewrite(sentence), sentence).toBe(sentence);
    }
  });

  it("a sentence with both he and she — two people", () => {
    const sentence = "She asked if he could close for her.";
    expect(rewrite(sentence)).toBe(sentence);
  });

  it("they, where something plural is in the sentence", () => {
    const sentence = "Jessica left the towels where they fell.";
    expect(rewrite(sentence)).toBe(sentence);
  });

  it("anything at all on a team-wide form", () => {
    expect(nameInsteadOfPronouns("She arrived late.", TEAM_SUBJECT_LABEL).text).toBe("She arrived late.");
  });
});

describe("across a draft", () => {
  const fields = [
    { key: "observation", input: "long_text", responsibility: "ai" },
    { key: "action_plan", input: "long_text", responsibility: "ai" },
    { key: "policy_language", input: "long_text", responsibility: "ai", policyGrounded: true },
    { key: "policy_violated", input: "text", responsibility: "ai" },
    { key: "manager_notes", input: "long_text", responsibility: "manager" },
    { key: "form_date", input: "date", responsibility: "system" },
  ];

  it("rewrites the assistant's prose and nothing else", () => {
    const quoted = "Employees must notify their manager before they leave. Source: JBA Policy Manual, p. 12";
    const result = applyEmployeeName({
      values: {
        observation: "Observed:\nShe arrived late.",
        action_plan: "Moving forward, she should arrive on time.",
        policy_language: quoted,
        policy_violated: "She violated attendance",
        manager_notes: "She was late.",
      },
      fields,
      employeeName: "Jessica Moss",
      skipKeys: new Set(["policy_violated"]),
    });
    expect(result.values.observation).toBe("Observed:\nJessica arrived late.");
    expect(result.values.action_plan).toBe("Moving forward, Jessica should arrive on time.");
    // The manual's own words, a derived value, and the manager's own typing are untouched.
    expect(result.values.policy_language).toBe(quoted);
    expect(result.values.policy_violated).toBe("She violated attendance");
    expect(result.values.manager_notes).toBe("She was late.");
    expect(result.adjusted.sort()).toEqual(["action_plan", "observation"]);
  });
});
