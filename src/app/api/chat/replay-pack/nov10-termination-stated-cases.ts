import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayCase } from "./cases";

/**
 * ============================================================================
 * "I NEED A TERM CA FOR <NAME>" TICKS TERMINATION, WITH THE APPROVAL LINE (Pau's P15 ruling "A", 10 Nov 2026)
 * ============================================================================
 *
 * P15's words (Sunny production, 9 Nov 2026), verbatim except the person (invented: Briony Halvorsen). The card said
 * "You'll set the verbal/written warning level …", asked the payroll question the manager had answered, planned on
 * "Future policy violations …", and the form's Type of Warning came back blank. Pau's ruling: tick the stated
 * termination as the manager's statement, add "Termination needs your DM/HR approval before you finalize.", and end
 * the plan with "Effective immediately, employment is terminated following the progressive corrective action plan."
 * TERMINATION_STATED_TICKS_ENABLED; the payroll half is PAYROLL_BARE_SENTENCE_ENABLED (#787, which this stacks on).
 * The saved plan's closing is written by protected files (`required-closing.ts`, `ca-action-plan.ts`), edited with Pau's
 * written approval, 10 Nov 2026: "ok termination closing".
 */

const BRIONY: DirectoryRow = {
  id: "e-tt-briony-halvorsen",
  firstName: "Briony",
  lastName: "Halvorsen",
  preferredFirstName: null,
  employmentStatus: "active",
  salonIds: ["loc-0309"],
  positionName: "Tanning Consultant",
};

/** The invented person of this file (a function: the registry reads exported arrays as cases). */
export function terminationStatedPeople(): readonly DirectoryRow[] {
  return [BRIONY];
}

const P15 = "I need a term CA for Briony Halvorsen. Didn't show up for her opening shift. Payroll deduction.";
const APPROVAL = "Termination needs your DM/HR approval before you finalize.";
const PLAN = "Effective immediately, employment is terminated following the progressive corrective action plan.";

export const NOV10_TERMINATION_STATED_CASES: ReplayCase[] = [
  {
    id: "nov10-p15-term-ca-ticks-termination",
    title: "P15: \"I need a term CA for <name>. … Payroll deduction.\": Termination as said, the approval line once, the termination plan, payroll Yes with no question; Create ticks Termination",
    report: 'Pau via QA, 10 Nov 2026 (P15, conv 9 Nov ~16:35Z; ruling "A"): "I need a term CA for <name>. Didn\'t show up for her opening shift. Payroll deduction."',
    // Changed on purpose (12 Nov 2026): fixed in production by TERMINATION_STATED_TICKS_ENABLED, QA round 37. Was OPEN.
    status: "fixed",
    fixFlags: ["TERMINATION_STATED_TICKS_ENABLED", "PAYROLL_BARE_SENTENCE_ENABLED"],
    async run(t) {
      vi.setSystemTime(new Date("2026-11-09T16:35:00Z"));
      t.directory([...STAFF, BRIONY]);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      const card = await thread.say(P15);
      expect(thread.proposal, `no CA card for Briony Halvorsen:\n${card.content}`).toMatchObject({ templateKey: "dpoa", employeeName: "Briony Halvorsen" });
      expect(card.content, "the card does not say Termination").toMatch(/\*\*Type of Warning:\*\* Termination, as you said/);
      expect(card.content.split(APPROVAL).length - 1, "the approval line, exactly once").toBe(1);
      expect(card.content, "the card still leaves the level to the manager").not.toMatch(/verbal\/written warning level/);
      const plan = card.content.split("\n").find((line) => /^\*\*Action Plan:\*\*/.test(line)) ?? "";
      expect(plan, "the card's plan is not the termination plan").toContain(PLAN);
      expect(plan, "the card's plan still warns of future violations").not.toMatch(/Future policy violations/);
      expect(card.content, "the card asks the payroll question the manager answered").not.toMatch(/Is payroll deduct applicable\?\*\* Yes or No\?/);
      const id = await thread.create();
      expect(t.checked(id).warning_type ?? [], "Create did not tick Termination").toEqual(["termination"]);
      expect(t.checked(id).payroll_deduct ?? [], "Payroll Deduct is not Yes").toEqual(["yes"]);
      const saved = t.values(id).action_plan ?? "";
      expect(saved.trim(), `the saved plan does not end with the termination sentence:\n${saved}`).toMatch(/Effective immediately, employment is terminated following the progressive corrective action plan\.$/);
      expect(saved, "the saved plan still warns of future violations").not.toMatch(/Future policy violations/);
    },
  },
  {
    id: "nov10-termination-hedge-never-ticks",
    title: "negative: \"… she might be terminated if this continues\" states no termination: no Termination line, nothing ticked",
    report: "QA, 10 Nov 2026 (P15 ruling): the negative case",
    status: "fixed",
    fixFlags: ["TERMINATION_STATED_TICKS_ENABLED"],
    async run(t) {
      vi.setSystemTime(new Date("2026-11-09T16:35:00Z"));
      t.directory([...STAFF, BRIONY]);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      const card = await thread.say("I need a CA for Briony Halvorsen. Didn't show up for her opening shift, she might be terminated if this continues.");
      expect(card.content).not.toMatch(/Termination, as you said/);
      expect(card.content).not.toContain(APPROVAL);
      const id = await thread.create();
      expect(t.checked(id).warning_type ?? []).not.toContain("termination");
    },
  },
];

/* Gate-Bubbles' NO-GO (R798, 12 Nov 2026): negated, about a later form, or "long term" — the card never says Termination. */
const NEVER_STATED = [
  ["do-not-terminate", "I need a CA for Briony Halvorsen, do not terminate her. Didn't show up for her opening shift."],
  ["not-a-term-ca", "I need a CA for Briony Halvorsen. This is not a term CA. Didn't show up for her opening shift."],
  ["not-terminating", "I need a CA for Briony Halvorsen, we are not terminating her. Didn't show up for her opening shift."],
  ["next-one", "I need a written CA for Briony Halvorsen. Didn't show up for her opening shift. Next one is a term CA."],
  ["long-term", "I need a CA for Briony Halvorsen with a long term CA plan. Didn't show up for her opening shift."],
  // Gate-Sunny's probe of c10df533 (12 Nov 2026), answered by the safe-by-design rule (QA): no negation or hedge.
  ["shouldnt-terminate", "I need a CA for Briony Halvorsen. Didn't show up for her opening shift. We shouldn't terminate her."],
  ["wouldnt-terminate", "I need a CA for Briony Halvorsen. Didn't show up for her opening shift. I wouldn't terminate him."],
  ["couldnt-terminate", "I need a CA for Briony Halvorsen. Didn't show up for her opening shift. We couldn't terminate her yet."],
  ["dont-want-term-ca", "I need a CA for Briony Halvorsen. Didn't show up for her opening shift. I don't want to make this a term CA."],
  ["rather-than-term-ca", "I need a CA for Briony Halvorsen. Didn't show up for her opening shift. Write her up rather than a term CA."],
  ["hold-off", "I need a CA for Briony Halvorsen. Didn't show up for her opening shift. Hold off on terminating her."],
  ["decided-against", "I need a CA for Briony Halvorsen. Didn't show up for her opening shift. We decided against terminating her."],
  // Gate-Bubbles' probe of 869135a8 and Gate-Sunny's hedge probe of af924094 (12 Nov 2026).
  ["gb-shouldnt", "I need a CA for Briony Halvorsen. Didn't show up for her opening shift. We shouldn't terminate him"],
  ["gb-wouldnt-yet", "I need a CA for Briony Halvorsen. Didn't show up for her opening shift. I wouldn't terminate her yet"],
  ["gb-couldnt-over-this", "I need a CA for Briony Halvorsen. Didn't show up for her opening shift. We couldn't terminate him over this"],
  ["gb-rather-than", "I need a CA for Briony Halvorsen. Didn't show up for her opening shift. Make it a written rather than a term CA"],
  ["gb-hold-off-on", "I need a CA for Briony Halvorsen. Didn't show up for her opening shift. We'll hold off on terminating her"],
  ["gb-decided-against", "I need a CA for Briony Halvorsen. Didn't show up for her opening shift. We decided against terminating him"],
  ["probably", "I need a CA for Briony Halvorsen. Didn't show up for her opening shift. Probably a term CA."],
  ["i-think", "I need a CA for Briony Halvorsen. Didn't show up for her opening shift. I think we need a term CA for her."],
  ["pending-hr", "I need a CA for Briony Halvorsen. Didn't show up for her opening shift. Term CA for her, pending HR."],
  ["ask-hr-whether", "I need a CA for Briony Halvorsen. Didn't show up for her opening shift. Ask HR whether to terminate her."],
  ["check-with-dm", "I need a CA for Briony Halvorsen. Didn't show up for her opening shift. Check with my DM about a term CA."],
  ["once-dm-approves", "I need a CA for Briony Halvorsen. Didn't show up for her opening shift. Term CA for Briony Halvorsen once the DM approves"],
  ["waiting-on-hr", "I need a CA for Briony Halvorsen. Didn't show up for her opening shift. Waiting on HR before we terminate her"],
] as const;

export const NOV12_TERMINATION_NEVER_STATED_CASES: ReplayCase[] = NEVER_STATED.map(([key, said]) => ({
  id: `nov12-termination-never-ticks-${key}`,
  title: `negative: "${said}" states no termination: no Termination line, nothing ticked`,
  report: "Gate-Bubbles' NO-GO on TERMINATION_STATED_TICKS (R798, 12 Nov 2026)",
  status: "fixed",
  fixFlags: ["TERMINATION_STATED_TICKS_ENABLED"],
    async run(t) {
      vi.setSystemTime(new Date("2026-11-09T16:35:00Z"));
      t.directory([...STAFF, BRIONY]);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      const card = await thread.say(said);
      expect(card.content, `a Termination line:\n${card.content}`).not.toMatch(/Termination, as you said/);
      expect(card.content).not.toContain(APPROVAL);
      const id = await thread.create();
      expect(t.checked(id).warning_type ?? [], "Termination was ticked").not.toContain("termination");
    },
}));

/* Gate-Sunny's correctly ticking cases (12 Nov 2026): an incident clause after the statement does not block it. */
// "I need a termination form …" opens the Resignation/Exit Form, not a CA card: its wording is a unit case only.
const STATED_WITH_INCIDENT = [
  ["terminating-never-showed", "CA for Briony Halvorsen. We are terminating her, she never showed."],
  ["term-ca-did-not-show", "I need a term CA for Briony Halvorsen, she did not show up."],
  // Gate-Sunny wrote "Termination CA for <name>, no call no show." (a unit case): the "I need" opens the card in both apps.
  ["termination-ca-no-call-no-show", "I need a termination CA for Briony Halvorsen, no call no show."],
  // QA's P15 phrasings (12 Nov 2026).
  ["because-didnt-call-in", "I need a term CA for Briony Halvorsen because she didn't call in."],
  ["didnt-show-for-shift", "I need a term CA for Briony Halvorsen, didn't show for her shift."],
  ["so-i-need", "CA for Briony Halvorsen. She didn't show up, so I need a term CA."],
] as const;

export const NOV12_TERMINATION_STATED_INCIDENT_CASES: ReplayCase[] = STATED_WITH_INCIDENT.map(([key, said]) => ({
  id: `nov12-termination-ticks-${key}`,
  title: `"${said}": Termination as said, the approval line; Create ticks Termination`,
  report: "Gate-Sunny's probe of TERMINATION_STATED_TICKS (12 Nov 2026): cases that must keep ticking",
  // Changed on purpose (12 Nov 2026): fixed in production by TERMINATION_STATED_TICKS_ENABLED, QA round 37. Was OPEN.
  status: "fixed",
  fixFlags: ["TERMINATION_STATED_TICKS_ENABLED"],
  async run(t) {
    vi.setSystemTime(new Date("2026-11-09T16:35:00Z"));
    t.directory([...STAFF, BRIONY]);
    t.as("salon_director", KEARNEY);
    const thread = t.thread();
    const card = await thread.say(said);
    expect(thread.proposal, `no CA card for Briony Halvorsen:\n${card.content}`).toMatchObject({ employeeName: "Briony Halvorsen" });
    expect(card.content, "the card does not say Termination").toMatch(/\*\*Type of Warning:\*\* Termination, as you said/);
    expect(card.content.split(APPROVAL).length - 1, "the approval line, exactly once").toBe(1);
    const id = await thread.create();
    expect(t.checked(id).warning_type ?? [], "Create did not tick Termination").toEqual(["termination"]);
  },
}));
