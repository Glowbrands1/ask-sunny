import { expect, vi } from "vitest";

import { STAFF, type ReplayCase, type ReplayContext } from "./cases";

/** As `nov9-exit-form-date-termination-cases.ts` signs a district manager in. */
const EVERY_SALON = { level: "global", primaryAreaId: null, alsoCoversAreaIds: [] };

/**
 * ============================================================================
 * THE FORM'S NAME IS NOT THE EMPLOYEE'S TITLE (QA's prod-env reading, 10 Nov 2026, D5; FORM_NAME_NOT_A_TITLE_ENABLED)
 * ============================================================================
 *
 * "Create an SDIT EPP for <name> at <salon>" (`store-woven-form-flow.test.ts` in Ask Bubbles; here the same request in this
 * app's wording) put "Salon Director in Training" on the card as the employee's position, though the roster says
 * otherwise: `extractJobTitle` read the form's own name as a title. The person is the replay roster's.
 */
const FIX = ["FORM_NAME_NOT_A_TITLE_ENABLED"];
const REPORT = "QA's prod-env reading (10 Nov 2026, D5): the EPP's program name became the employee's job title";

function start(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-11-10T15:00:00Z"));
  t.directory(STAFF);
  t.as("district_manager", EVERY_SALON);
  return t.thread();
}

export const NOV11_FORM_NAME_NOT_A_TITLE_CASES: ReplayCase[] = (
  [
    ["sdit", "Create an SDIT EPP for {name} at Kearney", "sdit-epp"],
    ["tsd", "Create a TSD EPP for {name} at Kearney", "tsd-epp"],
  ] as const
).map(([key, words, templateKey]) => ({
  id: `nov11-form-name-not-a-title-${key}`,
  title: `"${words}": the card's position is not the form's name`,
  report: REPORT,
  status: { open: "the card's position is the form's program title, not the employee's" },
  fixFlags: FIX,
  async run(t: ReplayContext) {
    const thread = start(t);
    const person = STAFF[0]!;
    const reply = await thread.say(words.replace("{name}", `${person.firstName} ${person.lastName}`));
    expect(thread.proposal, `no card:\n${reply.content}`).toMatchObject({ templateKey });
    const role = thread.proposal?.employeeRole ?? "";
    expect(role, `the form's name became the position:\n${reply.content}`).not.toMatch(/director in training|training salon director|\bsdit\b|\btsd\b/i);
  },
}));
