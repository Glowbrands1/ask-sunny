import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayCase, type ReplayContext } from "./cases";
import { evidenceFrom, lastResult, loopStandIn, type LoopDecision, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * THE RESIGNATION REASON THE MANAGER GIVES REACHES THE CARD AND THE SAVED FORM (port of Ask Bubbles #1047, c722fe71: its
 * QA's live round 3, 22 Nov 2026, B6)
 * ============================================================================
 *
 * Found in Ask Bubbles, the same code in Sunny. The tester's turns word for word (names invented): T1 "can you make me an
 * exit form for <P1> she is in woven under <P2>. Her last day is nov 23 she is returning her key she gave 2 weeks notice
 * and is fulfilling them. no deduction at this time", T5 "last day worked will be nov 23, notice was given last Monday,
 * eligible for rehire, notice will be attached, leave address blank I will fill it in", T6 "she is resigning due to second
 * job I'm ready for the draft". The saved draft had no Reason for Resignation. Sunny's loop card had no reason field: the
 * reason came only from the exit form's Details reader (`exit-details.ts` reasonIn), which misses other wordings ("she
 * found a better paying job elsewhere"), and a model handed back for claiming the reason had nothing to call propose_form
 * with. Now propose_form takes exit_reason with exit_reason_evidence (`exit-reason-said.ts`); reads_back lists it; Create
 * checks the quote again and saves it as the manager's statement.
 */

const REPORT = "Ask Bubbles' live round 3 (22 Nov 2026, B6; port of #1047): \"she is resigning due to second job\" never reached Reason for Resignation, and other wordings never could";
/* Invented; not on the directory. */
const ODILE: DirectoryRow = { id: "e-odile-brannaway", firstName: "Odile", lastName: "Brannaway", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0309"], positionName: "Tanning Consultant" };
const BEFORE = [
  "can you make me an exit form for Odile she is in woven under Odile Brannaway. Her last day is nov 23 she is returning her key she gave 2 weeks notice and is fulfilling them. no deduction at this time",
  "last day worked will be nov 23, notice was given last Monday, eligible for rehire, notice will be attached, leave address blank I will fill it in",
] as const;
const T6 = "she is resigning due to second job I'm ready for the draft";
const OTHER = "she found a better paying job elsewhere, go ahead and draft it";

type Out = { card?: { reads_back?: string[] } | null } | null;
const users = (view: LoopView) => view.turns.filter((turn) => turn.role === "user" && (turn.messageIds?.length ?? 0) > 0).length;
const handedBack = (view: LoopView) => view.turns.some((turn) => /^\[app check\]/.test(turn.text) && /exit field/.test(turn.text));

/** The exit card each turn, its reply the card's reads_back; on the last turn (a reason given), exit_reason quoting those words. */
function decide(reason: string | null, quote: string) {
  return (view: LoopView): LoopDecision => {
    const result = lastResult(view, "propose_form") as Out;
    if (result) return { text: ["Here's the Resignation/Exit Form for **Odile**.", ...(result.card?.reads_back ?? [])].join("\n\n") };
    const turn = users(view);
    return {
      tool: "propose_form",
      input: {
        template_key: "stc-exit", employee_id: ODILE.id, exit_type: "resignation",
        exit_evidence: { ...evidenceFrom(view, "can you make me an exit form", turn - 1), kind: "asks_for_exit_form" },
        payroll_deduct: "no", payroll_evidence: evidenceFrom(view, "no deduction at this time", turn - 1),
        ...(reason && turn === BEFORE.length + 1 ? { exit_reason: reason, exit_reason_evidence: evidenceFrom(view, quote, 0) } : {}),
      },
    };
  };
}

/* Production's path: the model first claims the reason with no tool call; handed back, it passes exit_reason. */
function claimsFirst(reason: string, quote: string) {
  const card = decide(reason, quote);
  return (view: LoopView): LoopDecision =>
    users(view) === BEFORE.length + 1 && !handedBack(view) && !lastResult(view, "propose_form") ? { text: `Noted the reason — **Reason for Resignation:** ${reason}.` } : card(view);
}

async function chat(t: ReplayContext, last: string, reason: string | null, quote: string, claimFirst = false) {
  vi.setSystemTime(new Date("2026-11-21T18:00:00Z"));
  t.directory([...STAFF, ODILE]);
  t.as("salon_director", KEARNEY);
  t.loopModel!(loopStandIn(claimFirst && reason ? claimsFirst(reason, quote) : decide(reason, quote)));
  const thread = t.thread();
  for (const said of BEFORE) await thread.say(said);
  const reply = await thread.say(last);
  expect(thread.proposal?.templateKey, `no exit card (the case proves nothing):\n${reply.content}`).toBe("stc-exit");
  const id = await thread.create();
  return { reply, card: thread.proposal as { exitReason?: string } | null, saved: t.values(id) };
}

const loopCase = (id: string, title: string, run: (t: ReplayContext) => Promise<void>): ReplayCase => ({
  id,
  title,
  report: REPORT,
  status: "fixed",
  fixFlags: ["AGENT_LOOP_ENABLED"],
  async run(t) {
    /* Stand-ins replay the model's turns: they prove the tool and Create, so they do not run against the live model. */
    if (!t.loopOn?.() || process.env.AGENT_LOOP_LIVE === "1") return;
    await run(t);
  },
});

export const NOV22_AGENT_LOOP_B6_RESIGNATION_REASON_CASES: ReplayCase[] = [
  loopCase("nov22-b6-resignation-reason-due-to-second-job", `B6 verbatim T6 "${T6}": the card, the reply and the saved Reason for Resignation all say the second job`, async (t) => {
    const { reply, card, saved } = await chat(t, T6, "Second job", "she is resigning due to second job");
    expect(card?.exitReason ?? "", `the card has no reason:\n${reply.content}`).toMatch(/second job/i);
    expect(reply.content, `reads_back does not list the reason:\n${reply.content}`).toMatch(/\*\*Reason for Resignation:\*\* Second job\./);
    expect(saved.resignation_reason ?? "", JSON.stringify(saved)).toMatch(/^second job\.?$/i);
  }),
  loopCase("nov22-b6-resignation-reason-other-wording", `B6, another wording: "${OTHER}" (no "due to" or "because"): the card reads back and Create saves the reason in the manager's words`, async (t) => {
    /* The exit form's own Details reader (`exit-details.ts`) reads none of this sentence; the model's exit_reason does. */
    const { reply, saved } = await chat(t, OTHER, "Found a better paying job elsewhere", "she found a better paying job elsewhere");
    expect(reply.content, `reads_back does not list the reason:\n${reply.content}`).toMatch(/\*\*Reason for Resignation:\*\* Found a better paying job elsewhere\./);
    expect(saved.resignation_reason ?? "", `${reply.content}\n${JSON.stringify(saved)}`).toMatch(/^found a better paying job elsewhere\.?$/i);
  }),
  loopCase("nov22-b6-resignation-reason-claimed-then-handed-back", "B6, production's path: \"she found a better paying job elsewhere, I'm ready for the draft\" first claimed with no tool call; handed back, the model passes exit_reason and Create saves it", async (t) => {
    const { reply, saved } = await chat(t, "she found a better paying job elsewhere, I'm ready for the draft", "Found a better paying job elsewhere", "she found a better paying job elsewhere", true);
    expect(reply.content, `reads_back does not list the reason:\n${reply.content}`).toMatch(/Reason for Resignation:?\*?\*?:? Found a better paying job elsewhere/i);
    expect(saved.resignation_reason ?? "", JSON.stringify(saved)).toMatch(/^found a better paying job elsewhere\.?$/i);
  }),
  loopCase("nov22-b6-resignation-reason-not-in-quote-refused", "B6 control: a reason with a word the manager never said (\"Better pay at a second job\" for \"due to second job\") is never kept or saved", async (t) => {
    const { reply, card, saved } = await chat(t, T6, "Better pay at a second job", "she is resigning due to second job");
    expect(card?.exitReason ?? "", reply.content).toBe("");
    expect(saved.resignation_reason ?? "", JSON.stringify(saved)).not.toMatch(/better pay/i);
  }),
  loopCase("nov22-b6-no-reason-given-stays-blank", "B6 control: \"I'm ready for the draft\" with no reason given anywhere: Reason for Resignation stays blank", async (t) => {
    const { reply, saved } = await chat(t, "I'm ready for the draft", null, "");
    expect(reply.content).not.toMatch(/Reason for Resignation/i);
    expect(saved.resignation_reason ?? "", JSON.stringify(saved)).toBe("");
  }),
];
