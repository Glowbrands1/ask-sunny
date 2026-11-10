import { afterEach, describe, expect, it, vi } from "vitest";

import { titleNamesAnotherPerson } from "./title-of-another-person";

/** QA, 5 Nov 2026, R2 (the sibling app's report), in this app's words; every person invented. */
const R2 =
  "verbal warning The date she complained was Oct 31st . The guest said she was giving her an attitude when she brought up that the register was charging her for a lotion she did not buy and it has never done that before. When Odalys spoke with District manager Thessaly Brookhart on the phone about how to fix this, Odalys told the guest that she was making her job really hard. The guest reached out to district manager Thessaly Brookhart saying Odalys was very rude to her and Odalys told her she knows how to do her job she has worked here for two years. no payroll deduct.";

afterEach(() => vi.unstubAllEnvs());

describe("TITLE_OF_THE_EMPLOYEE_ENABLED: a title attached to another named person is theirs", () => {
  it("R2: \"District manager Thessaly Brookhart\" (twice) is not Odalys Prewett Vansickle's title", () => {
    expect(titleNamesAnotherPerson(R2, "District Manager", "Odalys Prewett Vansickle")).toBe(true);
  });

  it("the employee's own title stays theirs: beside their name, or beside no name", () => {
    expect(titleNamesAnotherPerson("Salon Director Odalys Prewett was late opening", "Salon Director", "Odalys Prewett")).toBe(false);
    expect(titleNamesAnotherPerson("she is an assistant salon director and was late", "Assistant Salon Director", "Odalys Prewett")).toBe(false);
  });

  it("once beside another person and once on its own: not settled, left as before", () => {
    expect(titleNamesAnotherPerson("Odalys is a district manager. She called District manager Thessaly Brookhart.", "District Manager", "Odalys Prewett")).toBe(false);
  });

  it("a title not written out, or no employee: left as before", () => {
    expect(titleNamesAnotherPerson(R2, "Salon Director", "Odalys Prewett Vansickle")).toBe(false);
    expect(titleNamesAnotherPerson(R2, "District Manager", null)).toBe(false);
  });
});

/*
 * QA's Sunny gate, 6 Nov 2026 (s16, priority replay): an exit form typed as lines,
 * "<name>\nTanning Consultant \nNE Kearney\n…". The capitalised words on the NEXT line
 * (the salon) were read as another person beside the title, so the employee's own
 * title was dropped. TITLE_ENDS_AT_LINE_ENABLED: a name beside a title is on the
 * title's own line. The name is invented.
 */
const S16 =
  "Marnie Kettering\nTanning Consultant \nNE Kearney\nGave notice - fulfilled notice\nGave notice 9/25/26 - date notice fulfilled 10/9/26\nResigning to pursue other career options\nStore items returned payroll deduction does not apply eligible for rehire";

describe("TITLE_ENDS_AT_LINE_ENABLED: a name beside a title is on the title's own line", () => {
  it("off: s16's salon on the next line is read as another person (the defect)", () => {
    vi.stubEnv("TITLE_ENDS_AT_LINE_ENABLED", "");
    expect(titleNamesAnotherPerson(S16, "Tanning Consultant", "Marnie Kettering")).toBe(true);
  });

  it("on: s16's title, alone on its line, is the employee's", () => {
    vi.stubEnv("TITLE_ENDS_AT_LINE_ENABLED", "true");
    expect(titleNamesAnotherPerson(S16, "Tanning Consultant", "Marnie Kettering")).toBe(false);
  });

  it("on: R2 still reads \"District manager Thessaly Brookhart\" as hers (same line); a typed list's name on the line before still owns the title below it", () => {
    vi.stubEnv("TITLE_ENDS_AT_LINE_ENABLED", "true");
    expect(titleNamesAnotherPerson(R2, "District Manager", "Odalys Prewett Vansickle")).toBe(true);
    expect(titleNamesAnotherPerson("Rowan Kestrel\nDistrict Manager\nNE Kearney", "District Manager", "Marnie Kettering")).toBe(true);
  });
});

/* QA's review of the title-line rule, 6 Nov 2026: a DM named on her own line is not a longer title. */
describe("TITLE_ENDS_AT_LINE_ENABLED: a title line ends where a person's name begins", () => {
  it("(a) \"District Manager Thessaly Brookhart\" on its own line is hers, not the employee's above", () => {
    vi.stubEnv("TITLE_ENDS_AT_LINE_ENABLED", "true");
    expect(titleNamesAnotherPerson("Marnie Kettering\nDistrict Manager Thessaly Brookhart\nNE Kearney\nGave notice", "District Manager", "Marnie Kettering")).toBe(true);
  });
  it("(b) a position name alone on its line (\"Tanning Consultant\") is still the employee's", () => {
    vi.stubEnv("TITLE_ENDS_AT_LINE_ENABLED", "true");
    expect(titleNamesAnotherPerson("Marnie Kettering\nTanning Consultant\nNE Kearney\nGave notice", "Tanning Consultant", "Marnie Kettering")).toBe(false);
  });
});
