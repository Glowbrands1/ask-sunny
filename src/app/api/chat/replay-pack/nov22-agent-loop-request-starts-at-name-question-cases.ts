import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayCase, type ReplayContext } from "./cases";
import { evidenceFrom, headingWith, lastResult, loopStandIn, type LoopDecision, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * A "DID YOU MEAN" FOR THIS FORM STARTS THE REQUEST; PAYROLL MAY COME FROM ANY TURN OF IT (port of Ask Bubbles #1043, U35(ii))
 * ============================================================================
 *
 * Found in Ask Bubbles (its QA's live re-run 2, 22 Nov 2026), the same code in Sunny. The tester, word for word (an assistant
 * manager; the person invented here, a two-word surname, on no directory but this case's): T2 "i have an employee, <P>
 * that needs a corrective action form with a customer complaint" (the surname mistyped), T3 "verbal warning, no payroll
 * deduct, part-time team member,", T4 "fix her last name <surname>", T10 "can i review the card", T11 "Create a Corrective
 * Action Form from this conversation.", T12 "it was a customer complaint about the experience with <P>". T2 got
 * propose_form's own "Did you mean <P>?"; the last card had no level and no payroll.
 *
 * Sunny's own live set (QA, 22 Nov 2026, #1234's runs; the same gap on main): in Sunny's u35 chat the model called
 * propose_form again at T11 with payroll_deduct "no" quoted from T3, and the server refused it (payroll_not_stated,
 * evidence_after_card), so the card lost the payroll answer. Payroll was accepted from the request's first turn only.
 *
 * Mechanism: propose_form's name question records the form it was making and marks that form's request start for the
 * person it offered; a walk that stops at a form request naming nobody runs from this card's earlier request-start record;
 * payroll may be quoted from any turn of THIS request, as the level. Controls: a turn before the request, another person's
 * turn, and "make this for <B> instead of <A>" stay refused.
 */

const FLAG = "AGENT_LOOP_ENABLED";
const REPORT = "QA's live sets (22 Nov 2026, U35(ii); found in Ask Bubbles, then in Sunny's #1234 runs): T3 \"verbal warning, no payroll deduct, …\" was refused at a later card (evidence_after_card), and the card lost its payroll answer";
const OTTILIE: DirectoryRow = { id: "e-ottilie-castell-duvane", firstName: "Ottilie", lastName: "Castell Duvane", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0309"], positionName: "Tanning Consultant" };
const GLOBAL = { level: "global", primaryAreaId: null, alsoCoversAreaIds: [] };
const T = {
  T2: "i have an employee, Ottilie Castell Duvnae that needs a corrective action form with a customer complaint",
  T3: "verbal warning, no payroll deduct, part-time team member,",
  T4: "fix her last name duvane",
  T10: "can i review the card",
  T11: "Create a Corrective Action Form from this conversation.",
  T12: "it was a customer complaint about the experience with Ottilie",
};

const said = (view: LoopView) => view.turns.filter((turn) => turn.role === "user" && (turn.messageIds?.length ?? 0) > 0).at(-1)?.text ?? "";
const back = (view: LoopView, text: string) => {
  const asks = view.turns.filter((turn) => turn.role === "user" && (turn.messageIds?.length ?? 0) > 0);
  return Math.max(0, asks.length - 1 - asks.findIndex((turn) => turn.text === text));
};
const payrollOf = (proposal: unknown) => (proposal as { payrollDeduct?: string | null } | null)?.payrollDeduct ?? null;

const loopCase = (id: string, title: string, run: (t: ReplayContext) => Promise<void>): ReplayCase => ({
  id,
  title,
  report: REPORT,
  status: "fixed",
  fixFlags: [FLAG],
  async run(t) {
    if (!t.loopOn?.() || process.env.AGENT_LOOP_LIVE === "1") return;
    vi.setSystemTime(new Date("2026-11-22T10:00:00Z"));
    await run(t);
  },
});

/** The live model: propose_form with the level and payroll quoted from T3 on every card turn; the app's own question is said as given. */
const live = () =>
  loopStandIn((view): LoopDecision => {
    const message = said(view);
    const result = lastResult(view, "propose_form") as { ask_exactly?: string } | null;
    if (result) return { text: result.ask_exactly ?? "Here's the Corrective Action Form for **Ottilie**." };
    if (message === T.T10) return { text: "Here is the card as it stands." };
    return {
      tool: "propose_form",
      input: {
        template_key: "dpoa", employee_id: OTTILIE.id, policy: headingWith(view, /standards of conduct/i),
        person_evidence: evidenceFrom(view, message === T.T4 ? "duvane" : "Ottilie", message === T.T11 ? back(view, T.T2) : 0),
        what_happened: "A customer complained about the experience with Ottilie.",
        ...(message === T.T2 ? {} : {
          warning_level: "verbal", level_evidence: evidenceFrom(view, "verbal warning", back(view, T.T3)),
          payroll_deduct: "no", payroll_evidence: evidenceFrom(view, "no payroll deduct", back(view, T.T3)),
        }),
      },
    };
  });

const keepsLevelAndPayroll = (role: "salon_director" | "admin") => async (t: ReplayContext) => {
  t.directory([...STAFF, OTTILIE]);
  t.as(role, role === "admin" ? GLOBAL : KEARNEY);
  t.loopModel!(live());
  const thread = t.thread();
  for (const turn of [T.T2, T.T3, T.T4, T.T10, T.T11, T.T12]) await thread.say(turn);
  expect(thread.proposal?.employeeName, "the case proves nothing: T12 made no card for the person").toBe("Ottilie Castell Duvane");
  expect((thread.proposal as { warningLevel?: string | null } | null)?.warningLevel, "T3's \"verbal warning\" was refused at the last card").toBe("verbal");
  expect(payrollOf(thread.proposal), "T3's \"no payroll deduct\" was refused at the last card").toBe("no");
  const id = await thread.create();
  expect(t.checked(id).warning_type ?? [], "the saved draft has no Verbal Warning").toEqual(["verbal"]);
  expect(t.checked(id).payroll_deduct ?? [], "the saved draft has no payroll No").toEqual(["no"]);
};

/** A control's model: a card for `person` each turn but `payrollTurn`, payroll quoted from `payrollTurn`. */
const quoting = (person: DirectoryRow, payrollTurn: string) =>
  loopStandIn((view): LoopDecision => {
    if (lastResult(view, "propose_form")) return { text: `Here's the Corrective Action Form for **${person.firstName}**.` };
    const message = said(view);
    if (message === payrollTurn) return { text: "Noted." };
    return {
      tool: "propose_form",
      input: {
        template_key: "dpoa", employee_id: person.id, policy: headingWith(view, /standards of conduct/i),
        person_evidence: evidenceFrom(view, person.firstName), what_happened: `${person.firstName} was late on 11/20.`,
        payroll_deduct: "no", payroll_evidence: evidenceFrom(view, payrollTurn, back(view, payrollTurn)),
      },
    };
  });

export const NOV22_AGENT_LOOP_REQUEST_STARTS_AT_NAME_QUESTION_CASES: ReplayCase[] = [
  loopCase(
    "nov22-u35ii-sunny-live-re-propose-keeps-t3-payroll",
    "U35 (ii), Sunny's live set on #1234: T2 \"i have an employee, Remy Calder …\", T3 \"verbal warning, no payroll deduct, …\", T10 \"can i review the card\" (no card), T11 \"Create a Corrective Action Form from this conversation.\" with the model proposing again (its own words for the account), payroll quoted from T3: the card keeps payroll No and Create saves it",
    async (t) => {
      const T2 = "i have an employee, Remy Calder that needs a corrective action form with a customer complaint";
      t.directory([...STAFF]);
      t.as("salon_director", KEARNEY);
      t.loopModel!(loopStandIn((view): LoopDecision => {
        const message = said(view);
        if (message === T.T10) return { text: "Here is the card as it stands." };
        if (lastResult(view, "propose_form")) return { text: "Here's the Corrective Action Form for **Remy**." };
        const card = { template_key: "dpoa", employee_id: "e-2", what_happened: "A customer complained about the experience with Remy.", incident_date: "2026-11-20", policy: headingWith(view, /standards of conduct/i), person_evidence: evidenceFrom(view, "Remy Calder", back(view, T2)) };
        if (message === T2) return { tool: "propose_form", input: card };
        /* The live model's T11 card words the same complaint its own way, so the account key no longer matches T3's card and nothing carries it. */
        const account = message === T.T11 ? { what_happened: "A customer filed a complaint about Remy's service." } : {};
        return { tool: "propose_form", input: { ...card, ...account, warning_level: "verbal", level_evidence: evidenceFrom(view, "verbal warning", back(view, T.T3)), payroll_deduct: "no", payroll_evidence: evidenceFrom(view, "no payroll deduct", back(view, T.T3)) } };
      }));
      const thread = t.thread();
      await thread.say(T2);
      await thread.say(T.T3);
      expect(payrollOf(thread.proposal), "T3's card has no payroll No (the case proves nothing)").toBe("no");
      await thread.say(T.T10);
      await thread.say(T.T11);
      expect((thread.proposal as { warningLevel?: string | null } | null)?.warningLevel, "the level was lost at T11").toBe("verbal");
      expect(payrollOf(thread.proposal), "T3's \"no payroll deduct\" was refused at T11 (evidence_after_card)").toBe("no");
      const id = await thread.create();
      expect(t.checked(id).payroll_deduct ?? [], "the saved form has no payroll answer").toEqual(["no"]);
    },
  ),
  loopCase(
    "nov22-u35ii-level-after-did-you-mean-kept-salon-director",
    "U35 (ii): T2 \"… Ottilie Castell Duvnae that needs a corrective action form …\" got \"Did you mean\"; T3 \"verbal warning, no payroll deduct, …\" — the last card (T12) keeps Verbal and payroll No, and Create saves both (salon director)",
    keepsLevelAndPayroll("salon_director"),
  ),
  loopCase("nov22-u35ii-level-after-did-you-mean-kept-admin", "U35 (ii), an admin (global) login: the same turns — the last card keeps Verbal and payroll No, and Create saves both", keepsLevelAndPayroll("admin")),
  loopCase(
    "nov22-u35ii-control-payroll-before-request-refused",
    "U35 (ii), control: \"payroll is not deductable\" said BEFORE the request (\"corrective action for Ottilie Castell Duvane, she was late on 11/20\") is not this card's payroll",
    async (t) => {
      t.directory([...STAFF, OTTILIE]);
      t.as("salon_director", KEARNEY);
      t.loopModel!(quoting(OTTILIE, "payroll is not deductable"));
      const thread = t.thread();
      await thread.say("payroll is not deductable");
      await thread.say("corrective action for Ottilie Castell Duvane, she was late on 11/20");
      expect(thread.proposal?.employeeName).toBe("Ottilie Castell Duvane");
      expect(payrollOf(thread.proposal), "a payroll answer from before the request was carried").toBeNull();
    },
  ),
  loopCase(
    "nov22-u35ii-control-payroll-other-persons-turn-refused",
    "U35 (ii), control: inside the request, a turn about ANOTHER person (\"no payroll deduct for Rowan Kestrel\") is not this card's payroll",
    async (t) => {
      t.directory([...STAFF, OTTILIE]);
      t.as("salon_director", KEARNEY);
      t.loopModel!(quoting(OTTILIE, "no payroll deduct for Rowan Kestrel"));
      const thread = t.thread();
      await thread.say("corrective action for Ottilie Castell Duvane, she was late on 11/20");
      await thread.say("no payroll deduct for Rowan Kestrel");
      await thread.say("verbal warning for Ottilie");
      expect(thread.proposal?.employeeName).toBe("Ottilie Castell Duvane");
      expect(payrollOf(thread.proposal), "another person's payroll answer was carried").toBeNull();
    },
  ),
  loopCase(
    "nov22-u35ii-control-payroll-never-carries-to-this-card-for",
    "U35 (ii), control (U21's ruling): \"make this for <B> instead of <A>\" never carries A's \"payroll is not deductable\" to B's card",
    async (t) => {
      const remy = STAFF.find((row) => row.id === "e-2")!;
      const rowan = STAFF.find((row) => row.id === "e-4")!;
      t.directory([...STAFF]);
      t.as("salon_director", KEARNEY);
      const A = "corrective action for Remy Calder, she was late on 11/20";
      const PAY = "payroll is not deductable";
      const SWITCH = "make this for Rowan instead of Remy";
      t.loopModel!(
        loopStandIn((view): LoopDecision => {
          if (lastResult(view, "propose_form")) return { text: "Here's the Corrective Action Form." };
          const message = said(view);
          const person = message === SWITCH ? rowan : remy;
          return {
            tool: "propose_form",
            input: {
              template_key: "dpoa", employee_id: person.id, policy: headingWith(view, /standards of conduct/i),
              person_evidence: evidenceFrom(view, person.firstName), what_happened: `${person.firstName} was late on 11/20.`,
              ...(message === A ? {} : { payroll_deduct: "no", payroll_evidence: evidenceFrom(view, PAY, back(view, PAY)) }),
              ...(message === SWITCH ? { same_card_evidence: { ...evidenceFrom(view, SWITCH), kind: "this_card_for" } } : {}),
            },
          };
        }),
      );
      const thread = t.thread();
      await thread.say(A);
      await thread.say(PAY);
      expect(payrollOf(thread.proposal), "the case proves nothing: A's card has no payroll No").toBe("no");
      await thread.say(SWITCH);
      expect(thread.proposal?.employeeName).toBe("Rowan Kestrel");
      expect(payrollOf(thread.proposal), "A's payroll carried to B's card").toBeNull();
    },
  ),
];
