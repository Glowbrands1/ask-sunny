import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";
import { evidenceFrom, lastResult, loopStandIn, type LoopDecision, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * EVERY ANSWER TO A QUESTION SUNNY ASKED IS APPLIED TO THAT FIELD (Pau, 16 Nov 2026)
 * ============================================================================
 *
 * The open question record (`card-record.ts`): each question a tool result asked (payroll, the level, which date, the
 * exit offer, any other ask_exactly) is written to the turn's trace, and the next turn is told up front
 * (answering_question) and reads the answer from the record, never from the reply's text or from where a turn sits.
 * Each case below has a paraphrased variant: the reply's own words never decide. Invented people: Remy Calder and Juno
 * Paxton are on the roster.
 */

const FLAG = "AGENT_LOOP_ENABLED";
const REPORT = "Pau, 16 Nov 2026: every answer to a question Sunny asks must be used (QA's open question record)";

const latest = (view: LoopView) => [...view.turns].reverse().find((turn) => turn.role === "user")?.text ?? "";
const managerTurns = (view: LoopView) => view.turns.filter((turn) => turn.role === "user").length;
/** The up-front fact, as the model sees it (the rules book never says this sentence). */
const asked = (view: LoopView, kind: string) => new RegExp(`answering_question: your last reply asked \\[[^\\]]*"kind":"${kind}"`).test(view.system);

type Card = { card?: { employee?: string; payroll_deduct?: string | null; warning_level?: string | null }; facts?: Record<string, unknown>; ask_exactly?: string; error?: string; reason_code?: string } | null;
type Staff = { matches?: { employee_id: string; name: string }[] } | null;

async function salon(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-11-14T22:40:00Z"));
  t.directory([...STAFF]);
  t.as("salon_director", KEARNEY);
}

/* ------------------------------------------------------------- payroll --- */

/**
 * A written CA for Remy Calder with no payroll answer: the card asks payroll (its record). The manager's bare "yes" is the
 * answer: with answering_question the stand-in passes it as payroll_evidence, and the card has payroll yes. Without the
 * fact it asks again, as the "asked again" chats did. The control: a new request instead never sets payroll.
 */
function payrollModel(paraphrase: boolean) {
  return loopStandIn((view): LoopDecision => {
    const staff = lastResult(view, "find_staff") as Staff;
    const card = lastResult(view, "propose_form") as Card;
    const said = latest(view);
    const forJuno = /juno/i.test(said);
    if (!staff) return { tool: "find_staff", input: { name: forJuno ? "Juno Paxton" : "Remy Calder" } };
    const person = staff.matches?.[0];
    if (managerTurns(view) === 1) {
      if (!card) return { tool: "propose_form", input: { template_key: "dpoa", employee_id: person?.employee_id, warning_level: "written", level_evidence: evidenceFrom(view, "written warning"), what_happened: "She was late to her shift on 11/14.", incident_date: "2026-11-14" } };
      return { text: paraphrase ? "Should I deduct anything from her payroll?" : `Here's the Corrective Action Form for **${card.card?.employee}**. Is payroll deduct applicable? Yes or no.` };
    }
    if (forJuno) {
      if (!card) return { tool: "propose_form", input: { template_key: "coaching", employee_id: person?.employee_id, what_happened: "She was late to her shift on 11/14.", incident_date: "2026-11-14" } };
      return { text: `Here's the Coaching Form for **${card.card?.employee}**.` };
    }
    if (!asked(view, "payroll")) return { text: "Is payroll deduct applicable? Yes or no." };
    if (!card) return { tool: "propose_form", input: { template_key: "dpoa", employee_id: person?.employee_id, warning_level: "written", level_evidence: evidenceFrom(view, "written warning", 1), payroll_deduct: "yes", payroll_evidence: evidenceFrom(view, said), what_happened: "She was late to her shift on 11/14.", incident_date: "2026-11-14" } };
    return { text: `Payroll deduct is set to yes on **${card.card?.employee}**'s card.` };
  });
}

export const NOV16_AGENT_LOOP_OPEN_QUESTION_CASES: ReplayCase[] = [
  ...([false, true] as const).map((paraphrase): ReplayCase => ({
    id: `nov16-open-question-payroll-answer-applied${paraphrase ? "-paraphrased-question" : ""}`,
    title: `Every answer is applied (payroll): "written warning for Remy Calder, she was late to her shift on 11/14" gives a card that asks payroll${paraphrase ? " (the reply paraphrases it: \"Should I deduct anything from her payroll?\")" : ""}; the bare "yes" is told as answering_question and sets payroll, and the question is not asked again`,
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      await salon(t);
      t.loopModel!(payrollModel(paraphrase));
      const thread = t.thread();
      await thread.say("written warning for Remy Calder, she was late to her shift on 11/14");
      expect(thread.proposal?.employeeName).toBe("Remy Calder");
      const reply = await thread.say("yes");
      expect(reply.content, "the payroll question was asked again").not.toMatch(/Is payroll deduct applicable/);
      expect((thread.proposal as { payrollDeduct?: string } | undefined)?.payrollDeduct ?? (thread.proposal as { payroll?: string } | undefined)?.payroll, "the answer was not applied").toMatch(/yes/i);
    },
  })),
  {
    id: "nov16-open-question-new-request-is-not-an-answer",
    title: "Every answer is applied, the control: after the card asks payroll, a new request (\"also a coaching for Juno Paxton, she was late to her shift on 11/14\") answers nothing: Juno's card is made, with no payroll, and Remy's question stays unanswered",
    report: `${REPORT}; QA's plan review, point 3`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      await salon(t);
      t.loopModel!(payrollModel(false));
      const thread = t.thread();
      await thread.say("written warning for Remy Calder, she was late to her shift on 11/14");
      await thread.say("also a coaching for Juno Paxton, she was late to her shift on 11/14");
      expect(thread.proposal?.employeeName).toBe("Juno Paxton");
      expect((thread.proposal as { payrollDeduct?: string | null } | undefined)?.payrollDeduct ?? null, "a new request was read as the payroll answer").toBeNull();
    },
  },
];

/* ---------------------------------------------------------- exit offer --- */

/**
 * "we're terminating Remy Calder, she no call no showed 11/12": the termination CA, and propose_form's offer_exit (a
 * recorded question). The manager's "yes" is the answer: the exit card is made with yes_to_exit_offer. The control: a
 * yes_to_exit_offer claimed after a reply that offered nothing is refused (it was accepted by turn order before).
 */
function exitModel(paraphrase: boolean) {
  return loopStandIn((view): LoopDecision => {
    const staff = lastResult(view, "find_staff") as Staff;
    const card = lastResult(view, "propose_form") as Card;
    if (!staff) return { tool: "find_staff", input: { name: "Remy Calder" } };
    const person = staff.matches?.[0];
    if (managerTurns(view) === 1) {
      if (!card) return { tool: "propose_form", input: { template_key: "dpoa", employee_id: person?.employee_id, warning_level: "termination", what_happened: "She no call no showed on 11/12.", incident_date: "2026-11-12" } };
      const offer = (card.facts?.offer_exit as { ask_exactly?: string } | undefined)?.ask_exactly;
      return { text: `Here's the Corrective Action Form for **${card.card?.employee}**.\n\n${paraphrase ? "Do you also need her exit paperwork?" : offer ?? ""}` };
    }
    if (!card) return { tool: "propose_form", input: { template_key: "stc-exit", employee_id: person?.employee_id, exit_evidence: { ...evidenceFrom(view, latest(view)), kind: "yes_to_exit_offer" } } };
    return { text: card.card ? `Here's the Employee Exit Form for **${card.card.employee}**.` : `REFUSED ${card.reason_code}` };
  });
}

NOV16_AGENT_LOOP_OPEN_QUESTION_CASES.push(
  ...([false, true] as const).map((paraphrase): ReplayCase => ({
    id: `nov16-open-question-exit-offer-yes-applied${paraphrase ? "-paraphrased-question" : ""}`,
    title: `Every answer is applied (exit offer): "we're terminating Remy Calder, she no call no showed 11/12" gives the termination card and the recorded exit offer${paraphrase ? " (paraphrased: \"Do you also need her exit paperwork?\")" : ""}; "yes" makes the Employee Exit Form for Remy Calder`,
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      await salon(t);
      t.loopModel!(exitModel(paraphrase));
      const thread = t.thread();
      const first = await thread.say("we're terminating Remy Calder, she no call no showed 11/12");
      expect(thread.proposal?.templateKey).toBe("dpoa");
      if (!paraphrase) expect(first.content).toMatch(/Want the [^*]*Exit Form for \*\*Remy Calder\*\* too\?/);
      const reply = await thread.say("yes");
      expect(reply.content, "the yes to the exit offer was refused").not.toMatch(/REFUSED/);
      expect(thread.proposal?.templateKey).toBe("stc-exit");
      expect(thread.proposal?.employeeName).toBe("Remy Calder");
    },
  })),
  {
    id: "nov16-open-question-exit-yes-without-an-offer-is-refused",
    title: "Exit offer, the control: after a coaching card that offered nothing, \"yes\" claimed as yes_to_exit_offer is refused (exit_offer_not_answered); turn order alone no longer makes it an answer",
    report: `${REPORT}; the exit offer is read from the record, not from where the turns sit`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      await salon(t);
      t.loopModel!(loopStandIn((view): LoopDecision => {
        const staff = lastResult(view, "find_staff") as Staff;
        const card = lastResult(view, "propose_form") as Card;
        if (!staff) return { tool: "find_staff", input: { name: "Remy Calder" } };
        const person = staff.matches?.[0];
        if (managerTurns(view) === 1) {
          if (!card) return { tool: "propose_form", input: { template_key: "coaching", employee_id: person?.employee_id, what_happened: "She was late to her shift on 11/14.", incident_date: "2026-11-14" } };
          return { text: `Here's the Coaching Form for **${card.card?.employee}**.` };
        }
        if (!card) return { tool: "propose_form", input: { template_key: "stc-exit", employee_id: person?.employee_id, exit_evidence: { ...evidenceFrom(view, latest(view)), kind: "yes_to_exit_offer" } } };
        return { text: card.card ? `Here's the Employee Exit Form for **${card.card.employee}**.` : `REFUSED ${card.reason_code}` };
      }));
      const thread = t.thread();
      await thread.say("coaching for Remy Calder, she was late to her shift on 11/14");
      const reply = await thread.say("yes");
      expect(reply.content, "a yes with no offer made an exit card").toMatch(/REFUSED exit_not_stated/);
      expect(thread.proposal?.templateKey ?? null).not.toBe("stc-exit");
    },
  },
);

/* ---------------------------------------------------------------- date --- */

/**
 * "written warning for Remy Calder, she was late on 11/12 and 11/13": the card asks which date (a recorded question).
 * The next card turn knows the date was asked from the record (dates_asked_before), never from the reply's words: the
 * reply-text reader /more than one date|which date goes on the form/ is gone.
 */
NOV16_AGENT_LOOP_OPEN_QUESTION_CASES.push(
  ...([false, true] as const).map((paraphrase): ReplayCase => ({
    id: `nov16-open-question-date-asked-is-recorded${paraphrase ? "-paraphrased-question" : ""}`,
    title: `Every answer is applied (date): two dates with no choice ask which${paraphrase ? " (paraphrased: \"Which of those two days should go on it?\")" : ""}; the next card turn has dates_asked_before from the record, so the date is never asked twice`,
    report: `${REPORT}; the reply-text reader at tools.ts (G16) is replaced by the record`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      await salon(t);
      const seen: Record<string, unknown>[] = [];
      t.loopModel!(loopStandIn((view): LoopDecision => {
        const staff = lastResult(view, "find_staff") as Staff;
        const card = lastResult(view, "propose_form") as Card;
        if (!staff) return { tool: "find_staff", input: { name: "Remy Calder" } };
        const person = staff.matches?.[0];
        if (!card) return { tool: "propose_form", input: { template_key: "dpoa", employee_id: person?.employee_id, what_happened: "She was late on 11/12 and 11/13." } };
        seen.push(card.facts ?? {});
        if (managerTurns(view) === 1) return { text: paraphrase ? "Which of those two days should go on it?" : "I see more than one date. Which date goes on the form?" };
        return { text: `Here's the Corrective Action Form for **${card.card?.employee}**.` };
      }));
      const thread = t.thread();
      await thread.say("written warning for Remy Calder, she was late on 11/12 and 11/13");
      expect(seen[0]?.dates_given, "two dates were not read").toBeTruthy();
      await thread.say("she has been late a lot lately");
      expect(seen[1]?.dates_asked_before, "the second card turn did not know the date was asked").toBeTruthy();
    },
  })),
);
