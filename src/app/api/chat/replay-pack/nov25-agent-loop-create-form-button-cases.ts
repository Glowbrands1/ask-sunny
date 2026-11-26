import { expect, vi } from "vitest";

import { CREATE_FORM_FROM_CONVERSATION } from "@/lib/forms/proposal-continuation";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayCase, type ReplayContext } from "./cases";
import { evidenceFrom, lastResult, loopStandIn, type LoopDecision, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * "CREATE A FORM FROM THIS CONVERSATION" PICKS THE FORM AND SHOWS ITS CARD (CREATE_FORM_BUTTON_PICKS_FORM)
 * ============================================================================
 *
 * Pau (25 Nov 2026), from a manager's live chat about an employee's transfer: the manager pressed "Create a form from this
 * conversation" three times. Sunny kept telling them to press Create draft themselves, then said no new card was made
 * because a draft was already open; it was not clear whether a card was actually there. "can we ask ai to detect what
 * form the manager needs when we press 'Create a form from this conversation'?"
 *
 * The button sends the app's own sentence, exactly as these cases send it. The stand-in answers the button as the live
 * model did ("press Create draft", no card under the reply) unless the turn's facts say the button was pressed; the code's
 * side is what is tested: the fact reaches the model, and a reply with a card on screen and none under it goes back once.
 * The person is invented (the live chat's employee is not named in this public repository).
 */

const FIX = ["CREATE_FORM_BUTTON_PICKS_FORM_ENABLED"];
const STATUS = "fixed" as const; // CREATE_FORM_BUTTON_PICKS_FORM_ENABLED is on in production (25 Nov 2026)
const REPORT = "Pau (25 Nov 2026): a manager pressed \"Create a form from this conversation\" three times; Sunny kept telling them to press Create draft themselves, then said no new card was made because a draft was already open";
const BUTTON = CREATE_FORM_FROM_CONVERSATION;
const LIVE_REPLY = "To create it, press **Create draft** on the card — I can't create the draft from a chat message.";
const ODETTE: DirectoryRow = { id: "e-odette-varnum", firstName: "Odette", lastName: "Varnum", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0309"], positionName: "Tanning Consultant" };
const ACCOUNT = "Odette Varnum yelled at a guest at the front desk on 11/24.";

const managerSaid = (view: LoopView) => view.turns.filter((turn) => turn.role === "user" && (turn.messageIds?.length ?? 0) > 0).at(-1)?.text ?? "";
const handedBack = (view: LoopView) => view.turns.at(-1)?.role === "user" && (view.turns.at(-1)?.text ?? "").startsWith("[app check]");
const buttonFact = (view: LoopView) => view.system.includes("create_form_button:");

const caCard = (view: LoopView, back: number): LoopDecision => ({
  tool: "propose_form",
  input: { template_key: "dpoa", employee_id: ODETTE.id, person_evidence: evidenceFrom(view, "Odette Varnum", back), what_happened: ACCOUNT, incident_date: "2026-11-24" },
});

/** The live model: a CA card for the first request; on the button it says "press Create draft" with no card, unless told. */
const model = loopStandIn((view): LoopDecision => {
  const made = lastResult(view, "propose_form");
  if (made) return { text: made.card ? "Here's the Corrective Action Form for **Odette Varnum** — press **Create draft** on the card to save the draft." : String(made.ask_exactly ?? made.error ?? "") };
  const said = managerSaid(view);
  if (said.trim() === BUTTON) {
    // The manager's request is the turn before the button (the card's); a hand-back's note is not a manager turn.
    if (handedBack(view)) return caCard(view, 1);
    if (buttonFact(view) && /Nothing is on their screen yet/.test(view.system)) return caCard(view, 1);
    return { text: LIVE_REPLY };
  }
  if (/what does the manual say/i.test(said)) return { text: "Yelling at a guest falls under the Standards of Conduct." };
  return caCard(view, 0);
});

function setUp(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-11-25T16:00:00Z"));
  t.directory([...STAFF, ODETTE]);
  t.as("salon_director", KEARNEY);
  t.loopModel!(model);
}

export const NOV25_AGENT_LOOP_CREATE_FORM_BUTTON_CASES: ReplayCase[] = [
  {
    id: "nov25-loop-create-form-button-card-on-screen-shows-card",
    title: `The CA card for Odette Varnum on screen, then "${BUTTON}" three times: every reply carries the card it points to (never "press Create draft" with nothing under it), and Create saves it`,
    report: REPORT,
    status: STATUS,
    fixFlags: FIX,
    async run(t) {
      if (!t.loopOn?.()) throw new Error("the loop is off");
      setUp(t);
      const thread = t.thread();
      await thread.say(`please make a ca for Odette Varnum, ${ACCOUNT}`);
      expect(thread.proposal, "no CA card for Odette Varnum (the case proves nothing)").toMatchObject({ templateKey: "dpoa", employeeName: "Odette Varnum" });
      for (const press of [1, 2, 3]) {
        const reply = await thread.say(BUTTON);
        expect(reply.formProposal, `press ${press}: the reply says to press Create draft and carries no card:\n${reply.content}`).toMatchObject({ templateKey: "dpoa", employeeName: "Odette Varnum" });
        expect(reply.content, `press ${press}: the reply`).toMatch(/Create draft/);
      }
      await expect(thread.create(), "Create on the card").resolves.toBeTruthy();
    },
  },
  {
    id: "nov25-loop-create-form-button-picks-form-from-conversation",
    title: `A policy question about Odette Varnum yelling at a guest (no form named, nothing on screen), then "${BUTTON}": the loop is told the button was pressed, picks the Corrective Action and shows its card`,
    report: REPORT,
    status: STATUS,
    fixFlags: FIX,
    async run(t) {
      if (!t.loopOn?.()) throw new Error("the loop is off");
      setUp(t);
      const thread = t.thread();
      await thread.say(`what does the manual say about this? ${ACCOUNT}`);
      expect(thread.proposal, "a card before the button (the case proves nothing)").toBeFalsy();
      const reply = await thread.say(BUTTON);
      expect(reply.formProposal, `no card after the button:\n${reply.content}`).toMatchObject({ templateKey: "dpoa", employeeName: "Odette Varnum" });
    },
  },
  {
    id: "nov25-loop-create-form-button-typed-request-unchanged",
    title: "Control: a typed \"create it\" with the card on screen is not the button: no button fact reaches the model",
    report: `${REPORT} (the condition: only the button's own sentence)`,
    status: "fixed",
    fixFlags: FIX,
    async run(t) {
      if (!t.loopOn?.()) throw new Error("the loop is off");
      setUp(t);
      const thread = t.thread();
      await thread.say(`please make a ca for Odette Varnum, ${ACCOUNT}`);
      const before = model.views.length;
      await thread.say("create it");
      expect(model.views.slice(before).some(buttonFact), "the button fact on a typed turn").toBe(false);
    },
  },
];
