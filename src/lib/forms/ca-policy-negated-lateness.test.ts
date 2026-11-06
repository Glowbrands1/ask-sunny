import { afterEach, describe, expect, it, vi } from "vitest";

import { readCaPolicy } from "./ca-policy";

/**
 * NEGATED_LATENESS_TOPIC_ENABLED, the Corrective Action side (audit of #234, 6 Nov 2026). The policy reader's
 * attendance pattern matched "was … late" with up to two words between, so "she was not late" read as an
 * attendance account and made a conduct incident a question ("Standards of Conduct or Attendance?"). With the
 * flag on, a lateness the manager denies is not attendance; a real one still is. Off, as before.
 */
const DENIED = "She was not late, but she didn't finish her opening tasks.";

afterEach(() => vi.unstubAllEnvs());

describe("a denied lateness is no attendance reading of a Corrective Action", () => {
  it("flag off: read as attendance too (the defect, pinned)", () => {
    vi.stubEnv("NEGATED_LATENESS_TOPIC_ENABLED", "");
    expect(readCaPolicy(DENIED).ambiguous).toEqual(["standards_of_conduct", "attendance"]);
  });

  it("flag on: the Standards of Conduct, no attendance question", () => {
    vi.stubEnv("NEGATED_LATENESS_TOPIC_ENABLED", "true");
    for (const text of [DENIED, "She wasn't late but she didn't finish her opening tasks.", "She is never late. She didn't finish her opening tasks."]) {
      const reading = readCaPolicy(text);
      expect(reading.alternatives, text).not.toContain("attendance");
      expect(reading.ambiguous, text).toBeNull();
      expect(reading.suggestion, text).toBe("standards_of_conduct");
    }
  });

  it("flag on, NEVER-BREAK: a real lateness, or another attendance problem, is still read as attendance", () => {
    vi.stubEnv("NEGATED_LATENESS_TOPIC_ENABLED", "true");
    for (const text of [
      "She came in late and didn't finish her opening tasks.",
      "She was not late today but was late yesterday and didn't finish her opening tasks.",
      "She was not late but left early and didn't finish her opening tasks.",
    ]) {
      expect(readCaPolicy(text).ambiguous, text).toEqual(["standards_of_conduct", "attendance"]);
    }
  });
});
