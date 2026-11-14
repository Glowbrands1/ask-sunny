import { afterEach, describe, expect, it, vi } from "vitest";

import { checkReading, type CheckContext } from "./check";
import { parseFormReading } from "./schema";

/* REASON_PLACE_NEVER_SALON (ported from the sibling app's 17z live bug, QA 14 Nov 2026), the tester's wording; invented person. */
afterEach(() => vi.unstubAllEnvs());
const on = (value: boolean) => {
  vi.stubEnv("REASON_PLACE_NOT_SALON_ENABLED", "true");
  vi.stubEnv("REASON_PLACE_NEVER_SALON_ENABLED", value ? "true" : "");
};

const TURN = "write a CA for tavia quellan, she was late because she was at kearney";
const context = (turn: string): CheckContext => ({
  managerTurns: [turn],
  people: [],
  locations: [
    { id: "loc-0309", name: "NE Kearney" },
    { id: "loc-0410", name: "NE Omaha Pacific" },
  ],
  headings: [],
  today: "2026-11-14",
});
const readLocation = (turn: string) =>
  checkReading(parseFormReading({ location: { value: "kearney", evidence: turn } })!, context(turn)).location?.id ?? null;

describe("REASON_PLACE_NEVER_SALON", () => {
  it("off: the AI reader's reading of a reason's place is the salon (the defect)", () => {
    on(false);
    expect(readLocation(TURN)).toBe("loc-0309");
  });

  it("on: a reason's place is never the reader's salon", () => {
    on(true);
    expect(readLocation(TURN)).toBeNull();
  });

  it("on: a salon said as the salon is still read", () => {
    on(true);
    expect(readLocation("write a CA for tavia quellan, she was late at kearney")).toBe("loc-0309");
    expect(readLocation("write a CA for tavia quellan at kearney, she was late because she was at kearney")).toBe("loc-0309");
  });
});
