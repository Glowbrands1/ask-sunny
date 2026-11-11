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
  // Changed on purpose (11 Nov 2026): fixed in production by FORM_NAME_NOT_A_TITLE, QA round 28. Was OPEN.
  status: "fixed",
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

/**
 * QA's follow-up (11 Nov 2026, D5 off-roster): on main 7b1411ab with D5 live, "Create an SDIT EPP for <name> at IA
 * Altoona" for a person NOT on the roster, signed in as an all-salon admin, still showed "Job title: Salon Director in
 * Training". The second reader is the model's slot reading (`groundTitle` in `ai/intent-slots.ts`): the live model gives
 * "SDIT" as the title, and for an off-roster person a title the manager typed was kept. `t.slotsRead` stands in for that
 * reading. The person is invented and not on the replay roster.
 */
const OFF_ROSTER = "Wren Tallis";
const OFF_ROSTER_REPORT = "QA's follow-up (11 Nov 2026, D5 off-roster): the slot model's \"SDIT\" became an off-roster employee's job title";

function offRoster(t: ReplayContext, words: string) {
  vi.setSystemTime(new Date("2026-11-11T15:00:00Z"));
  t.directory(STAFF);
  t.as("admin", EVERY_SALON);
  t.slotsRead({ employee: OFF_ROSTER, title: "SDIT", formType: "SDIT EPP", formTurn: true, salon: "IA Altoona" });
  const thread = t.thread();
  return thread.say(words).then((reply) => ({ reply, proposal: thread.proposal }));
}

NOV11_FORM_NAME_NOT_A_TITLE_CASES.push(
  {
    id: "nov11-form-name-not-a-title-off-roster-slot-title",
    title: `"Create an SDIT EPP for ${OFF_ROSTER} at IA Altoona" (off the roster): the model's "SDIT" is not the card's position`,
    report: OFF_ROSTER_REPORT,
    // Failed on main 7b1411ab with production's flags (FORM_NAME_NOT_A_TITLE on): role "Salon Director in Training".
    status: "fixed",
    fixFlags: FIX,
    async run(t: ReplayContext) {
      const { reply, proposal } = await offRoster(t, `Create an SDIT EPP for ${OFF_ROSTER} at IA Altoona`);
      const role = proposal?.employeeRole ?? "";
      expect(role, `the form's name became the position:\n${reply.content}`).not.toMatch(/director in training|\bsdit\b/i);
      expect(reply.content).not.toMatch(/job title:\*{0,2}\s*salon director in training/i);
    },
  },
  {
    id: "nov11-form-name-not-a-title-off-roster-said-title-kept",
    title: `NEVER-BREAK: "… for ${OFF_ROSTER} at IA Altoona, she is an SDIT": the title she was given stays`,
    report: OFF_ROSTER_REPORT,
    status: "fixed",
    fixFlags: FIX,
    async run(t: ReplayContext) {
      const { reply, proposal } = await offRoster(t, `Create an SDIT EPP for ${OFF_ROSTER} at IA Altoona, she is an SDIT`);
      expect(proposal?.employeeRole ?? "", reply.content).toMatch(/director in training|\bsdit\b/i);
    },
  },
);
