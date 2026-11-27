import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";
import { lastResult, loopStandIn, type LoopDecision, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * A COACHING HOW-TO IS A PREP PACKAGE, IN EVERY ANSWER MODE (the owner, 26 Nov 2026)
 * ============================================================================
 *
 * The owner's target for coaching (the mechanism of a sibling product, with our own content and citation rules):
 *
 *   - a coaching how-to answer is a prep package: why the behavior matters, when to have the conversation, the outline,
 *     the words to use (a quoted script), a relatable analogy, a role-play to run together, and a measurable action plan
 *     with a follow-up date;
 *   - "how do I help an employee who is struggling with X": coaching guidance, then what a coaching form would hold
 *     (Observed / Expectation / Practice / Follow-Up), then the role-play tied to the follow-up date, and an offer to make
 *     the form;
 *   - a Coaching card gets the same prep in the reply above it, never on the card or the form;
 *   - "Coach a leader on running better follow-up conversations" (QA, 24 Nov 2026: answered only "Who is this Coaching
 *     Form for?") gets the package in Quick, Standard and Detailed.
 *
 * The loop hands an advice reply missing a part back once (`coaching-how-to.ts`). Invented names only (Remy Calder).
 */

const LOOP = "AGENT_LOOP_ENABLED";
const MODES = "ANSWER_MODE_ON_LOOP_ENABLED";
const REPORT = "The owner, 26 Nov 2026: coaching how-to answers come as a prep package (why, when, words to use, analogy, role-play, measurable action plan with a follow-up date)";
const WHO = /\bwho\s+is\s+(?:this|it)\b[^?]{0,80}\bfor\?/i;

/** An answer with the outline and the script but no role-play and no plan: what the first rule allowed. */
const OUTLINE_AND_SCRIPT = [
  "1. Opening: set a calm, private tone.",
  "2. The facts and the expectation.",
  "3. Listen to their side.",
  "4. Agree on next steps.",
  "5. Set a follow-up date.",
  "",
  "\"I wanted to talk with you about how the last few weeks have gone, and how I can help you get where we both want you to be.\"",
].join("\n");

/** The prep package the rule asks for. */
const PREP = [
  "**Why it matters:** guests notice when the basics slip, and the team counts on each other.",
  "**When:** soon after you see it, privately, before their next shift.",
  "",
  "1. Opening: set a calm, private tone.",
  "2. The facts and the expectation.",
  "3. Listen to their side.",
  "4. Agree on next steps.",
  "5. Follow-up date: one week from today.",
  "",
  "**Words to use:** \"I wanted to talk with you about how the last few weeks have gone, and how I can help you get where we both want you to be.\"",
  "",
  "**Analogy:** it's like a relay — the next person can only run if the baton is handed over cleanly.",
  "",
  "**Role-play:** you play the employee and push back once; they practise the expectation in their own words.",
  "",
  "**Action plan:** three of the next five shifts done to the standard, checked by you; follow-up on the date above.",
  "",
  "**In a coaching form:** Observed — what you saw. Expectation — the standard. Practice — the role-play. Follow-Up — the date.",
  "",
  "Want me to start a Coaching Form for this?",
].join("\n");

/** The prep above a Coaching card for Remy Calder: the person by name, never a pronoun (the pack's card-reply rule). */
const CARD_PREP = [
  "Here's the Coaching Form for **Remy Calder**, and your prep for the conversation.",
  "",
  "**Why it matters:** guests who hear about the upgrade often take it, and the team's numbers depend on every offer.",
  "**When:** before Remy Calder's next shift, privately.",
  "",
  "1. Opening: set a calm, private tone.",
  "2. The facts and the expectation: every guest hears the upgrade offer.",
  "3. Listen to Remy Calder's side.",
  "4. Agree on next steps.",
  "5. Follow-up date: one week from today.",
  "",
  "**Words to use:** \"I want to talk about the upgrade offer, because guests can only say yes to what we offer them, and I want to help make it easy.\"",
  "",
  "**Analogy:** it's like a menu — nobody orders a dish that was never shown.",
  "",
  "**Role-play:** you play the guest and say no once; Remy Calder practises the offer and the reply.",
  "",
  "**Action plan:** the offer made to every guest for five shifts, checked by you; follow-up on the date above.",
].join("\n");

function start(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-11-26T18:00:00Z"));
  t.directory([...STAFF]);
  t.as("salon_director", KEARNEY);
}

const handedBack = (view: LoopView) => /\[app check\]/.test(view.turns.at(-1)?.text ?? "");

function expectPrep(content: string) {
  expect(content, content).toMatch(/role-?\s?play/i);
  expect(content, content).toMatch(/action plan/i);
  expect(content, content).toMatch(/follow-?\s?up/i);
  expect(content, content).toMatch(/["“][^"“”\n]{40,}["”]/);
  expect(content.split("\n").filter((line) => /^\s*\d{1,2}[.)]\s+\S/.test(line)).length, content).toBeGreaterThanOrEqual(3);
  expect(content, content).not.toMatch(WHO);
}

const STRUGGLING = "how do I help an employee who is struggling with upselling";
const COACH_LEADER = "Coach a leader on running better follow-up conversations";

const loopOnly = (run: (t: ReplayContext) => Promise<void>) => async (t: ReplayContext) => {
  if (!t.loopOn?.() || process.env.AGENT_LOOP_LIVE === "1") return;
  await run(t);
};

const byMode = (mode: "quick" | "standard" | "detailed"): ReplayCase => ({
  id: `nov26-coaching-prep-coach-a-leader-${mode}`,
  title: `"${COACH_LEADER}" in ${mode}: no "Who is this Coaching Form for?", and the answer is the prep package (outline, quoted script, role-play, action plan)`,
  report: REPORT,
  status: "fixed",
  fixFlags: [LOOP, MODES],
  run: loopOnly(async (t) => {
    start(t);
    const standIn = loopStandIn((view: LoopView): LoopDecision => {
      if (handedBack(view)) return { text: PREP };
      const result = lastResult(view, "propose_form") as { reason_code?: string; ask_exactly?: string } | null;
      if (!result) return { tool: "propose_form", input: { template_key: "coaching" } };
      // On the refusal, the model answers with only the outline and the script.
      if (result.reason_code === "advice_not_form") return { text: OUTLINE_AND_SCRIPT };
      return { text: result.ask_exactly ?? "Here's the card." };
    });
    t.loopModel!(standIn);
    const reply = await t.thread().say(COACH_LEADER, {}, { mode });
    expect(reply.formProposal ?? null, "a card was made for an advice question").toBeNull();
    expectPrep(reply.content);
    if (mode === "quick") {
      expect(standIn.views[0]?.system ?? "", "Quick's length line drops the coaching package").toMatch(/A coaching how-to keeps every part of its prep package/);
    }
  }),
});

export const NOV26_COACHING_PREP_PACKAGE_CASES: ReplayCase[] = [
  {
    id: "nov26-coaching-prep-struggling-employee",
    title: `"${STRUGGLING}": guidance, what a coaching form would hold (Observed / Expectation / Practice / Follow-Up), the role-play and the plan, and an offer of the form; no card`,
    report: REPORT,
    status: "fixed",
    fixFlags: [LOOP],
    run: loopOnly(async (t) => {
      start(t);
      const standIn = loopStandIn((view: LoopView): LoopDecision => (handedBack(view) ? { text: PREP } : { text: OUTLINE_AND_SCRIPT }));
      t.loopModel!(standIn);
      const reply = await t.thread().say(STRUGGLING);
      const system = standIn.views[0]?.system ?? "";
      expect(system, "the rules book does not teach the struggling-employee order").toMatch(/struggling with <X>[\s\S]{0,200}Observed \/ Expectation \/ Practice \/ Follow-Up/);
      expect(system).toMatch(/a relatable analogy/);
      expect(system).toMatch(/measurable action plan/);
      expect(reply.formProposal ?? null, "a card was made for an advice question").toBeNull();
      expectPrep(reply.content);
      expect(reply.content).toMatch(/Observed[\s\S]*Expectation[\s\S]*Practice[\s\S]*Follow-Up/);
    }),
  },
  {
    id: "nov26-coaching-prep-above-coaching-card",
    title: "\"coaching for Remy Calder, she keeps forgetting to offer the upgrade\": the Coaching card is made, the prep package is in the reply above it, and the card holds only the manager's account",
    report: REPORT,
    status: "fixed",
    fixFlags: [LOOP],
    run: loopOnly(async (t) => {
      start(t);
      const said = "coaching for Remy Calder, she keeps forgetting to offer the upgrade";
      const standIn = loopStandIn((view: LoopView): LoopDecision => {
        if (lastResult(view, "propose_form")) return { text: CARD_PREP };
        const managerTurn = view.turns.filter((turn) => turn.role === "user").at(-1);
        return { tool: "propose_form", input: { template_key: "coaching", employee_name: "Remy Calder", person_evidence: { message_id: managerTurn?.messageIds?.at(-1) ?? "current", quote: "Remy Calder" }, what_happened: "She keeps forgetting to offer the upgrade.", policy: "Other — offering the upgrade" } };
      });
      t.loopModel!(standIn);
      const reply = await t.thread().say(said);
      expect(standIn.views[0]?.system ?? "", "the rules book does not ask for prep above a coaching card").toMatch(/the reply above the card gives the prep package/);
      expect(reply.formProposal, reply.content).toMatchObject({ templateKey: "coaching", employeeName: "Remy Calder" });
      expectPrep(reply.content);
      const card = JSON.stringify(reply.formProposal);
      expect(card, "the prep reached the card").not.toMatch(/role-?\s?play|Words to use|menu/i);
    }),
  },
  byMode("quick"),
  byMode("standard"),
  byMode("detailed"),
];
