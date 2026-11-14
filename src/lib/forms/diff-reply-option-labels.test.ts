import { afterEach, describe, expect, it, vi } from "vitest";

import { replyFromDiff } from "./form-diff-reply";

/* DIFF_REPLY_OPTION_LABELS (v2-Gate-Sunny-2 / QA, 14 Nov 2026). */
describe("replyFromDiff names a ticked option by its label", () => {
  afterEach(() => vi.unstubAllEnvs());
  const changed = [{ key: "offense_type", before: ["attendance_policy"], after: ["standards_of_conduct"] }] as never;
  const labels = { offense_type: "Type of Offense" };
  const options = { offense_type: { attendance_policy: "Attendance Policy", standards_of_conduct: "Standards of Conduct" } };

  it("off: the key, as before", () => {
    vi.stubEnv("DIFF_REPLY_OPTION_LABELS_ENABLED", "");
    expect(replyFromDiff({ changed }, labels, options)).toBe('Changed Type of Offense to "standards_of_conduct".');
  });

  it("on: the label", () => {
    vi.stubEnv("DIFF_REPLY_OPTION_LABELS_ENABLED", "true");
    expect(replyFromDiff({ changed }, labels, options)).toBe('Changed Type of Offense to "Standards of Conduct".');
  });

  it("on: a text field and an unknown option are as before", () => {
    vi.stubEnv("DIFF_REPLY_OPTION_LABELS_ENABLED", "true");
    const text = [{ key: "observation", before: "", after: "She was on her phone." }] as never;
    expect(replyFromDiff({ changed: text }, { observation: "Observation of Offense" }, options)).toBe('Changed Observation of Offense to "She was on her phone.".');
    const unknown = [{ key: "offense_type", before: [], after: ["other_box"] }] as never;
    expect(replyFromDiff({ changed: unknown }, labels, options)).toBe('Changed Type of Offense to "other_box".');
  });
});
