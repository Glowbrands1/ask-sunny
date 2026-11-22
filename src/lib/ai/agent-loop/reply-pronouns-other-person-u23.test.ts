import { describe, expect, it } from "vitest";

import { withoutPersonPronouns } from "./reply-pronouns";

/*
 * QA's round 2 (22 Nov 2026, U23; found in Ask Bubbles), the manager's words (the person invented): "Today, while checking out a
 * customer, she asked another employee what they would do if they had 8 arms and 8 legs." became "<P> asked another
 * employee what <P> would do if <P> had 8 arms and 8 legs": "they" was the other employee.
 */
const U23 = "Today, while checking out a customer, she asked another employee what they would do if they had 8 arms and 8 legs.";

describe("a pronoun of another person in a reported clause stays (U23)", () => {
  it("\"they\" in a clause \"she\" reports is the other employee", () => {
    const { text } = withoutPersonPronouns(`**Observation of Offense:** ${U23}`, "Juno");
    expect(text).toContain("Juno asked another employee what they would do if they had 8 arms and 8 legs.");
  });

  it("the card's person's own pronoun in her reported clause is still named", () => {
    const { text } = withoutPersonPronouns("**Observation of Offense:** She said she was sick.", "Juno");
    expect(text).toBe("**Observation of Offense:** Juno said Juno was sick.");
  });
});
