import { expect, vi } from "vitest";

import { STAFF, type ReplayCase, type ReplayContext } from "./cases";
import { lastResult, loopStandIn, type LoopDecision, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * ADVICE ABOUT COACHING IS ANSWERED, NEVER A FORM INTAKE (QA, live, 24 Nov 2026)
 * ============================================================================
 *
 * QA, Standard mode (the agent loop), admin with global scope, twice: "Coach a leader on running better follow-up
 * conversations" was answered only "Who is this Coaching Form for?". On 16 Nov the same words got a full answer
 * ("Running strong follow-up is where most coaching actually succeeds or fails…"). The model called propose_form with
 * no person, and its ask_exactly is the who-question. Now propose_form refuses a card for a turn whose words ask for
 * advice and no form (advice_not_form, `agent-loop/advice-not-form.ts`), and a reply that still only asks who goes back
 * once. Control: "Create a coaching form." (the home shortcut) still asks who the Coaching Form is for.
 */

const FLAG = "AGENT_LOOP_ENABLED";
const REPORT = "QA, live on the agent loop (24 Nov 2026): \"Coach a leader on running better follow-up conversations\" got only \"Who is this Coaching Form for?\"";
const SAID = "Coach a leader on running better follow-up conversations";
const ADVICE = "Running strong follow-up is where most coaching actually succeeds or fails. 1. Open with what you agreed last time. 2. Ask what changed. 3. Agree one next step and a date.";
const WHO = /\bwho\s+is\s+(?:this|it)\b[^?]{0,80}\bfor\?/i;

type Out = { reason_code?: string; ask_exactly?: string } | null;

function start(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-11-24T18:00:00Z"));
  t.directory([...STAFF]);
  t.as("admin", { level: "global", primaryAreaId: null, alsoCoversAreaIds: [] });
}

const loopCase = (id: string, title: string, run: (t: ReplayContext) => Promise<void>): ReplayCase => ({
  id, title, report: REPORT, status: "fixed", fixFlags: [FLAG],
  async run(t) {
    if (!t.loopOn?.() || process.env.AGENT_LOOP_LIVE === "1") return;
    await run(t);
  },
});

/** The model reads "coach" as the Coaching Form and calls propose_form with no person; on a refusal it answers. */
function proposesCoaching() {
  return loopStandIn((view: LoopView): LoopDecision => {
    const result = lastResult(view, "propose_form") as Out;
    if (!result) return { tool: "propose_form", input: { template_key: "coaching" } };
    if (result.reason_code === "advice_not_form") return { text: ADVICE };
    return { text: result.ask_exactly ?? "Here's the card." };
  });
}

export const NOV24_AGENT_LOOP_ADVICE_NOT_FORM_CASES: ReplayCase[] = [
  loopCase("nov24-loop-advice-not-form-propose", `"${SAID}", the model calling propose_form with no person: answered, never "Who is this Coaching Form for?"`, async (t) => {
    start(t);
    const standIn = proposesCoaching();
    t.loopModel!(standIn);
    const thread = t.thread();
    const reply = await thread.say(SAID);
    expect(reply.content, reply.content).not.toMatch(WHO);
    expect(reply.formProposal ?? null, "a card was made for an advice question").toBeNull();
    expect(reply.content, reply.content).toMatch(/follow-up/i);
    const codes = standIn.views.flatMap((view) => view.results).map((entry) => String((entry.output as { reason_code?: unknown }).reason_code ?? ""));
    expect(codes, reply.content).toContain("advice_not_form");
  }),
  loopCase("nov24-loop-advice-not-form-text-only", `"${SAID}", the model replying only "Who is this Coaching Form for?" with no tool: handed back and answered`, async (t) => {
    start(t);
    t.loopModel!(loopStandIn((view: LoopView): LoopDecision => {
      const last = view.turns.at(-1)?.text ?? "";
      if (/\[app check\]/.test(last)) return { text: ADVICE };
      return { text: "Who is this Coaching Form for?" };
    }));
    const reply = await t.thread().say(SAID);
    expect(reply.content, reply.content).not.toMatch(WHO);
    expect(reply.content, reply.content).toMatch(/follow-up/i);
  }),
  loopCase("nov24-loop-advice-not-form-control-create", "Control: \"Create a coaching form.\" (the home shortcut) still asks who the Coaching Form is for", async (t) => {
    start(t);
    t.loopModel!(proposesCoaching());
    const reply = await t.thread().say("Create a coaching form.");
    expect(reply.content, reply.content).toMatch(/who is this Coaching Form for\?/i);
  }),
];
