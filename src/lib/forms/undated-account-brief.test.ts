import { readFileSync } from "node:fs";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { draftBriefDates, formDateBrief, resolveFormDate } from "./form-date-grounding";

/**
 * UNDATED_ACCOUNT_BRIEF_ENABLED. QA's live Create test sf-s38 (8 Nov 2026): the manager wrote
 *   "make me an CA for Rhea Calloway missing her saturday and sunday shifts due to wanting to go home for the
 *    weekend but failed to communicate proporley"
 * (the person invented) and gave no date. The saved Observation said she "missed both the Saturday and Sunday
 * scheduled shifts on November 8, 2026": the form's own date, because the draft brief told the model "This is the
 * date of the incident and of this form". With the flag, a brief with no date the manager gave says the form's date
 * is not the incident's and that no date goes in the account. A stated "today" is a date: that brief is unchanged.
 */
const REPORTED =
  "make me an CA for Rhea Calloway missing her saturday and sunday shifts due to wanting to go home for the weekend but failed to communicate proporley";
const TODAY = "2026-11-08";
const FORM = resolveFormDate(TODAY)!;
const OLD_LINE = /This is the date of the incident and of this form/;
const NEW_LINE = /the manager gave no date for what happened\. Write no date in the account, and never "November 8, 2026"/;

function productionFlags(): void {
  const production = JSON.parse(readFileSync("src/config/production-flags.json", "utf8")) as { on?: string[]; assumedOn?: string[] };
  for (const name of [...(production.on ?? []), ...(production.assumedOn ?? [])]) vi.stubEnv(name, "true");
}

function brief(notes: string): string {
  return formDateBrief(FORM, draftBriefDates(notes, TODAY), notes);
}

describe("UNDATED_ACCOUNT_BRIEF_ENABLED: the form's date is not the incident's when the manager gave none", () => {
  beforeEach(() => productionFlags());
  afterEach(() => vi.unstubAllEnvs());

  it("off (production today): QA's wording gets the brief that names the form's date as the incident's", () => {
    vi.stubEnv("UNDATED_ACCOUNT_BRIEF_ENABLED", "");
    expect(brief(REPORTED)).toMatch(OLD_LINE);
  });

  it("on: QA's wording (weekdays, no date) gets the no-date brief", () => {
    vi.stubEnv("UNDATED_ACCOUNT_BRIEF_ENABLED", "true");
    const line = brief(REPORTED);
    expect(line).toMatch(NEW_LINE);
    expect(line).not.toMatch(OLD_LINE);
  });

  it("on: a stated \"today\" is a date, the brief is unchanged", () => {
    vi.stubEnv("UNDATED_ACCOUNT_BRIEF_ENABLED", "true");
    expect(brief("Rhea Calloway was rude to a client at the front desk today")).toMatch(OLD_LINE);
  });

  it("on: a date the manager gave keeps the dated brief", () => {
    vi.stubEnv("UNDATED_ACCOUNT_BRIEF_ENABLED", "true");
    const line = brief("Rhea Calloway was a no call no show on 11/2");
    expect(line).toMatch(/The dates the manager gave are "November 2, 2026"/);
    expect(line).not.toMatch(NEW_LINE);
  });

  it("on: a caller with no notes (the old signature) keeps the old brief", () => {
    vi.stubEnv("UNDATED_ACCOUNT_BRIEF_ENABLED", "true");
    expect(formDateBrief(FORM, [])).toMatch(OLD_LINE);
  });
});
