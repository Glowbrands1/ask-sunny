import { afterEach, describe, expect, it } from "vitest";

import { readEmployeeMentions } from "./proposal";

/*
 * CAPS_PREPOSITION_NOT_NAME_ENABLED. QA's exact name matrix (4 Nov 2026), "last-date-caps", word for word with the
 * invented name of the replay pack (`nov4-live-regressions-cases.ts`).
 */
const CAPS = "CORRECTIVE ACTION: A GUEST WAS TREATED RUDELY AT THE FRONT DESK ON MONDAY 10/05/2026 BY CORIN BELLWEATHER";
const FLAG = "CAPS_PREPOSITION_NOT_NAME_ENABLED";

afterEach(() => {
  delete process.env[FLAG];
});

describe("CAPS_PREPOSITION_NOT_NAME_ENABLED", () => {
  it("off: as before, the preposition is part of the name", () => {
    process.env[FLAG] = "false";
    expect(readEmployeeMentions(CAPS).names).toEqual(["BY CORIN BELLWEATHER"]);
  });

  it("on: the name is read without the preposition, in capitals", () => {
    process.env[FLAG] = "true";
    expect(readEmployeeMentions(CAPS).names).toEqual(["CORIN BELLWEATHER"]);
    expect(readEmployeeMentions("COACHING FORM: SHE GOT A COMPLAINT FROM DARA QUINLEY TODAY").names).not.toContain("FROM DARA QUINLEY");
  });

  it("on: sentence case and a two-word run are unchanged", () => {
    process.env[FLAG] = "true";
    expect(readEmployeeMentions(CAPS.replace(/BY CORIN BELLWEATHER$/, "by Corin Bellweather")).names).toEqual(["Corin Bellweather"]);
    expect(readEmployeeMentions("Coaching form for Per Lindqvist").names).toContain("Per Lindqvist");
  });
});
