import { afterEach, describe, expect, it, vi } from "vitest";

import { replyFromDiff } from "./form-diff-reply";

/** STEP_B_REPLY_KEEPS_LINES_ENABLED (QA's live draft test, 8 Nov 2026): a multi-line field is quoted line by line. */

const LABELS = { coaching_details: "Details of Coaching", other_topic: "Other" };
const DETAILS = "Observed:\nOttoline missed the monthly meeting on 10/10/26.\nShe was reminded about the meeting twice.\n\nExpectation:\nOttoline attends every meeting.";

afterEach(() => vi.unstubAllEnvs());

describe("replyFromDiff, a multi-line field", () => {
  it("is joined with \"; \" with the flag off (as before)", () => {
    vi.stubEnv("STEP_B_REPLY_KEEPS_LINES_ENABLED", "");
    expect(replyFromDiff({ changed: [{ key: "coaching_details", before: "", after: DETAILS }] } as never, LABELS)).toContain("Observed:; Ottoline missed");
  });

  it("is quoted line by line with the flag on; a one-line field is as before", () => {
    vi.stubEnv("STEP_B_REPLY_KEEPS_LINES_ENABLED", "1");
    expect(replyFromDiff({ changed: [{ key: "coaching_details", before: "", after: DETAILS }] } as never, LABELS)).toBe(
      "Changed Details of Coaching to:\n> Observed:\n> Ottoline missed the monthly meeting on 10/10/26.\n> She was reminded about the meeting twice.\n> Expectation:\n> Ottoline attends every meeting.",
    );
    expect(replyFromDiff({ changed: [{ key: "other_topic", before: "", after: "Showing up late" }] } as never, LABELS)).toBe('Changed Other to "Showing up late".');
  });
});
