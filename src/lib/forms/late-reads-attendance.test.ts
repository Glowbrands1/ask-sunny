import { readFileSync } from "node:fs";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { readCaPolicy } from "./ca-policy";

/**
 * LATE_READS_ATTENDANCE_ENABLED. QA, the Sunny round-10 live test (9 Nov 2026), in QA's wording (the person invented):
 * the model's heading, written back onto the turn as the app's own line, made "she was late" Late Opening.
 */
const FLAG = "LATE_READS_ATTENDANCE_ENABLED";
const HEADING = (name: string) => `\nPolicy reference: ${name}, JBA Policy Manual p.15.`;
const LATE = "create a CA for Marnie Holloway, she was late on 11/6/26";
const OPENING = "create a CA for Marnie Holloway, late opening the salon on 11/6/26";

beforeEach(() => {
  const production = JSON.parse(readFileSync("src/config/production-flags.json", "utf8")) as { on: string[] };
  for (const name of production.on) vi.stubEnv(name, "true");
  vi.stubEnv(FLAG, "true");
});
afterEach(() => vi.unstubAllEnvs());

describe("an employee late is Attendance, whatever the model's heading", () => {
  it("off: the heading's Late Opening is the reading (the bug)", () => {
    vi.stubEnv(FLAG, "");
    expect(readCaPolicy(`${LATE}${HEADING("Late Opening")}`).readFromApp).toBe("late_opening");
  });

  it.each([LATE, "create a CA for Marnie Holloway, she was tardy on 11/6/26", "she came in 20 minutes late for her shift on 11/6"])(
    "on: %s with a Late Opening heading reads as Attendance",
    (said) => {
      const reading = readCaPolicy(`${said}${HEADING("Late Opening")}`);
      expect(reading.readFromApp ?? reading.stated).toBe("attendance");
    },
  );

  it("on: late opening the salon stays Late Opening", () => {
    expect(readCaPolicy(OPENING).stated).toBe("late_opening");
    expect(readCaPolicy(`${OPENING}${HEADING("Late Opening")}`).stated).toBe("late_opening");
    expect(readCaPolicy(`she was late to open the salon on 11/6${HEADING("Late Opening")}`).readFromApp).not.toBe("attendance");
  });
});
