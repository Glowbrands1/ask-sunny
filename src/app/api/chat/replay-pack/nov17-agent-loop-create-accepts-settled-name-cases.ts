import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";
import { loopStandIn, type LoopDecision, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * A CARD THE LOOP SHOWS AS READY PASSES CREATE (Runner 2's saved-form run on 33863575, c003; QA, 17 Nov 2026)
 * ============================================================================
 *
 * 6 of 138 loop cards were refused at Create: "This proposal is out of date: the conversation now says the form is for
 * <typed>, not <card name>". The loop had settled the typed spelling as the card's person (its recorded Did-you-mean and
 * the manager's yes); Create's currency check reads the chat's words only and read the typed spelling as someone else.
 * The rule: Create's check is given the loop's recorded settlement for that card, never loosened, so a ready card passes
 * and a later switch to a different person is still refused. Invented names only (Remy Calder; typed "Remy Cadler", two letters swapped;
 * Juno Paxton, on the staff list, as the other person).
 */

const FLAG = "AGENT_LOOP_ENABLED";
const REPORT = "Runner 2's saved-form run on 33863575 (QA, 17 Nov 2026): 6 of 138 loop cards refused at Create, \"This proposal is out of date: the conversation now says the form is for <typed>, not <card name>\" (c003)";
const TYPED = "Remy Cadler";
const OTHER = "Juno Paxton";

function start(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-11-17T11:00:00Z"));
  t.directory([...STAFF]);
  t.as("salon_director", KEARNEY);
}

const managerTurns = (view: LoopView) => view.turns.filter((turn) => turn.role === "user" && (turn.messageIds?.length ?? 0) > 0);
const quoted = (view: LoopView, quote: string) => ({ message_id: [...managerTurns(view)].reverse().find((turn) => turn.text.toLowerCase().includes(quote.toLowerCase()))?.messageIds?.at(-1) ?? "current", quote });

/** The live model: find_staff for the typed name first, then a CA for the staff-list person (the typed spelling as evidence). */
function liveModel(account: (view: LoopView) => string, paraphrase: boolean | "lead" = false) {
  return loopStandIn(liveDecision(account, paraphrase));
}

function liveDecision(account: (view: LoopView) => string, paraphrase: boolean | "lead" = false) {
  return (view: LoopView): LoopDecision => {
    const result = [...view.results].reverse().find((entry) => entry.tool === "propose_form" || entry.tool === "find_staff")?.output;
    /* The live model words the recorded question its own way (the record, not the reply's text, is what was asked). */
    const asked = (question: string) => (paraphrase === "lead" ? `I have the late arrival on 11/14.\n\n${question}` : paraphrase ? "Just to check before it goes on the form: is this **Remy Calder** from your staff list?" : question);
    if (result) return { text: typeof result.ask_exactly === "string" ? asked(result.ask_exactly) : "Here's the Corrective Action Form for **Remy Calder**." };
    if (managerTurns(view).length === 1) return { tool: "find_staff", input: { name: TYPED, person_evidence: quoted(view, TYPED) } };
    return { tool: "propose_form", input: { template_key: "dpoa", employee_name: "Remy Calder", person_evidence: quoted(view, TYPED), what_happened: account(view), incident_date: "2026-11-14", policy: "Attendance" } };
  };
}

const fixed = (id: string, title: string, run: (t: ReplayContext) => Promise<void>): ReplayCase => ({
  id,
  title,
  report: REPORT,
  status: "fixed",
  fixFlags: [FLAG],
  async run(t) {
    if (!t.loopOn?.()) return;
    start(t);
    await run(t);
  },
});

export const NOV17_AGENT_LOOP_CREATE_ACCEPTS_SETTLED_NAME_CASES: ReplayCase[] = [
  fixed("nov17-create-after-yes", `"ca for ${TYPED.toLowerCase()} she was late on 11/14", Did you mean Remy Calder?, "yes": the card for Remy Calder is created`, async (t) => {
    t.loopModel!(liveModel(() => "Was late on 11/14."));
    const thread = t.thread();
    await thread.say(`ca for ${TYPED.toLowerCase()} she was late on 11/14`);
    await thread.say("yes");
    expect(thread.proposal?.employeeName).toBe("Remy Calder");
    await expect(thread.create()).resolves.toBeTruthy();
  }),
  fixed("nov17-create-after-yes-then-typed-again", `Did you mean Remy Calder? "yes", then "${TYPED.toLowerCase()} was also on her phone at the desk" (the manager's own spelling again): the card for Remy Calder is created`, async (t) => {
    t.loopModel!(liveModel((view) => (managerTurns(view).length >= 3 ? "Was late on 11/14. Was also on her phone at the desk." : "Was late on 11/14.")));
    const thread = t.thread();
    await thread.say(`ca for ${TYPED.toLowerCase()} she was late on 11/14`);
    await thread.say("yes");
    await thread.say(`${TYPED.toLowerCase()} was also on her phone at the desk`);
    expect(thread.proposal?.employeeName).toBe("Remy Calder");
    await expect(thread.create()).resolves.toBeTruthy();
  }),
  fixed("nov17-create-after-yes-to-a-paraphrased-did-you-mean-c003", `c003's shape: "ca for ${TYPED.toLowerCase()} she was late on 11/14", the model words the recorded Did-you-mean its own way ("is this **Remy Calder** from your staff list?"), "yes": the card for Remy Calder is ready and Create makes it (it was refused as "now says the form is for ${TYPED.toLowerCase()}")`, async (t) => {
    t.loopModel!(liveModel(() => "Was late on 11/14.", true));
    const thread = t.thread();
    await thread.say(`ca for ${TYPED.toLowerCase()} she was late on 11/14`);
    await thread.say("yes");
    expect(thread.proposal?.employeeName).toBe("Remy Calder");
    await expect(thread.create()).resolves.toBeTruthy();
  }),
  fixed("nov17-create-after-yes-going-on-with-the-account", `Did you mean Remy Calder? "yes, she was also on her phone at the desk" (a yes that goes on with the account; the loop reads its first clause): the card for Remy Calder is created`, async (t) => {
    t.loopModel!(liveModel((view) => (managerTurns(view).length >= 2 ? "Was late on 11/14. Was also on her phone at the desk." : "Was late on 11/14.")));
    const thread = t.thread();
    await thread.say(`ca for ${TYPED.toLowerCase()} she was late on 11/14`);
    await thread.say("yes, she was also on her phone at the desk");
    expect(thread.proposal?.employeeName).toBe("Remy Calder");
    await expect(thread.create()).resolves.toBeTruthy();
  }),
  fixed("nov17-create-after-yes-to-a-question-after-other-words", `The reply says what it has, then asks the recorded Did-you-mean ("I have the late arrival on 11/14. Did you mean **Remy Calder**? …"), "yes": the card for Remy Calder is created`, async (t) => {
    t.loopModel!(liveModel(() => "Was late on 11/14.", "lead"));
    const thread = t.thread();
    await thread.say(`ca for ${TYPED.toLowerCase()} she was late on 11/14`);
    await thread.say("yes");
    expect(thread.proposal?.employeeName).toBe("Remy Calder");
    await expect(thread.create()).resolves.toBeTruthy();
  }),
  fixed("nov17-create-control-switched-person-refused", `Control: Did you mean Remy Calder? "yes", the card, then "actually this is for ${OTHER}, not her" (no new card): Create still refuses the Remy Calder card`, async (t) => {
    t.loopModel!(loopStandIn((view): LoopDecision => {
      if (managerTurns(view).at(-1)?.text.startsWith("actually")) return { text: `Got it, ${OTHER}. Which form?` };
      return liveDecision(() => "Was late on 11/14.")(view);
    }));
    const thread = t.thread();
    await thread.say(`ca for ${TYPED.toLowerCase()} she was late on 11/14`);
    await thread.say("yes");
    expect(thread.proposal?.employeeName).toBe("Remy Calder");
    await thread.say(`actually this is for ${OTHER}, not her`);
    await expect(thread.create(), "a card for another person than the one the manager switched to was created").rejects.toThrow(/out of date/);
  }),
];
