import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";
import { evidenceFrom, lastResult, loopStandIn, type LoopDecision, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * A RE-PROPOSE OF THE CARD ON SCREEN KEEPS ITS ACCOUNT (port of Ask Bubbles #1077, 1d211cf; its Pau's round 3, U35 T11)
 * ============================================================================
 *
 * Bubbles' tester, word for word (the mechanism ported, Sunny's roster and salon; the person invented): with the card on
 * screen showing "**Observation of Offense:** <P> received a customer complaint.", T11 "Create a Corrective Action Form
 * from this conversation." came back with the Observation gone and "What happened with the customer complaint?". The model
 * re-proposed the card with no what_happened (its history shows a card reply only as "[card shown …]") and the account is
 * read from the request's own words. Now, with this person's card on screen made with an account, a call with no account
 * goes back once (card_account_missing); a switch between the account forms (CA ↔ Coaching) carries the account; a switch
 * to the exit form does not. A card never given an account is made as before.
 */

const FLAG = "AGENT_LOOP_ENABLED";
const REPORT = "Ask Bubbles #1077 (Pau's round 3 there, U35 T11): \"Create a Corrective Action Form from this conversation.\" wiped the card's Observation and asked \"What happened with the customer complaint?\"";
const T1 = "ca for Remy Calder, she received a customer complaint";
const T2 = "Create a Corrective Action Form from this conversation.";
const COACH = "make it a coaching form instead";
const ACCOUNT = "Remy received a customer complaint.";

type Out = { card?: unknown; reason_code?: string } | null;
const said = (view: LoopView) => view.turns.filter((turn) => turn.role === "user").at(-1)?.text ?? "";
const issueOf = (proposal: unknown) => (proposal as { issue?: string | null } | null)?.issue ?? "";
const handedBack = (model: ReturnType<typeof loopStandIn>) => model.views.flatMap((view) => view.results.filter((result) => result.tool === "propose_form")).map((result) => (result.output as Out)?.reason_code).filter(Boolean);

function start(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-11-22T16:00:00Z"));
  t.directory([...STAFF]);
  t.as("salon_director", KEARNEY);
}

/** The live model: T1's card with the account; on `later` it re-proposes `form` with no account; handed back, it passes the account. */
const live = (later: string, form: string, firstAccount: boolean) =>
  loopStandIn((view): LoopDecision => {
    const out = lastResult(view, "propose_form") as Out;
    if (out?.card || (out && out.reason_code !== "card_account_missing")) return { text: "Here's the card." };
    const base = { employee_id: "e-2", person_evidence: evidenceFrom(view, "Remy Calder", said(view) === T1 ? 0 : 1) };
    if (said(view) === T1) return { tool: "propose_form", input: { ...base, template_key: "dpoa", ...(firstAccount ? { what_happened: ACCOUNT } : {}) } };
    const switching = form !== "dpoa" ? { form_change_evidence: evidenceFrom(view, later) } : {};
    return { tool: "propose_form", input: { ...base, template_key: form, ...switching, ...(out?.reason_code === "card_account_missing" ? { what_happened: ACCOUNT } : {}) } };
  });

export const NOV23_AGENT_LOOP_CARD_KEEPS_ACCOUNT_CASES: ReplayCase[] = [
  {
    id: "nov23-1077-create-from-conversation-keeps-account",
    title: `Port of Bubbles #1077: "${T2}" with Remy's CA card on screen (account "… received a customer complaint"): the call with no account goes back once, and the card keeps its Observation`,
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.() || process.env.AGENT_LOOP_LIVE === "1") return;
      start(t);
      const model = live(T2, "dpoa", true);
      t.loopModel!(model);
      const thread = t.thread();
      await thread.say(T1);
      expect(issueOf(thread.proposal), "T1's card has no account (the case proves nothing)").toMatch(/customer complaint/);
      await thread.say(T2);
      expect(issueOf(thread.proposal), "T2 wiped the card's Observation").toMatch(/customer complaint/);
      expect(handedBack(model)).toContain("card_account_missing");
    },
  },
  {
    id: "nov23-1077-switch-to-coaching-carries-account",
    title: `Port of Bubbles #1077: "${COACH}" re-proposed with no account: a switch between account forms carries the account`,
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.() || process.env.AGENT_LOOP_LIVE === "1") return;
      start(t);
      t.loopModel!(live(COACH, "coaching", true));
      const thread = t.thread();
      await thread.say(T1);
      await thread.say(COACH);
      expect(thread.proposal?.templateKey, "no coaching card (the case proves nothing)").toBe("coaching");
      expect(issueOf(thread.proposal), "the switch dropped the account").toMatch(/customer complaint/);
    },
  },
  {
    id: "nov23-1077-control-no-account-ever",
    title: `Control: no account given anywhere, "${T2}": the card is made with no Observation, never handed back, never an invented one`,
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.() || process.env.AGENT_LOOP_LIVE === "1") return;
      start(t);
      const model = live(T2, "dpoa", false);
      t.loopModel!(model);
      const thread = t.thread();
      await thread.say(T1);
      await thread.say(T2);
      expect(handedBack(model)).not.toContain("card_account_missing");
      expect(issueOf(thread.proposal) === ACCOUNT, "an Observation nobody passed").toBe(false);
    },
  },
  {
    id: "nov23-1077-control-switch-to-exit-not-carried",
    title: "Control: a switch to the exit form is never handed back for the CA's account (an exit's account is how and when they left)",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.() || process.env.AGENT_LOOP_LIVE === "1") return;
      start(t);
      const model = live("make it an exit form instead", "stc-exit", true);
      t.loopModel!(model);
      const thread = t.thread();
      await thread.say(T1);
      await thread.say("make it an exit form instead");
      expect(handedBack(model)).not.toContain("card_account_missing");
    },
  },
];
