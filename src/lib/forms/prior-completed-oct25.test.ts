import { afterEach, describe, expect, it, vi } from "vitest";

import { listIncidentDates } from "./form-date-answer";
import { statedPriorActions } from "./prior-actions";

/**
 * QA, Ask Sunny full chat history (25 Oct 2026), conv_muxahcdkiiur2tu: the
 * manager listed the coachings already done — "she completed September Promo
 * coaching 9/29/26, Hemp nation product coaching form 9/30/26, …" — and the
 * card said "You'll set any prior coaching or corrective action on the form —
 * I won't guess at it", then asked which of 9/29 and 9/30 dates the form.
 * The manager's turn, word for word, with the employee's name invented.
 *
 * PRIOR_ACTIONS_PARSE_ENABLED: "completed" says the step was taken. Off, the
 * reading is unchanged.
 */
const TURN =
  "Avery Lund, she is a TC at  Mo Kansas City Wornall, created today but for the month of September, Avery was below company average in all categories for September, this will be a written warning, she completed September Promo coaching 9/29/26, Hemp nation product coaching form 9/30/26, Shrink coaching 9/31/26, and what would you recommend coaching 9/30/26, there is no payroll deduction applicable";
const TODAY = "2026-10-06";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('conv_muxahcdkiiur2tu: "she completed … coaching 9/29/26" is a prior step', () => {
  it("PRIOR_ACTIONS_PARSE_ENABLED on: listed as a prior, and its date does not date the form", () => {
    vi.stubEnv("PRIOR_ACTIONS_PARSE_ENABLED", "true");
    expect(statedPriorActions(TURN, TODAY)).toEqual(["Coaching — 09/29/2026", "Coaching — 09/30/2026"]);
    expect(listIncidentDates(TURN, TODAY).map((date) => date.iso)).not.toContain("2026-09-29");
  });

  it("off: unchanged — no prior is read, and 9/29 is still a candidate date", () => {
    vi.stubEnv("PRIOR_ACTIONS_PARSE_ENABLED", "");
    expect(statedPriorActions(TURN, TODAY)).toEqual([]);
    expect(listIncidentDates(TURN, TODAY).map((date) => date.iso)).toContain("2026-09-29");
  });
});
