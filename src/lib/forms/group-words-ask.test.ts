import { afterEach, describe, expect, it, vi } from "vitest";

import { formTopic, groupNamed, withGroupWordsAsk } from "./group-words-ask";
import { isGroupOfPeople, isNotAName } from "./not-a-name";

// QA's Problem 19 (the sibling app, 11 Nov 2026), the manager's exact wording; reproduced here.
const T1 = "create a coaching form about accountability";
const T3 = "I want the same form for multiple employees";

const askWho = { content: "Who is this form for? Tell me the employee's full name.", formProposal: { employeeName: null, templateName: "Coaching Form", status: "needs_employee" } };

afterEach(() => vi.unstubAllEnvs());

describe("GROUP_WORDS_NOT_A_NAME_ENABLED", () => {
  it("reads group words as a group of people, never a name", () => {
    for (const words of ["multiple employees", "Multiple Employees", "my employees", "several employees", "the team", "everyone", "my staff"]) {
      expect(isGroupOfPeople(words), words).toBe(true);
    }
    for (const name of ["Marlo Teague", "Jo", "Team Lead"]) expect(isGroupOfPeople(name), name).toBe(false);
  });

  it("off, 'multiple employees' is not turned down; on, it is", () => {
    vi.stubEnv("NOT_A_NAME_GUARD_ENABLED", "true");
    vi.stubEnv("GROUP_WORDS_NOT_A_NAME_ENABLED", "false");
    expect(isNotAName("multiple employees")).toBe(false);
    vi.stubEnv("GROUP_WORDS_NOT_A_NAME_ENABLED", "true");
    expect(isNotAName("multiple employees")).toBe(true);
  });

  it("finds the group and the topic in the manager's turns", () => {
    expect(groupNamed(T3)).toBe("multiple employees");
    expect(groupNamed(T1)).toBeNull();
    expect(formTopic([T1, T3])).toBe("accountability");
  });

  it("asks which employees, keeping the Coaching Form and its topic", () => {
    vi.stubEnv("GROUP_WORDS_NOT_A_NAME_ENABLED", "false");
    expect(withGroupWordsAsk(askWho, [T1, T3])).toBe(askWho);
    vi.stubEnv("GROUP_WORDS_NOT_A_NAME_ENABLED", "true");
    expect(withGroupWordsAsk(askWho, [T1, T3]).content).toBe(
      "Which employees? Tell me their full names, and I'll make the **Coaching Form** about accountability for each of them, one at a time.",
    );
    // A turn that names nobody as a group is left as it was.
    expect(withGroupWordsAsk(askWho, [T1])).toBe(askWho);
  });
});
