import { describe, expect, it } from "vitest";

import { statedWarningLevel, warningLevelFromTurns } from "./corrective-action-intake";

/*
 * QA X2, 22 Oct 2026: "make it a written warning" and then "no, keep it verbal"
 * kept Written on the Corrective Action. Taking a level back is a level
 * statement; the latest one wins. Synthetic conversation.
 */
describe("keeping a warning level is stating it", () => {
  it.each([
    ["no, keep it verbal", "verbal"],
    ["keep it verbal", "verbal"],
    ["keep it as a verbal", "verbal"],
    ["keep this written", "written"],
    ["no, make it verbal", "verbal"],
  ])("%s", (text, level) => {
    expect(statedWarningLevel(text)).toBe(level);
  });

  it.each(["keep it short", "keep it professional", "keep it up", "keep it verbal?"])("%s states no level", (text) => {
    expect(statedWarningLevel(text)).toBeNull();
  });

  it("the latest statement wins across turns: verbal, then written, then back to verbal", () => {
    expect(
      warningLevelFromTurns(["create a verbal ca for pat rivera, she was late today", "make it a written warning", "no, keep it verbal"]),
    ).toBe("verbal");
  });
});
