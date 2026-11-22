import { describe, expect, it } from "vitest";

import { speaksOfTheManager, withoutManagerReasoning } from "./reasoning-leak";

/* QA's re-run (22 Nov 2026, A13; found in Ask Bubbles, same loop in Sunny): the reply leaked the model's reasoning. */
const LEAK = "The manager's request to add this is about the card on screen (the open draft), not an older form on file.";

describe("reasoning leak (A13)", () => {
  it("a sentence about the manager in the third person is reasoning, and only it is left out", () => {
    const reply = `${LEAK} Added to Prior actions: signed the JBA Policy Manual on 10/15/2026.`;
    expect(speaksOfTheManager(reply)).toBe(true);
    expect(withoutManagerReasoning(reply)).toBe("Added to Prior actions: signed the JBA Policy Manual on 10/15/2026.");
  });

  it("the manual's quoted words are never reasoning (\"> The manager of the salon will be required to open …\")", () => {
    const reply = "Here's the card.\n\n**Policy:** Late Opening Policy, JBA Policy Manual p.15\n\n> The manager of the salon will be required to open the salon on time.";
    expect(speaksOfTheManager(reply)).toBe(false);
    expect(withoutManagerReasoning(reply)).toBe(reply);
  });

  it("a reply written to the manager as \"you\" passes", () => {
    expect(speaksOfTheManager("Added it to the card. Want anything else changed?")).toBe(false);
  });
});
