import { afterEach, describe, expect, it } from "vitest";

import { withWiderDates } from "./wider-dates";

/** WIDER_DATE_READER_ENABLED (QA, 27 Oct 2026). Today is 27 Oct 2026. */
const FLAG = "WIDER_DATE_READER_ENABLED";
const TODAY = "2026-10-27";
const read = (text: string) => withWiderDates(text, TODAY, []).map((found) => found.iso);

afterEach(() => {
  delete process.env[FLAG];
});

describe(FLAG, () => {
  it("on: the wider shapes", () => {
    process.env[FLAG] = "true";
    expect(read("she was late on 2 october")).toEqual(["2026-10-02"]);
    expect(read("she was late on the 2nd of october")).toEqual(["2026-10-02"]);
    expect(read("she was late on 2nd of oct 2025")).toEqual(["2025-10-02"]);
    expect(read("she was late on 10.2")).toEqual(["2026-10-02"]);
    expect(read("she was late on the 2nd")).toEqual(["2026-10-02"]);
    // The 28th has not come this month: last month's.
    expect(read("she was late on the 28th")).toEqual(["2026-09-28"]);
  });

  it("on: not dates", () => {
    process.env[FLAG] = "true";
    expect(read("payroll deduct $10.25")).toEqual([]);
    expect(read("she worked 3.5 hours")).toEqual([]);
    expect(read("this is her 2nd offense")).toEqual([]);
    expect(read("on the 2nd shift she was late")).toEqual([]);
    expect(read("she was late on 31 february")).toEqual([]);
  });

  it("a date already found is not read twice", () => {
    process.env[FLAG] = "true";
    expect(withWiderDates("on 2 october", TODAY, [{ iso: "2026-10-02", index: 3, end: 12 }]).length).toBe(1);
  });

  it("off: as before", () => {
    expect(read("she was late on 2 october")).toEqual([]);
  });
});
