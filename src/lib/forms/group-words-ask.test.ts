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
    for (const words of ["multiple employees", "Multiple Employees", "my employees", "several employees", "several team members", "my staff"]) {
      expect(isGroupOfPeople(words), words).toBe(true);
    }
    // Changed on purpose (Gate-Bubbles-2, 11 Nov 2026): "the team" and "everyone" alone are left to whole-team coaching.
    for (const name of ["Marlo Teague", "Jo", "Team Lead", "the team", "everyone", "my team"]) expect(isGroupOfPeople(name), name).toBe(false);
    // A whole-team card's own name ("All team members", "All staff") is never turned down (the sibling app's team cards, 11 Nov 2026).
    for (const name of ["All team members", "All staff", "all employees"]) expect(isGroupOfPeople(name), name).toBe(false);
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
    // Gate-Bubbles-2 (11 Nov 2026): "the team" leading another noun is a thing, not a group of people.
    expect(groupNamed("create a coaching form about the team meeting")).toBeNull();
    expect(groupNamed("a CA for missing the staff meeting yesterday")).toBeNull();
    expect(groupNamed("I want the same form for my team.")).toBe("my team");
    expect(groupNamed("the same form for several employees who were late")).toBe("several employees");
    expect(formTopic([T1, T3])).toBe("accountability");
  });

  it("Gate-Bubbles-2 (11 Nov 2026), flag on: a group word that leads another noun is never a group; the topic is kept", () => {
    vi.stubEnv("GROUP_WORDS_NOT_A_NAME_ENABLED", "true");
    for (const turn of ["create a coaching form about the team meeting", "make a CA for my team lead", "coaching form for the staff room cleanup"]) {
      expect(groupNamed(turn), turn).toBeNull();
      expect(withGroupWordsAsk(askWho, [turn]), turn).toBe(askWho);
    }
    expect(groupNamed("I want the same form for multiple employees")).toBe("multiple employees");
    expect(groupNamed("create a coaching form for my employees")).toBe("my employees");
    expect(groupNamed("create a coaching form for all staff about accountability")).toBe("all staff");
    expect(groupNamed("the same form for my team please")).toBe("my team");
    expect(withGroupWordsAsk(askWho, ["create a coaching form for all staff about accountability"]).content).toBe(
      "Which employees? Tell me their full names, and I'll make the **Coaching Form** about accountability for each of them, one at a time.",
    );
  });

  it("Gate-Bubbles-2 (11 Nov 2026), flag on: a whole-team coaching request is never \"Which employees?\" (sf-s13's T1)", () => {
    vi.stubEnv("GROUP_WORDS_NOT_A_NAME_ENABLED", "true");
    const S13 =
      "I need to make a coaching form for the team at West Dodge Rd on selling Bath Bomb Kits, not writing proper rainchecks which results in inventory not being correct.";
    expect(groupNamed(S13)).toBeNull();
    for (const turn of [S13, "create a coaching form for my team on closing duties", "coaching form for everyone about the new raincheck rule"]) {
      expect(withGroupWordsAsk(askWho, [turn]), turn).toBe(askWho);
    }
    // A team card is never rewritten, whatever the turn says.
    const team = { ...askWho, formProposal: { ...askWho.formProposal, subject: "team" } };
    expect(withGroupWordsAsk(team, ["I want the same form for multiple employees"])).toBe(team);
    // Team words count when the turn repeats a form.
    expect(groupNamed("I want the same form for my team")).toBe("my team");
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
    expect(withGroupWordsAsk(askWho, ["create a coaching form about the team meeting"])).toBe(askWho);
  });
});
