import { describe, expect, it } from "vitest";

import { saidFormDate } from "./form-date-said";

const TODAY = "2026-11-07";

describe("saidFormDate", () => {
  it.each([
    // QA, 8 Nov 2026, word for word.
    ["I need you to make it about showing up late and please list the policy make the date for 10/14/26.", "2026-10-14"],
    ["set the date to 10/14/26", "2026-10-14"],
    ["change the form's date to 10-14-26", "2026-10-14"],
    ["date it 10/14/26", "2026-10-14"],
    ["the date should be 10/14/26", "2026-10-14"],
    ["make the date for 10/10/26. actually make the date for 10/14/26", "2026-10-14"],
  ])("%s", (text, iso) => expect(saidFormDate(text, TODAY)).toBe(iso));

  it.each([
    "he missed the monthly meeting on 10/10/26",
    "she was late on 10/5/26 and again on 10/15/26",
    "follow up on 11/14/26",
    "she was coached on 9/1/26 about the date of the meeting",
  ])("not: %s", (text) => expect(saidFormDate(text, TODAY)).toBeNull());
});
