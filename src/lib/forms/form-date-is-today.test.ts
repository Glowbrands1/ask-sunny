import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { decideFormDate } from "./incident-dates";

/**
 * FORM_DATE_IS_TODAY (port from Ask Bubbles; Pau, 24 Nov 2026). Pau's words, with the employee's name swapped for an invented one: "the form
 * date is wrong i told it Odessa was late to work on September 11, 2026. but it put the date …, should be today
 * right". The Corrective Action was dated 09/11/2026, so the one finalized on 09/12/2026 counted as "after" it and was
 * left off "List previously received coaching and/or corrective action with date signed". With the flag on the form
 * is dated the day it is written (`formDate: null` is "the day it is created"); the incident's date stays in the
 * account. The replay pack covers the agent loop (`nov24-form-date-is-today-cases.ts`).
 */
const TODAY = "2026-11-24";
const SAID = "create a corrective action for Odessa Pellham, she was late to work on September 11, 2026";

function decide(text: string, templateKey = "dpoa", history: { role: "user" | "assistant"; content: string }[] = []) {
  return decideFormDate({ text, templateKey, history, conversation: [...history, { role: "user", content: text }], today: TODAY });
}

describe("FORM_DATE_IS_TODAY_ENABLED", () => {
  beforeEach(() => {
    // Production's date flags (src/config/production-flags.json).
    vi.stubEnv("FORM_DATE_SAID_SETTLES_ENABLED", "true");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("off: nothing is decided, so the card keeps the incident's date (the reported 09/11/2026)", () => {
    expect(decide(SAID).formDate).toBeUndefined();
  });

  it("on: the Corrective Action is dated the day it is written, not the day she was late", () => {
    vi.stubEnv("FORM_DATE_IS_TODAY_ENABLED", "true");
    expect(decide(SAID)).toEqual({ formDate: null });
  });

  it("on: several incident dates do not ask \"which date?\"", () => {
    vi.stubEnv("FORM_DATE_IS_TODAY_ENABLED", "true");
    expect(decide("corrective action for Odessa Pellham, she was late on 9/11/2026 and again on 9/18/2026")).toEqual({ formDate: null });
  });

  it("on: a date the manager gives the form still dates it", () => {
    vi.stubEnv("FORM_DATE_IS_TODAY_ENABLED", "true");
    expect(decide(`${SAID}. make the date 11/20/2026`)).toEqual({ formDate: "2026-11-20" });
  });

  it("on: a Coaching Form is still dated by the coaching it documents", () => {
    vi.stubEnv("FORM_DATE_IS_TODAY_ENABLED", "true");
    expect(decide("coaching form for Odessa Pellham, she was late on 11/10/2026 and I coached her on 11/12/2026", "coaching")).toEqual({
      formDate: "2026-11-12",
    });
  });
});
