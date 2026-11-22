import { expect, vi } from "vitest";

import { KEARNEY, STAFF, TWO_SALONS, type DirectoryRow, type ReplayCase, type ReplayContext } from "./cases";
import { evidenceFrom, headingWith, lastResult, loopStandIn, type LoopDecision, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * A CARD COMES ONLY FROM propose_form: NO TOOL, NO CARD LINES (port of Ask Bubbles #1038: its QA's live re-run 2, 22 Nov 2026, "saved ≠ card")
 * ============================================================================
 *
 * Found in Ask Bubbles, the same code in Sunny. The tester, word for word (invented people, this pack's salons): U21 T4 "jba woven policys were acknowledged on 5/26/26", T5 "payroll is not
 * deductable", T6 "verbal warning", T12 (a previous-coaching account with
 * its dates); U23 T5 "Multiple times she has talked about her boyfriend …", T6 "She will also follow customers …".
 * On Ask Bubbles' production each of those turns called NO tool (the loop's trace: steps []), and the reply was written in card
 * form: "**Prior actions:** …; JBA Woven policies acknowledged — 05/26/2026, as you said.", "**Is payroll deduct
 * applicable?** No, as you said.", "**Type of Warning:** Verbal Warning, as you said.", "**Observation of Offense:** …
 * Multiple times …". The card under it never changed, so Create saved the card without them (saved = card held; the
 * reply did not). Three of those replies ended "[app note: this reply showed a card built with propose_form]": the note
 * the loop appends to earlier card replies in the model's history, copied by the model and shown to the manager.
 *
 * Root causes: (1) the history showed earlier card replies in full, with that note, so the model imitated a card reply
 * without the tool; (2) the reply check compared a no-tool reply only with the last reply's card, and after one faked
 * reply there was none, so nothing was checked; (3) the note was never stripped from what the manager sees.
 * Mechanism (`agent-loop/card-lines.ts`): the model's history shows a card reply's card lines as "[card shown: <form>]";
 * the rules book says a card comes only from propose_form; on a turn with no card call, a reply line under one of the
 * card's own labels goes back once ("call propose_form with the manager's new facts"), and is left out if it comes back;
 * the app note is never shown.
 */

const REPORT = "Ask Bubbles' live re-run 2 (22 Nov 2026, U21/U23/U35 \"saved ≠ card\"; port of #1038): turns that stated a fact called no tool and replied in card form \"… as you said\"; the card and the saved draft never had it, and \"[app note: …]\" reached the manager";
const MARISOL: DirectoryRow = { id: "e-marisol-quint", firstName: "Marisol", lastName: "Quint", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0309"], positionName: "Tanning Consultant" };
const DELPHINE: DirectoryRow = { id: "e-delphine-arbuckle", firstName: "Delphine", lastName: "Arbuckle", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0309"], positionName: "Tanning Consultant" };

const U21 = {
  T1: "corrective action",
  T2: "marisol quint",
  T3: "This is what happened: She has recieved coaching on 9/22 for cleaning tasks not being completed. What was observed this weekend is that trash liners were not put into the trash cans after collecting trash, laundry was not done",
  T4: "jba woven policys were acknowledged on 5/26/26",
  T5: "payroll is not deductable",
  T6: "verbal warning",
};
const ACCOUNT = "Marisol was observed this weekend not putting trash liners into the trash cans after collecting trash, and laundry was not done.";
const NOTE = "[app note: this reply showed a card built with propose_form]";
/** The live replies (production, names invented): card form, no card. */
const LIVE: Record<string, string> = {
  [U21.T4]: `Here's the updated Corrective Action Form for **Marisol**.\n\n**Observation of Offense:** ${ACCOUNT}\n\n**Prior actions:** Coaching — 09/22/2026 (cleaning tasks not being completed); JBA Woven policies acknowledged — 05/26/2026, as you said.\n\n**Policy:** Standards of Conduct Policy, JBA Policy Manual p.12\n\nPayroll deduct and warning level aren't set; tell me if they apply.\n\n${NOTE}`,
  [U21.T5]: `Here's the updated Corrective Action Form for **Marisol**.\n\n**Observation of Offense:** ${ACCOUNT}\n\n**Is payroll deduct applicable?** No, as you said.\n\nWarning level isn't set; tell me if it applies.\n\n${NOTE}`,
  [U21.T6]: `Here's the updated Corrective Action Form for **Marisol**.\n\n**Observation of Offense:** ${ACCOUNT}\n\n**Type of Warning:** Verbal Warning, as you said.\n\n**Is payroll deduct applicable?** No, as you said.\n\nThe card above is still open; press Create when it looks right, or tell me what to change.`,
};

const said = (view: LoopView) => view.turns.filter((turn) => turn.role === "user" && (turn.messageIds?.length ?? 0) > 0).at(-1)?.text ?? "";
const handedBack = (view: LoopView) => view.turns.some((turn) => /^\[app check\]/.test(turn.text) && /No card was proposed this turn/.test(turn.text));
const back = (view: LoopView, text: string) => {
  const asks = view.turns.filter((turn) => turn.role === "user" && (turn.messageIds?.length ?? 0) > 0);
  return Math.max(0, asks.length - 1 - asks.findIndex((turn) => turn.text === text));
};

/** U21's live model: a card at T2/T3; T4–T6 no tool and the live card-form reply, until handed back (`fixes`: then propose_form with the fact). */
const u21 = (fixes: boolean) =>
  loopStandIn((view): LoopDecision => {
    const message = said(view);
    const result = lastResult(view, "propose_form");
    if (result) return { text: `Here's the Corrective Action Form for **Marisol**.` };
    if (message === U21.T1) return { text: "Who is this Corrective Action Form for, and what happened?" };
    const stated = [U21.T5, U21.T6].indexOf(message) >= 0 || message === U21.T4;
    if (stated && !(fixes && handedBack(view))) return { text: LIVE[message]! };
    const base = { template_key: "dpoa", employee_id: MARISOL.id, policy: headingWith(view, /standards of conduct/i), person_evidence: evidenceFrom(view, "marisol quint", back(view, U21.T2)) };
    const seen = (text: string) => view.turns.some((turn) => turn.role === "user" && turn.text === text);
    return {
      tool: "propose_form",
      input: {
        ...base,
        ...(message === U21.T2 ? {} : { what_happened: ACCOUNT }),
        ...(seen(U21.T5) ? { payroll_deduct: "no", payroll_evidence: evidenceFrom(view, U21.T5, back(view, U21.T5)) } : {}),
        ...(seen(U21.T6) ? { warning_level: "verbal", level_evidence: evidenceFrom(view, U21.T6, back(view, U21.T6)) } : {}),
      },
    };
  });

/* Stand-ins replay the live model's replies: they prove the loop's checks, so they do not run against the live model. */
function start(t: ReplayContext, rows: readonly DirectoryRow[], scope: unknown): boolean {
  if (!t.loopOn?.() || process.env.AGENT_LOOP_LIVE === "1") return false;
  vi.setSystemTime(new Date("2026-11-21T18:00:00Z"));
  t.directory([...STAFF, ...rows]);
  t.as("salon_director", scope);
  return true;
}

const U23 = {
  T1: "i need to create a corrective action for Delphine Arbuckle",
  T2: "She has unprofessional conversations with guests and staff. I have already had a conversation with her about this.",
  T3: "this is going to be a written warning.",
  T5: "Multiple times she has talked about her boyfriend or ex boyfriend with customers, she has stated that she takes medication for different things to customers, even stating that she was sick. Today, while checking out a customer, she asked another employee what they would do if they had 8 arms and 8 legs. I could tell the customer was very uncomfortable.",
};
const U23_FIRST = "Delphine has unprofessional conversations with guests and staff.";
const U23_EXAMPLES = "Multiple times Delphine has talked about a boyfriend or ex-boyfriend with customers, and has told customers about medication Delphine takes.";

export const NOV22_AGENT_LOOP_NO_FAKED_CARD_REPLY_CASES: ReplayCase[] = [
  {
    id: "nov22-saved-card-u21-no-tool-card-reply-handed-back",
    title: "U21 (saved ≠ card): T5 \"payroll is not deductable\" and T6 \"verbal warning\" with no tool and a card-form reply (\"… No, as you said\", \"Verbal Warning, as you said\") — handed back; the card is proposed with them, and Create saves Verbal and payroll No",
    report: REPORT,
    status: "fixed",
    fixFlags: ["AGENT_LOOP_ENABLED"],
    async run(t) {
      if (!start(t, [MARISOL], TWO_SALONS)) return;
      const model = u21(true);
      t.loopModel!(model);
      const thread = t.thread();
      for (const turn of [U21.T1, U21.T2, U21.T3, U21.T4]) await thread.say(turn);
      const views = model.views.length;
      await thread.say(U21.T5);
      expect(model.views.slice(views).some(handedBack), "T5's card-form reply with no card was never handed back").toBe(true);
      const sixth = await thread.say(U21.T6);
      expect(sixth.content).not.toMatch(/\[app note/);
      const card = thread.proposal as { warningLevel?: string | null; payrollDeduct?: string | null } | null;
      expect(card?.payrollDeduct, "payroll No never reached the card").toBe("no");
      expect(card?.warningLevel, "Verbal never reached the card").toBe("verbal");
      const id = await thread.create();
      expect(t.checked(id).warning_type ?? [], "the saved draft has no Verbal Warning").toEqual(["verbal"]);
      expect(t.checked(id).payroll_deduct ?? [], "the saved draft has no payroll No").toEqual(["no"]);
    },
  },
  {
    id: "nov22-saved-card-u21-card-lines-repeated-left-out",
    title: "U21 (saved ≠ card): the model repeating its card-form reply with no tool after the hand-back — the card lines and the app note are left out; the reply never claims what the card does not hold",
    report: REPORT,
    status: "fixed",
    fixFlags: ["AGENT_LOOP_ENABLED"],
    async run(t) {
      if (!start(t, [MARISOL], TWO_SALONS)) return;
      t.loopModel!(u21(false));
      const thread = t.thread();
      for (const turn of [U21.T1, U21.T2, U21.T3, U21.T4]) await thread.say(turn);
      const fifth = await thread.say(U21.T5);
      expect(fifth.content, `the reply still claims payroll on a card that does not hold it:\n${fifth.content}`).not.toMatch(/No, as you said/);
      expect(fifth.content, `the app note reached the manager:\n${fifth.content}`).not.toMatch(/\[app note/);
      const sixth = await thread.say(U21.T6);
      expect(sixth.content, `T6 (after a faked T5) was not checked:\n${sixth.content}`).not.toMatch(/Verbal Warning, as you said/);
    },
  },
  {
    id: "nov22-saved-card-app-note-never-shown",
    title: "The loop's own \"[app note: this reply showed a card built with propose_form]\" is never shown to the manager, even on a reply with a real card",
    report: REPORT,
    status: "fixed",
    fixFlags: ["AGENT_LOOP_ENABLED"],
    async run(t) {
      if (!start(t, [MARISOL], TWO_SALONS)) return;
      t.loopModel!(
        loopStandIn((view): LoopDecision => {
          if (lastResult(view, "propose_form")) return { text: `Here's the Corrective Action Form for **Marisol**.\n\n${NOTE}` };
          return { tool: "propose_form", input: { template_key: "dpoa", employee_id: MARISOL.id, what_happened: ACCOUNT, policy: headingWith(view, /standards of conduct/i), person_evidence: evidenceFrom(view, "Marisol Quint") } };
        }),
      );
      const reply = await t.thread().say(`ca for Marisol Quint, ${U21.T3}`);
      expect(reply.content).not.toMatch(/\[app note/);
      expect(reply.content).toMatch(/Corrective Action Form for \*\*Marisol/);
    },
  },
  {
    id: "nov22-saved-card-u23-examples-no-tool-handed-back",
    title: "U23 (saved ≠ card): T5's examples with no tool and an Observation written in the reply — handed back; the card is proposed with the examples, so Create saves them",
    report: REPORT,
    status: "fixed",
    fixFlags: ["AGENT_LOOP_ENABLED"],
    async run(t) {
      if (!start(t, [DELPHINE], KEARNEY)) return;
      const model = loopStandIn((view): LoopDecision => {
        const message = said(view);
        if (lastResult(view, "propose_form")) return { text: "Here's the Corrective Action Form for **Delphine**." };
        if (message === U23.T5 && !handedBack(view)) return { text: `Here's the Corrective Action Form for **Delphine**.\n\n**Observation of Offense:** ${U23_FIRST} ${U23_EXAMPLES}\n\n**Type of Warning:** Written Warning, as you said.` };
        const seen = (text: string) => view.turns.some((turn) => turn.role === "user" && turn.text === text);
        return {
          tool: "propose_form",
          input: {
            template_key: "dpoa", employee_id: DELPHINE.id, policy: headingWith(view, /standards of conduct/i),
            person_evidence: evidenceFrom(view, "Delphine Arbuckle", back(view, U23.T1)),
            ...(message === U23.T1 ? {} : { what_happened: seen(U23.T5) ? `${U23_FIRST} ${U23_EXAMPLES}` : U23_FIRST }),
            ...(seen(U23.T3) ? { warning_level: "written", level_evidence: evidenceFrom(view, U23.T3, back(view, U23.T3)) } : {}),
          },
        };
      });
      t.loopModel!(model);
      const thread = t.thread();
      for (const turn of [U23.T1, U23.T2, U23.T3]) await thread.say(turn);
      const views = model.views.length;
      await thread.say(U23.T5);
      expect(model.views.slice(views).some(handedBack), "the examples written into the reply with no card were never handed back").toBe(true);
      expect((thread.proposal as { issue?: string | null } | null)?.issue ?? "", "the examples never reached the card").toMatch(/Multiple times/);
    },
  },
];
