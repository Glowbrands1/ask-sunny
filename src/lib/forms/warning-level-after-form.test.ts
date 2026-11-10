import { afterEach, describe, expect, it } from "vitest";

import { statedWarningLevel } from "./warning-level";

/*
 * LEVEL_AFTER_FORM_NAME_ENABLED. The manager's words are verbatim (QA's overnight scan sf-s19, 4 Nov 2026); the person
 * is invented. The replay pack runs the chat: `nov4-overnight-scan-cases.ts` (sf-s19).
 */
const S19 = "I need a corrective action verbal for Odalys Frewen. This is for Under Performance on PPTA, LPSVA, Club Average, Club Close %, and Spa %.";

afterEach(() => {
  delete process.env.LEVEL_AFTER_FORM_NAME_ENABLED;
});

describe("the level named after the form", () => {
  it("\"a corrective action verbal for <A>\" is Verbal with the flag on, nothing with it off", () => {
    expect(statedWarningLevel(S19)).toBeNull();
    process.env.LEVEL_AFTER_FORM_NAME_ENABLED = "true";
    expect(statedWarningLevel(S19)).toBe("verbal");
    expect(statedWarningLevel("make a ca written for Odalys Frewen")).toBe("written");
  });

  it("a step already taken states nothing", () => {
    process.env.LEVEL_AFTER_FORM_NAME_ENABLED = "true";
    expect(statedWarningLevel("she had a ca verbal on 9/1 for the same thing")).toBeNull();
    expect(statedWarningLevel("her last ca written was in august")).toBeNull();
  });
});
