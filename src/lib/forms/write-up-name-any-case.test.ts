import { afterEach, describe, expect, it, vi } from "vitest";

import { extractEmployeeNames } from "./proposal";
import { canonicalShorthand } from "./template-intent";

/* October triage #1 (the sibling app's #202), the table's wording with an invented name. */
const SAID = "write up marisol pennick for opening the salon late today";

describe("WRITE_UP_NAME_ANY_CASE_ENABLED", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("off: lower case and capitals name nobody, as before", () => {
    vi.stubEnv("WRITE_UP_NAME_ANY_CASE_ENABLED", "false");
    expect(extractEmployeeNames(SAID)).toEqual([]);
    expect(extractEmployeeNames(SAID.toUpperCase())).toEqual([]);
  });

  it("on: the person written up is read however it is typed", () => {
    vi.stubEnv("WRITE_UP_NAME_ANY_CASE_ENABLED", "true");
    expect(extractEmployeeNames(SAID)).toEqual(["marisol pennick"]);
    expect(extractEmployeeNames(SAID.toUpperCase())).toEqual(["MARISOL PENNICK"]);
    expect(extractEmployeeNames("Write up Marisol Pennick for opening the salon late today")).toEqual(["Marisol Pennick"]);
  });

  it("on: a thing written up is left alone", () => {
    vi.stubEnv("WRITE_UP_NAME_ANY_CASE_ENABLED", "true");
    for (const said of ["write up the notes from today", "write up a summary", "write up her for being late", "write up for marisol", "writing up everything"]) {
      expect(canonicalShorthand(said)).toBe(said);
    }
  });
});
