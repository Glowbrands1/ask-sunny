import { expect, vi } from "vitest";

import { cardPlanMatchesCreateEnabled } from "@/lib/config/chat-quality-flags";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayCase, type ReplayContext } from "./cases";
import { lastResult, loopStandIn } from "./loop-stand-in";

/**
 * ============================================================================
 * THE CARD SHOWS THE ACTION PLAN CREATE WILL SAVE (ported from the sibling app: QA's Bubbles 17l, 12 Nov 2026; CARD_PLAN_MATCHES_CREATE_ENABLED)
 * ============================================================================
 *
 * "create a written CA for <B>, she was 20 minutes late on 11/9/26, no action plan", then Create. The card's plan:
 * "Management will review the Attendance policy with <B first>. Future policy violations may result…". Saved: "<B> is
 * expected to arrive on time for all scheduled shifts moving forward. Leadership will monitor <B>'s attendance closely
 * and provide coaching as needed. A follow-up meeting will be scheduled to review progress. Continued lateness will result
 * in further disciplinary review per company policy. Future policy violations may result in additional corrective action
 * up to and including termination of employment." — Pau's attendance plan (ATTENDANCE_ACTION_PLAN, his approved
 * wording). QA's ruling (B): it stays, and the card shows it. The tester's words; the person is STAFF's invented Remy Calder.
 */
const SAID = "create a written CA for Remy Calder, she was 20 minutes late on 11/9/26, no action plan";
const PAU_PLAN =
  "Remy is expected to arrive on time for all scheduled shifts moving forward. Leadership will monitor Remy's attendance closely and provide coaching as needed. A follow-up meeting will be scheduled to review progress. Continued lateness will result in further disciplinary review per company policy. Future policy violations may result in additional corrective action up to and including termination of employment.";
const FIX = ["CARD_PLAN_MATCHES_CREATE_ENABLED"];
const REPORT = "QA's Bubbles 17l live test via the sibling app, 12 Nov 2026 (reproduced here): the card's plan was the general one; Create saved Pau's attendance plan";

/** The card's Action Plan line, as the reply shows it. */
const cardPlan = (content: string) => (/\*\*Action Plan:\*\*\s*([^\n]+)/i.exec(content)?.[1] ?? "").replace(/\s+/g, " ").trim();

function start(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-11-11T16:00:00Z"));
  t.directory(STAFF);
  t.as("salon_director", KEARNEY);
  return t.thread();
}

export const NOV12_17L_CARD_PLAN_MATCHES_CREATE_CASES: ReplayCase[] = [
  {
    id: "nov12-17l-card-shows-pau-attendance-plan",
    title: "17l: \"create a written CA for <B>, she was 20 minutes late on 11/9/26, no action plan\": the card's Action Plan is Pau's attendance plan, the one Create saves",
    report: REPORT,
    // Changed on purpose (15 Nov 2026): fixed in production by CARD_PLAN_MATCHES_CREATE, Sunny 38o. Was OPEN.
    status: "fixed",
    fixFlags: FIX,
    async run(t) {
      const thread = start(t);
      const card = await thread.say(SAID);
      expect(card.content, `the card does not cite Attendance:\n${card.content}`).toMatch(/\*\*Policy:\*\* Attendance/);
      expect(cardPlan(card.content), `the card's plan is not the one Create saves:\n${card.content}`).toBe(PAU_PLAN);
      t.draftWrites({ observation: "Observed:\nOn November 9, 2026, Remy Calder arrived 20 minutes late." });
      const id = await thread.create();
      expect((t.values(id).action_plan ?? "").replace(/\s+/g, " ").trim(), "the saved plan is not the card's").toBe(cardPlan(card.content));
    },
  },
  {
    id: "nov12-17l-card-plan-equals-saved-plan",
    title: "17l, the Attendance policy named: the card's Action Plan and the saved Action Plan are the same text",
    report: `${REPORT} (QA: assert card plan == saved plan for an Attendance CA)`,
    // Changed on purpose (15 Nov 2026): fixed in production by CARD_PLAN_MATCHES_CREATE, Sunny 38o. Was OPEN.
    status: "fixed",
    fixFlags: FIX,
    async run(t) {
      const thread = start(t);
      const card = await thread.say("create a written CA for Remy Calder for violating the attendance policy, she was 20 minutes late on 11/9/26, no action plan");
      const shown = cardPlan(card.content);
      t.draftWrites({ observation: "Observed:\nOn November 9, 2026, Remy Calder arrived 20 minutes late." });
      const id = await thread.create();
      expect(t.values(id).policy_violated ?? "", "the saved form does not cite Attendance").toMatch(/Attendance/);
      const saved = (t.values(id).action_plan ?? "").replace(/\s+/g, " ").trim();
      expect(saved, "the saved plan is not Pau's attendance plan").toBe(PAU_PLAN);
      expect(shown, `the card's plan is not the saved plan:\ncard: ${shown}\nsaved: ${saved}`).toBe(saved);
    },
  },
  {
    id: "nov12-17l-missed-shift-card-keeps-general-plan",
    title: "guard: a missed shift (\"… for violating the attendance policy, missing her saturday and sunday shifts …\") keeps the general plan on the card",
    report: `${REPORT} (the guard: MISSED_SHIFT_NOT_LATENESS keeps the general plan on Create)`,
    status: "fixed",
    fixFlags: FIX,
    async run(t) {
      const thread = start(t);
      const card = await thread.say("make me an CA for Remy Calder for violating the attendance policy, missing her saturday and sunday shifts due to wanting to go home for the weekend but failed to communicate proporley");
      expect(cardPlan(card.content), `a missed shift got the lateness plan:\n${card.content}`).not.toMatch(/arrive on time|Continued lateness/i);
    },
  },
];

/*
 * Ported from the sibling app: Gate-Bubbles-4's NO-GO on its B#824 (G4-824, 12 Nov 2026), reproduced here with S#869: on a "Type of Warning: Termination" card the flag replaced the
 * plan with Pau's attendance plan and lost the termination sentence; Create saves the plan with TERMINATION_PLAN_CLOSING.
 * Guards: with CARD_PLAN_MATCHES_CREATE and TERMINATION_STATED_TICKS on, the card's plan still ends with the termination
 * sentence and never promises the closing for a future violation. Pau's ruling (b), 13 Nov 2026: the plan is the full
 * standard plan (for a late, Pau's attendance template) followed by the termination sentence, not the sentence alone.
 */
const TERMINATION_SENTENCE = "Effective immediately, employment is terminated following the progressive corrective action plan.";
const TERMINATION_SAID = [
  ["late-on-a-date", "I need a term CA for Remy Calder, she was 20 minutes late on 11/9/26"],
  ["terminating-never-showed", "CA for Remy Calder. We are terminating her, she never showed."],
  ["term-ca-did-not-show", "I need a term CA for Remy Calder, she did not show up."],
  ["so-i-need", "CA for Remy Calder. She didn't show up, so I need a term CA."],
] as const;

export const NOV12_G4_824_TERMINATION_PLAN_GUARDS: ReplayCase[] = TERMINATION_SAID.map(([key, said]) => ({
  id: `nov12-g4-824-termination-plan-kept-${key}`,
  title: `guard: "${said}" with the card's plan as Create's: the plan ends with the termination sentence`,
  report: "Ported from the sibling app: Gate-Bubbles-4's NO-GO on its B#824 (G4-824, 12 Nov 2026), reproduced here with S#869",
  status: "fixed",
  fixFlags: [...FIX, "TERMINATION_STATED_TICKS_ENABLED"],
  async run(t) {
    const thread = start(t);
    const card = await thread.say(said);
    if (!/Termination, as you said/.test(card.content)) return; // production's flags: no termination card, nothing to guard
    const plan = cardPlan(card.content);
    expect(plan, `the termination sentence left the plan:\n${card.content}`).toMatch(new RegExp(`${TERMINATION_SENTENCE.replace(/\./g, "\\.")}$`));
    expect(plan, `the plan promises a future violation's closing:\n${card.content}`).not.toMatch(/Future policy violations/);
    // Pau's ruling (b), 13 Nov 2026 (via QA): the full standard plan, then the termination sentence — never the sentence alone.
    expect(plan.replace(TERMINATION_SENTENCE, "").trim(), `the plan is the termination sentence alone:\n${card.content}`).not.toBe("");
    // With the fix flag on, the standard plan is Pau's attendance template (on production's flags, the general plan).
    if (key === "late-on-a-date" && cardPlanMatchesCreateEnabled()) {
      expect(plan, `the attendance template left the termination plan:\n${card.content}`).toContain("Remy is expected to arrive on time for all scheduled shifts moving forward.");
    }
  },
}));

/*
 * Gate-Sunny's #894 finding (14 Nov 2026; QA's ruling (b)): with the card showing Pau's attendance plan, the next turn read
 * the app's own plan words ("arrive on time … Continued lateness …") as a lateness account. The intent reader's described
 * heading became Attendance, and "no payroll deduct" gained an "Attendance Policy, JBA Policy Manual p.14" line the
 * flag-off card never had. The app never reads its own words as the account: the next turn's card gains no citation
 * line. The chat of nov9-ca-shift-answer-own-account-next-turn; Rhea Calloway is that file's invented person.
 */
const RHEA_NEXT: DirectoryRow = { id: "e-rhea-calloway-cpm", firstName: "Rhea", lastName: "Calloway", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0309"], positionName: "Tanning Consultant" };

export const NOV14_CARD_PLAN_OWN_WORDS_NOT_ACCOUNT_CASES: ReplayCase[] = [
  {
    id: "nov14-card-plan-next-turn-not-own-words",
    title: "\"make me CA for Rhea failing to complete shifts\" → answer → \"no payroll deduct\": the plan's own words never add a citation line",
    report: "Gate-Sunny's #894 finding (14 Nov 2026): the app read its own plan as a lateness account on the next turn",
    status: "fixed",
    fixFlags: FIX,
    async run(t) {
      vi.setSystemTime(new Date("2026-11-09T15:00:00Z"));
      t.directory([...STAFF, RHEA_NEXT]);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      await thread.say("make me CA for Rhea failing to complete shifts");
      await thread.say("Rhea Calloway failing to complete shifts 11/7 and 11/8");
      const reply = await thread.say("no payroll deduct");
      expect(reply.content, `the next turn cites a policy read from the app's own plan:\n${reply.content}`).not.toMatch(/^Attendance Policy, JBA Policy Manual p\.14$/m);
    },
  },
];

/*
 * THE AGENT LOOP'S CARD (QA, 15 Nov 2026, with #894's release): with AGENT_LOOP on for the signed-in manager, the card
 * comes from the loop's propose_form. Its card carries no Action Plan: no plan field on the card, none in card_lines or
 * the lines run.ts always adds, and no rules-book line asks for one. So the card never shows a plan that Create's would
 * contradict, and the loop needs no change for CARD_PLAN_MATCHES_CREATE. These cases hold that: if the loop's card ever
 * gains a plan line, it must be the plan Create saves. Create is unchanged under the loop: Pau's attendance plan for a
 * late, and on a termination card that plan with only the termination closing.
 */
const STATED_LATE = "Remy Calder arrived 20 minutes late for her scheduled shift on 11/9/26.";

function loopCard(t: ReplayContext, whatHappened: string, decided: { readonly warning_level?: "termination" } = {}) {
  t.loopModel!(loopStandIn((view) => {
    if (!lastResult(view, "propose_form")) return { tool: "propose_form", input: { template_key: "dpoa", employee_id: "e-2", policy: "Attendance", what_happened: whatHappened, ...decided } };
    return { text: "Here is the Corrective Action card for Remy Calder." };
  }));
}

export const NOV15_CARD_PLAN_AGENT_LOOP_CASES: ReplayCase[] = [
  {
    id: "nov15-card-plan-agent-loop-attendance",
    title: "agent loop on, an attendance CA (\"create a written CA for <B>, she was 20 minutes late on 11/9/26, no action plan\"): the loop's card shows no plan to disagree with, and Create saves Pau's attendance plan",
    report: `${REPORT} (QA, 15 Nov 2026: check the loop's card against Create's plan)`,
    status: "fixed",
    fixFlags: FIX,
    async run(t) {
      if (!t.loopOn?.()) return;
      const thread = start(t);
      loopCard(t, STATED_LATE);
      const card = await thread.say(SAID);
      const shown = cardPlan(card.content);
      t.draftWrites({ observation: "Observed:\nOn November 9, 2026, Remy Calder arrived 20 minutes late." });
      const id = await thread.create();
      const saved = (t.values(id).action_plan ?? "").replace(/\s+/g, " ").trim();
      if (cardPlanMatchesCreateEnabled()) expect(saved, "the saved plan is not Pau's attendance plan").toBe(PAU_PLAN);
      // The loop's card shows no plan; a plan line it ever shows is the saved one.
      if (shown) expect(shown, `the loop's card plan is not the saved plan:\ncard: ${shown}\nsaved: ${saved}`).toBe(saved);
      else expect(card.content, `the loop's card shows a plan line:\n${card.content}`).not.toMatch(/\*\*Action Plan:\*\*/i);
    },
  },
  {
    id: "nov15-card-plan-agent-loop-termination",
    title: "agent loop on, \"I need a term CA for <B>, she was 20 minutes late on 11/9/26\": the loop's card shows no plan, and Create saves the standard plan with only the termination closing",
    report: `${REPORT}; Gate-Bubbles-4's G4-824 via the sibling app (QA, 15 Nov 2026: the loop's termination card)`,
    status: "fixed",
    fixFlags: [...FIX, "TERMINATION_STATED_TICKS_ENABLED"],
    async run(t) {
      if (!t.loopOn?.()) return;
      const thread = start(t);
      /*
       * Changed on purpose (QA's design and third review of batch G, 15 Nov 2026): in the agent loop the model decides a
       * termination (warning_level termination), locked on the word; Create never runs today's reader for a loop card.
       */
      loopCard(t, STATED_LATE, { warning_level: "termination" });
      const card = await thread.say("I need a term CA for Remy Calder, she was 20 minutes late on 11/9/26");
      const shown = cardPlan(card.content);
      t.draftWrites({ observation: "Observed:\nOn November 9, 2026, Remy Calder arrived 20 minutes late." });
      const id = await thread.create();
      const saved = (t.values(id).action_plan ?? "").replace(/\s+/g, " ").trim();
      // Create ticks the loop's locked termination (TERMINATION_STATED_TICKS, on in production).
      expect(t.checked(id).warning_type ?? [], "Create did not tick the stated termination").toContain("termination");
      expect(saved, "the saved termination plan lost its closing").toMatch(new RegExp(`${TERMINATION_SENTENCE.replace(/\./g, "\\.")}$`));
      expect(saved, "the saved termination plan promises a future violation's closing").not.toMatch(/Future policy violations/);
      expect(saved.replace(TERMINATION_SENTENCE, "").trim(), "the saved plan is the termination sentence alone").not.toBe("");
      if (shown) expect(shown, `the loop's card plan is not the saved plan:\ncard: ${shown}\nsaved: ${saved}`).toBe(saved);
      else expect(card.content, `the loop's card shows a plan line:\n${card.content}`).not.toMatch(/\*\*Action Plan:\*\*/i);
    },
  },
];
