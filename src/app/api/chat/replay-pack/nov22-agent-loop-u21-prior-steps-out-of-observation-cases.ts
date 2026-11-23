import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayCase } from "./cases";
import { evidenceFrom, headingWith, lastResult, loopStandIn, type LoopDecision, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * PRIOR STEPS BELONG IN PRIOR ACTIONS, NEVER THE OBSERVATION (port of Ask Bubbles #1054: its QA's live round 3, 22 Nov
 * 2026, U21, and its live triage of U09)
 * ============================================================================
 *
 * Found in Ask Bubbles, the same code in Sunny.
 * - U21: a long Corrective Action chat on an all-salon admin login, the tester's turns word for word (the person invented).
 *   From T3 on the card's Observation held the prior coaching ("<P> received coaching on 9/22 for cleaning tasks not
 *   being completed. This weekend …"), and T4 added "JBA Woven policies were acknowledged on 5/26/26." to it: whole
 *   sentences, each a prior step the card's Prior actions already listed. The stand-in writes the account as the live
 *   model did.
 * - U09: "JBA Policy Manual 1-1-2026, Verbal CA 11-1-2026. On 11-1-26 <P> violated …": the live model kept only
 *   "Verbal CA 11/1/2026" and wrote "JBA Policy Manual 1/1/2026." into the account. The manual's step, listed in the
 *   same sentence as a step the card keeps, is on Prior actions and out of the Observation.
 * The tester's place words are Sunny's salon and bed-room duties here; the mechanism is the same.
 */

const FLAG = "AGENT_LOOP_ENABLED";
const REPORT_U21 = "QA's Bubbles live round 3 (22 Nov 2026, U21; port of Ask Bubbles #1054): the Observation held the prior coaching from T3 on, and T4's policy acknowledgement too";
const REPORT_U09 = "QA's Bubbles live triage (22 Nov 2026, U09; port of Ask Bubbles #1054): prior actions held only the Verbal CA; \"JBA Policy Manual 1/1/2026\" went into the Observation";
const OSWIN: DirectoryRow = { id: "e-oswin-tallard", firstName: "Oswin", lastName: "Tallard", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0309"], positionName: "Tanning Consultant" };
const ADMIN = { level: "global", primaryAreaId: null, alsoCoversAreaIds: [] };

const U21 = {
  T1: "corrective action",
  T2: "oswin tallard",
  T3: "This is what happened: She has recieved coaching on 9/22 for cleaning tasks not being completed. What was observed this weekend is that beds were not wiped down after each guest, towels were not restocked",
  T4: "jba woven policys were acknowledged on 5/26/26",
} as const;
const LIVE_ACCOUNT_T3 = "Oswin Tallard received coaching on 9/22 for cleaning tasks not being completed. This weekend, beds were not wiped down after each guest, and towels were not restocked.";
const LIVE_ACCOUNT_T4 = `${LIVE_ACCOUNT_T3} JBA Woven policies were acknowledged on 5/26/26.`;

const said = (view: LoopView) => view.turns.filter((turn) => turn.role === "user").at(-1)?.text ?? "";
const back = (view: LoopView, text: string) => {
  const asks = view.turns.filter((turn) => turn.role === "user" && (turn.messageIds?.length ?? 0) > 0);
  return Math.max(0, asks.length - 1 - asks.findIndex((turn) => turn.text === text));
};

export const NOV22_AGENT_LOOP_U21_PRIOR_STEPS_OUT_OF_OBSERVATION_CASES: ReplayCase[] = [
  {
    id: "nov22-u21-r3-prior-steps-leave-observation",
    title: "U21 round 3 (T1–T4, the tester's words): the prior coaching (T3) and the policy acknowledgement (T4), written by the model as sentences of the account, are on the card's Prior actions and never in its Observation, on the card and in the saved form",
    report: REPORT_U21,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.() || process.env.AGENT_LOOP_LIVE === "1") return;
      vi.setSystemTime(new Date("2026-11-22T18:00:00Z"));
      t.directory([...STAFF, OSWIN]);
      t.as("admin", ADMIN);
      t.loopModel!(loopStandIn((view): LoopDecision => {
        const message = said(view);
        if (lastResult(view, "propose_form")) return { text: "Here's the Corrective Action Form for **Oswin Tallard**." };
        if (message === U21.T1) return { text: "Who is this Corrective Action Form for?" };
        if (message === U21.T2) return { text: "Got it, Oswin Tallard. What happened?" };
        const t4 = view.turns.some((turn) => turn.role === "user" && turn.text === U21.T4);
        return {
          tool: "propose_form",
          input: {
            template_key: "dpoa",
            employee_id: OSWIN.id,
            person_evidence: evidenceFrom(view, "oswin tallard", back(view, U21.T2)),
            policy: headingWith(view, /standards of conduct/i),
            what_happened: t4 ? LIVE_ACCOUNT_T4 : LIVE_ACCOUNT_T3,
            prior_actions: t4 ? "Coaching — 09/22/2026 (cleaning tasks not being completed); JBA Woven policies acknowledged — 05/26/2026" : "Coaching — 09/22/2026 (cleaning tasks not being completed)",
          },
        };
      }));
      const thread = t.thread();
      const cards: { turn: string; issue: string; prior: string }[] = [];
      for (const turn of Object.values(U21)) {
        await thread.say(turn);
        const card = thread.proposal as { issue?: string; priorActions?: string } | null;
        /* From T3, the account's turn: the live model may show a card at T2, before there is any account. */
        if (card && turn !== U21.T1 && turn !== U21.T2) cards.push({ turn, issue: card.issue ?? "", prior: card.priorActions ?? "" });
      }
      expect(cards.length, "no card from T3 on").toBeGreaterThanOrEqual(2);
      for (const card of cards) {
        expect(card.issue, `the Observation holds a prior step (${card.turn})`).not.toMatch(/9\/22|5\/26|coaching|acknowledged/i);
        expect(card.issue, "the incident left the Observation").toMatch(/wiped down/i);
        expect(card.prior, "the prior coaching left Prior actions").toMatch(/09\/22\/2026/);
      }
      expect(cards.at(-1)!.prior, "T4's acknowledgement is not in Prior actions").toMatch(/05\/26\/2026/);
      const id = await thread.create();
      expect(t.values(id).prior_actions ?? "", "the saved Prior actions lost a step").toMatch(/09\/22\/2026[\s\S]*05\/26\/2026/);
    },
  },
  {
    id: "nov22-u09-listed-step-on-prior-actions-not-observation",
    title: "U09 (live triage): the model keeps only \"Verbal CA 11/1/2026\" and writes \"JBA Policy Manual 1/1/2026.\" into the account — the manual's step, listed with the Verbal CA, is on Prior actions and not in the Observation",
    report: REPORT_U09,
    /*
     * Open until #1234 (the U09 port, Ask Bubbles #1045) merges: on main the Verbal CA's own date is refused as "this
     * incident's date", so the card keeps no step at all and nothing is listed with it. With #1234 the Verbal CA is kept,
     * and this PR's `listedWithKeptSteps` adds the manual's step; the pack flags the day this case passes.
     */
    status: { open: "needs #1234 (U09): on main the Verbal CA dated on the incident's day is refused, so no step is kept" },
    fixFlags: [FLAG],
    fixStatus: { open: "the same with the loop on" },
    async run(t) {
      if (!t.loopOn?.() || process.env.AGENT_LOOP_LIVE === "1") return;
      vi.setSystemTime(new Date("2026-11-21T18:00:00Z"));
      t.directory([...STAFF, OSWIN]);
      t.as("salon_director", KEARNEY);
      const T1 = "create a written CA for Oswin Tallard.";
      const T2 = "JBA Policy Manual 1-1-2026, Verbal CA 11-1-2026. On 11-1-26 Oswin Tallard violated care and cleaning of facilities policy";
      t.loopModel!(loopStandIn((view): LoopDecision => {
        if (lastResult(view, "propose_form")) return { text: "Here's the Corrective Action Form for **Oswin**." };
        const message = view.turns.filter((turn) => turn.role === "user" && (turn.messageIds?.length ?? 0) > 0).at(-1)?.text ?? "";
        const level = { warning_level: "written", level_evidence: evidenceFrom(view, "written", message.startsWith("JBA") ? 1 : 0) };
        if (!message.startsWith("JBA")) return { tool: "propose_form", input: { template_key: "dpoa", employee_id: OSWIN.id, ...level, person_evidence: evidenceFrom(view, "Oswin Tallard") } };
        return { tool: "propose_form", input: { template_key: "dpoa", employee_id: OSWIN.id, ...level, what_happened: "JBA Policy Manual 1/1/2026. On 11/1/26, Oswin violated the care and cleaning of facilities policy.", incident_date: "2026-11-01", policy: headingWith(view, /care and cleaning/i), prior_actions: "Verbal CA — 11/01/2026", person_evidence: evidenceFrom(view, "Oswin Tallard") } };
      }));
      const thread = t.thread();
      await thread.say(T1);
      await thread.say(T2);
      const card = thread.proposal as { issue?: string; priorActions?: string } | null;
      expect(card?.priorActions ?? "", "the manual's step is not on Prior actions").toMatch(/Policy Manual[^;\n]*\b0?1\/0?1\/(?:20)?26\b/i);
      expect(card?.priorActions ?? "", "the Verbal CA left Prior actions").toMatch(/Verbal CA/);
      expect(card?.issue ?? "", "the manual's step is in the Observation").not.toMatch(/1\/1\/2026|Policy Manual/);
      expect(card?.issue ?? "", "the incident left the Observation").toMatch(/violated/i);
      const id = await thread.create();
      expect(t.values(id).prior_actions ?? "", "the saved Prior actions lost the manual's step").toMatch(/Policy Manual[^;\n]*\b0?1\/0?1\/(?:20)?26\b/i);
    },
  },
];
