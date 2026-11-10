import { afterEach, describe, expect, it, vi } from "vitest";

import { withFormDateOnce, withoutFormDate } from "./date-once";

// HR's report (21 Oct 2026), invented name: "create verbal ca for pat rivera, she was late to salon 15 minutes on 10-1-26. no payroll deduct".
const KEYS = new Set(["observation"]);

describe("DATE_ONCE_ENABLED", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("off: the account keeps the date", () => {
    const values = { observation: "Pat was late to salon 15 minutes on 10-1-26.", form_date: "2026-10-01" };
    expect(withFormDateOnce(values, "2026-10-01", KEYS)).toEqual(values);
  });

  it("on: the form's own date leaves the account; the rest stays", () => {
    vi.stubEnv("DATE_ONCE_ENABLED", "true");
    expect(withFormDateOnce({ observation: "Pat was late to salon 15 minutes on 10-1-26.", form_date: "2026-10-01" }, "2026-10-01", KEYS)).toEqual({
      observation: "Pat was late to salon 15 minutes.",
      form_date: "2026-10-01",
    });
  });

  it("the shapes of the same day go; another day stays", () => {
    expect(withoutFormDate("She was late on October 1st, 2026, by 15 minutes.", "2026-10-01")).toBe("She was late, by 15 minutes.");
    expect(withoutFormDate("She was late (10/1/26) by 15 minutes.", "2026-10-01")).toBe("She was late by 15 minutes.");
    expect(withoutFormDate("She was late on 10-1-26 and again on 10-8-26.", "2026-10-01")).toBe("She was late and again on 10-8-26.");
    expect(withoutFormDate("She was late on 10-1-25.", "2026-10-01")).toBe("She was late on 10-1-25.");
  });

  it("on: a field that would be left with almost nothing keeps its date", () => {
    vi.stubEnv("DATE_ONCE_ENABLED", "true");
    expect(withFormDateOnce({ observation: "Late on 10-1-26." }, "2026-10-01", KEYS)).toEqual({ observation: "Late on 10-1-26." });
  });
});
