import { describe, expect, it } from "vitest";

import {
  defaultFollowUpDate,
  followUpChangeAsked,
  followUpDateForNewForm,
  followUpLine,
  planPromisesFollowUp,
  statedFollowUpDate,
} from "./follow-up-default";

/** Pau (20 Nov 2026): "(a) set the follow-up date automatically, one week after the form date, so you can change it". */
const TODAY = "2026-11-20"; // a Friday

describe("the follow-up date a loop form gets", () => {
  it("is one week after the form date", () => {
    expect(defaultFollowUpDate("2026-11-20", TODAY)).toBe("2026-11-27");
    expect(defaultFollowUpDate("2026-12-28", "2026-12-28")).toBe("2027-01-04");
  });

  /* Pau (via QA, 20 Nov 2026), option b: form date + 7, unless that is already before today; then today + 7. */
  it("a form dated today: today + 7", () => {
    expect(followUpDateForNewForm({ formDate: TODAY, followUpDate: null, managerWords: "", today: TODAY })).toBe("2026-11-27");
  });

  it("a form dated 3 days ago: form date + 7", () => {
    expect(followUpDateForNewForm({ formDate: "2026-11-17", followUpDate: null, managerWords: "", today: TODAY })).toBe("2026-11-24");
  });

  it("a form dated 15 days ago: today + 7, never a follow-up already overdue", () => {
    expect(followUpDateForNewForm({ formDate: "2026-11-05", followUpDate: null, managerWords: "", today: TODAY })).toBe("2026-11-27");
  });

  it("a form dated exactly 7 days ago: form date + 7 is today, kept", () => {
    expect(defaultFollowUpDate("2026-11-13", TODAY)).toBe(TODAY);
  });

  it("a date the manager stated is kept as stated, on a backdated form too", () => {
    const managerWords = "write up Test Testy for being late to her shift on 11/5, follow up 12/1";
    expect(followUpDateForNewForm({ formDate: "2026-11-05", followUpDate: null, managerWords, today: TODAY })).toBe("2026-12-01");
  });

  it("is the date the manager stated, when they stated one", () => {
    const managerWords = "write up Test Testy for being late to her shift, $20 payroll deduct, follow up 12/1";
    expect(followUpDateForNewForm({ formDate: TODAY, followUpDate: null, managerWords, today: TODAY })).toBe("2026-12-01");
    expect(statedFollowUpDate("follow up next Friday", TODAY)).toBe("2026-11-27");
  });

  it("defaults when the manager stated none (the live test's wording)", () => {
    const managerWords = "write up Test Testy for being late to her shift, $20 payroll deduct";
    expect(followUpDateForNewForm({ formDate: TODAY, followUpDate: null, managerWords, today: TODAY })).toBe("2026-11-27");
  });

  it("never replaces a follow-up date the form already has", () => {
    expect(followUpDateForNewForm({ formDate: TODAY, followUpDate: "2026-12-10", managerWords: "", today: TODAY })).toBeNull();
  });

  it("reads a promised follow-up in the Action Plan (the AI's live wording)", () => {
    expect(planPromisesFollowUp("A follow-up meeting will be scheduled to review progress")).toBe(true);
    expect(planPromisesFollowUp("We will check in with her next week.")).toBe(true);
    expect(planPromisesFollowUp("Arrive on time for every scheduled shift.")).toBe(false);
    expect(planPromisesFollowUp(null)).toBe(false);
  });
});

describe("a chat change to the follow-up date", () => {
  it("reads the manager's date, ahead of today, never refused", () => {
    expect(followUpChangeAsked("change the follow up to 12/3", TODAY)).toBe("2026-12-03");
    expect(followUpChangeAsked("change the follow-up to Dec 3", TODAY)).toBe("2026-12-03");
    expect(followUpChangeAsked("move the follow up to next Friday", TODAY)).toBe("2026-11-27");
  });

  it("is not a message about something else", () => {
    expect(followUpChangeAsked("change the date to 11/19", TODAY)).toBeNull();
    expect(followUpChangeAsked("write up Test Testy for being late to her shift, $20 payroll deduct", TODAY)).toBeNull();
  });

  it("is said with the day", () => {
    expect(followUpLine("2026-11-27")).toBe("Follow-up: Fri, Nov 27 (change it anytime).");
  });
});
