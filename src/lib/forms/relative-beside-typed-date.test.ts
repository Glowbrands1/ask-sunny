import { afterEach, describe, expect, it, vi } from "vitest";

import { datesInText } from "./form-date-answer";
import { withWiderDates } from "./wider-dates";

// Coding 4's production-flag reading (via QA, 10 Nov 2026), the manager's words; the person invented.
const SAID = "Tess Varga missed our team meeting yesterday 10/21/26 without telling anyone.";
const TODAY = "2026-10-23";
const isos = (text: string) => withWiderDates(text, TODAY, datesInText(text, TODAY)).map((found) => found.iso);

describe("RELATIVE_BESIDE_TYPED_DATE_ENABLED", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("with the relative-date reader on, \"yesterday 10/21/26\" reads two dates (the bug)", () => {
    vi.stubEnv("RELATIVE_DATE_READER_ENABLED", "true");
    expect(isos(SAID).sort()).toEqual(["2026-10-21", "2026-10-22"]);
  });

  it("on: a relative word right beside a typed date names that date", () => {
    vi.stubEnv("RELATIVE_DATE_READER_ENABLED", "true");
    vi.stubEnv("RELATIVE_BESIDE_TYPED_DATE_ENABLED", "true");
    expect(isos(SAID)).toEqual(["2026-10-21"]);
    expect(isos("she was late 10/21/26 (yesterday) again")).toEqual(["2026-10-21"]);
  });

  it("on: a relative word apart from the typed date is still its own date", () => {
    vi.stubEnv("RELATIVE_DATE_READER_ENABLED", "true");
    vi.stubEnv("RELATIVE_BESIDE_TYPED_DATE_ENABLED", "true");
    expect(isos("she was late yesterday, and she also missed the meeting on 10/21/26").sort()).toEqual(["2026-10-21", "2026-10-22"]);
  });
});
