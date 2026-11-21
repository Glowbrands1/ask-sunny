import { describe, expect, it } from "vitest";

import { exitReasonOnly } from "./exit-reason-only";

/*
 * QA2's live R3 (21 Nov 2026, #1174's case): a loop exit card for a termination (job abandonment) saved the reason line
 * "terminated for job abandonment; not eligible for rehire." The rehire answer has its own question on the form
 * ("Is this employee eligible for rehire?"), so it leaves the reason and is that answer.
 */
describe("exitReasonOnly", () => {
  it("QA2's R3: the rehire answer leaves the reason and is its own answer", () => {
    expect(exitReasonOnly("terminated for job abandonment; not eligible for rehire.", "2026-11-21")).toEqual({ reason: "terminated for job abandonment.", rehire: "no" });
  });

  it("an eligible answer the same way", () => {
    expect(exitReasonOnly("Let go for attendance, eligible for rehire.", "2026-11-21")).toEqual({ reason: "Let go for attendance.", rehire: "yes" });
  });

  it("f077 still holds: a part that only names a date leaves the reason", () => {
    expect(exitReasonOnly("job abandonment; last day 11/18, notice given 11/17", "2026-11-21")).toEqual({ reason: "job abandonment.", rehire: null });
  });

  it("a reason with nothing else is unchanged", () => {
    expect(exitReasonOnly("No call no show for three shifts.", "2026-11-21")).toEqual({ reason: "No call no show for three shifts.", rehire: null });
  });
});
