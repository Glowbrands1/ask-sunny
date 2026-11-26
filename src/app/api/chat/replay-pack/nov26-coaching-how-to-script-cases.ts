import { expect, vi } from "vitest";

import { STAFF, type ReplayCase, type ReplayContext } from "./cases";
import { loopStandIn, type LoopDecision, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * A COACHING HOW-TO ANSWER ALWAYS HAS AN OUTLINE AND A SCRIPT TO SAY (26 Nov 2026)
 * ============================================================================
 *
 * The rules book said coaching advice is answered "in full (steps, a checklist, a sample script or role-play)": "a" and
 * "or" let an answer be four generic tips, and managers were left with nothing to say. Now every coaching /
 * hard-conversation how-to answer carries a numbered outline (opening, facts and expectation, listening, next steps,
 * follow-up date), a quoted script the manager can read aloud, and a short checklist (`src/lib/ai/coaching-how-to.ts`).
 * The loop hands a reply with no outline or no quoted script back once; the older chat prompt carries the same rule.
 * Manager-style wording; nobody is named.
 */

const FLAG = "AGENT_LOOP_ENABLED";
const REPORT = "Owner, 26 Nov 2026: coaching how-to answers must always give managers a script they can say and an outline of the conversation";

const ASKS = [
  "how do I coach someone who keeps showing up late",
  "give me a script for talking to an employee about their attitude",
  "tips for a hard conversation with a leader about follow-ups",
] as const;

/** What a model wrote before: generic tips, no outline and nothing in quotes. */
const TIPS_ONLY = "Be direct but kind, focus on the behavior rather than the person, listen to their side, and agree on what happens next.";

/** The answer the rule asks for: a numbered outline, a quoted script, a role-play, an action plan, a checklist (the role-play and plan added on purpose with the prep package, 26 Nov 2026). */
const FULL = [
  "Here's how to run it:",
  "1. Opening: set a calm, private tone.",
  "2. The facts and the expectation: what you saw and what good looks like.",
  "3. Listen: ask for their side and let them finish.",
  "4. Next steps: agree one change together.",
  "5. Follow-up: set a date to check in.",
  "",
  "What to say:",
  "\"I wanted to talk with you about the last few shifts. I've noticed this a few times, and I want to understand what's going on and help you get back on track. What's been happening from your side?\"",
  "",
  "Role-play: you play the employee and push back once; practise the expectation together.",
  "Action plan: on time for the next five shifts, checked by you; follow-up on the date above.",
  "",
  "Checklist: facts written down, private space, follow-up date on the calendar.",
].join("\n");

const WHO = /\bwho\s+is\s+(?:this|it)\b[^?]{0,80}\bfor\?/i;

function start(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-11-26T18:00:00Z"));
  t.directory([...STAFF]);
  t.as("admin", { level: "global", primaryAreaId: null, alsoCoversAreaIds: [] });
}

function hasOutline(text: string): boolean {
  return text.split("\n").filter((line) => /^\s*\d{1,2}[.)]\s+\S/.test(line)).length >= 3;
}

function hasQuotedScript(text: string): boolean {
  return [...text.matchAll(/["“]([^"“”\n]{20,})["”]/g)].some((m) => m[1]!.trim().split(/\s+/).length >= 8);
}

/** First answer: tips only. On the app's hand-back: the full answer. */
function tipsThenFull() {
  return loopStandIn((view: LoopView): LoopDecision => {
    const last = view.turns.at(-1)?.text ?? "";
    if (/\[app check\]/.test(last)) return { text: FULL };
    return { text: TIPS_ONLY };
  });
}

const loopCases: ReplayCase[] = ASKS.map((said, index) => ({
  id: `nov26-loop-coaching-how-to-script-${index + 1}`,
  title: `"${said}": the loop's answer has a numbered outline and a quoted script, the rules book requires them, and no form is proposed`,
  report: REPORT,
  status: "fixed" as const,
  fixFlags: [FLAG],
  async run(t: ReplayContext) {
    if (!t.loopOn?.() || process.env.AGENT_LOOP_LIVE === "1") return;
    start(t);
    const standIn = tipsThenFull();
    t.loopModel!(standIn);
    const reply = await t.thread().say(said);
    expect(standIn.views[0]?.system ?? "", "the rules book does not require the outline and the script").toMatch(/sample script in quotation marks that the manager can read aloud word for word/);
    expect(hasOutline(reply.content), `no numbered outline:\n${reply.content}`).toBe(true);
    expect(hasQuotedScript(reply.content), `no quoted script:\n${reply.content}`).toBe(true);
    expect(reply.content, reply.content).not.toMatch(WHO);
    expect(reply.formProposal ?? null, "a card was made for an advice question").toBeNull();
  },
}));

export const NOV26_COACHING_HOW_TO_SCRIPT_CASES: ReplayCase[] = [
  ...loopCases,
  {
    id: "nov26-loop-coaching-how-to-full-answer-kept",
    title: "A coaching how-to answer that already has the outline and the script is kept as it is (no extra model call)",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.() || process.env.AGENT_LOOP_LIVE === "1") return;
      start(t);
      const standIn = loopStandIn((): LoopDecision => ({ text: FULL }));
      t.loopModel!(standIn);
      const reply = await t.thread().say(ASKS[0]);
      expect(reply.content).toBe(FULL);
      expect(standIn.views.length, "the full answer was handed back").toBe(1);
    },
  },
  {
    id: "nov26-loop-coaching-how-to-policy-question-untouched",
    title: "Control: a policy lookup (\"what's the PTO policy?\") is not handed back for a script",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.() || process.env.AGENT_LOOP_LIVE === "1") return;
      start(t);
      const standIn = loopStandIn((): LoopDecision => ({ text: "Here is what the JBA Policy Manual says about time off." }));
      t.loopModel!(standIn);
      await t.thread().say("what's the PTO policy?");
      expect(standIn.views.some((view) => /\[app check\]/.test(view.turns.at(-1)?.text ?? "")), "a policy lookup was asked for a script").toBe(false);
    },
  },
  ...ASKS.map((said, index): ReplayCase => ({
    id: `nov26-chat-coaching-how-to-script-rule-${index + 1}`,
    title: `The older chat path: "${said}" is answered with a prompt that requires the outline, the quoted script and the checklist`,
    report: REPORT,
    status: "fixed",
    async run(t) {
      start(t);
      t.modelSays(FULL);
      const reply = await t.thread().say(said);
      const system = t.lastSystem?.() ?? "";
      expect(system, "the chat prompt does not require a script").toMatch(/sample script in quotation marks that the manager can read aloud word for word/);
      expect(system).toMatch(/numbered list: the opening, the facts and the expectation, listening to their side, agreement on next steps, and a follow-up date/);
      expect(reply.formProposal ?? null, "a card was made for an advice question").toBeNull();
    },
  })),
];
