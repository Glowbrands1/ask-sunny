import { describe, expect, it } from "vitest";

import { fitToLimit } from "./tools";

/** QA's code audit on d7960a5f (item 26): a long field is cut, never a field dropped. */
describe("fitToLimit (read_form, item 26)", () => {
  it("keeps every text whole when they fit", () => {
    expect(fitToLimit(["written", "yes", "Late to open."], 6_000)).toEqual(["written", "yes", "Late to open."]);
  });

  it("a long Observation BEFORE the level and payroll is cut; the level and payroll stay whole", () => {
    const observation = "x".repeat(8_000);
    const [cut, level, payroll] = fitToLimit([observation, "written", "yes"], 6_000);
    expect(level).toBe("written");
    expect(payroll).toBe("yes");
    expect(cut!.length).toBeLessThan(observation.length);
    expect(cut).toMatch(/… \(\d+ more characters on the form\)$/);
  });

  it("two long fields share the room, and none drops below 200 characters", () => {
    const fitted = fitToLimit(["a".repeat(5_000), "b".repeat(5_000), "short"], 6_000);
    expect(fitted[2]).toBe("short");
    for (const text of fitted.slice(0, 2)) expect(text.length).toBeGreaterThan(200);
    expect(fitted.join("").length).toBeLessThan(6_200);
  });
});
