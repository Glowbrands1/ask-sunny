import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";
import { evidenceFrom, lastResult, loopStandIn, type LoopDecision, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * A NAME THE MANAGER TYPED IS TAKEN; A SETTLED NAME STAYS SETTLED (QA, 16 Nov 2026)
 * ============================================================================
 *
 * The 266 re-run on the launch train (b8029962), against the same chats this morning (b155c737), in each chat's shape
 * with invented people (Remy Calder is on the roster; "Odessa Vantreight", "Quillon Ashgrove" / "Quillon Ashbrove" and
 * "remi" are nobody on it, and "remi" is a close spelling of Remy Calder):
 * - c220: "TC <P>" typed back as the answer got "Reply **use TC <P>**" although the card already held <P>.
 * - c224: an off-roster exit card's name respelled by the manager ("Exit form. Tanning Consultant, <P2>") was refused
 *   with "Reply **use <P2>**".
 * - c022: "keep <P>" settled the name on turn 2; turns 3 and 4 got the same Did-you-mean again and the reply gave up
 *   ("the name lookup kept stopping it", tick the fields yourself).
 * General rules: a job title beside a name is not part of it (the company's titles, from the app config); a full name
 * the manager typed that is a close spelling of nobody on the roster is taken as typed; a name settled once in the chat
 * (kept as typed, or already on the off-roster card) is never asked about again; a close spelling still gets the
 * Did-you-mean, and that refusal carries ask_exactly, so a repeated one ends on the question, never on a give-up.
 */

const FLAG = "AGENT_LOOP_ENABLED";
const REPORT = "QA's 266 re-run on the launch train b8029962 (16 Nov 2026), from the Runner's masked turns";

type Result = { card?: { employee?: string; payroll_deduct?: string | null; warning_level?: string | null }; ask_exactly?: string; reason_code?: string; not_on_roster?: string; kept_as_typed?: string; note?: string; error?: string } | null;

const managerTurns = (view: LoopView) => view.turns.filter((turn) => turn.role === "user").length;
const latest = (view: LoopView) => [...view.turns].reverse().find((turn) => turn.role === "user")?.text ?? "";

async function salon(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-11-14T22:40:00Z"));
  t.directory([...STAFF]);
  t.as("salon_director", KEARNEY);
}

/** Asks only what a tool told it to ask; otherwise makes or keeps the card. */
/** The last card result this turn's stand-in saw (its facts carry off_roster_name when the name is not on the staff list). */
const lastCardFacts = (views: readonly LoopView[]) =>
  (views.flatMap((view) => view.results).filter((result) => result.tool === "propose_form" && (result.output as { card?: unknown }).card).at(-1)?.output as { facts?: { off_roster_name?: string } } | undefined)?.facts;

const said = (result: Result, card: Result) => result?.ask_exactly ?? (card?.card ? `Here's the card for **${card.card.employee}**.` : `REFUSED ${card?.reason_code ?? result?.reason_code ?? ""}`);

export const NOV16_AGENT_LOOP_TYPED_NAME_TAKEN_CASES: ReplayCase[] = [
  {
    id: "nov16-typed-name-c220-title-prefix-answer-is-the-card-person",
    title: "c220: \"I need a verbal warning for TC Odessa Vantreight …\" makes her card (not on the staff list); the bare answer \"TC Odessa Vantreight\" is her, as typed: no \"Reply use TC Odessa Vantreight\"",
    report: `${REPORT}: c220`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      await salon(t);
      const c220 = loopStandIn((view): LoopDecision => {
        const card = lastResult(view, "propose_form") as Result;
        if (managerTurns(view) === 1) {
          if (!card) return { tool: "propose_form", input: { template_key: "dpoa", employee_name: "Odessa Vantreight", person_evidence: evidenceFrom(view, "TC Odessa Vantreight"), what_happened: "She refused to clean the restroom.", incident_date: "2026-11-05" } };
          return { text: said(null, card) };
        }
        // c220's model: the title passed along with the name.
        const staff = lastResult(view, "find_staff") as Result;
        if (!staff) return { tool: "find_staff", input: { name: "TC Odessa Vantreight", person_evidence: evidenceFrom(view, "TC Odessa Vantreight") } };
        if (staff.ask_exactly) return { text: staff.ask_exactly };
        if (!card) return { tool: "propose_form", input: { template_key: "dpoa", employee_name: "TC Odessa Vantreight", person_evidence: evidenceFrom(view, "TC Odessa Vantreight"), what_happened: "She refused to clean the restroom.", incident_date: "2026-11-05" } };
        return { text: said(staff, card) };
      });
      t.loopModel!(c220);
      const thread = t.thread();
      await thread.say("I need a verbal warning for TC Odessa Vantreight. For insubordination on 11/5/2026.");
      expect(thread.proposal?.employeeName).toBe("Odessa Vantreight");
      const reply = await thread.say("TC Odessa Vantreight");
      expect(reply.content, "the name already on the card was offered as \"use TC …\"").not.toMatch(/Reply \*\*use/);
      expect(thread.proposal?.employeeName, "the title went onto the card's name").toBe("Odessa Vantreight");
      // Pau's s10 ruling (QA, 16 Nov 2026): a name taken as typed that is not on the staff list is said so on the card.
      expect(lastCardFacts(c220.views)?.off_roster_name, "the card does not say the name is not on the staff list").toBe("Odessa Vantreight");
    },
  },
  {
    id: "nov16-typed-name-c224-respelled-full-name-is-taken",
    title: "c224: an exit card for \"Quillon Ashgrove\" (not on the staff list); \"Exit form. Tanning Consultant, Quillon Ashbrove\" respells it: the card is for Quillon Ashbrove, as typed, with no \"Reply use\"",
    report: `${REPORT}: c224`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      await salon(t);
      const c224 = loopStandIn((view): LoopDecision => {
        const card = lastResult(view, "propose_form") as Result;
        const first = managerTurns(view) === 1;
        if (!card) {
          return {
            tool: "propose_form",
            input: {
              template_key: "stc-exit",
              employee_name: first ? "Quillon Ashgrove" : "Quillon Ashbrove",
              person_evidence: evidenceFrom(view, first ? "Quillon Ashgrove" : "Quillon Ashbrove"),
              exit_evidence: { ...evidenceFrom(view, "I need a exit for for Quillon Ashgrove TC", first ? 0 : 1), kind: "asks_for_exit_form" },
              ...(first ? {} : { request_evidence: [evidenceFrom(view, "I need a exit for for Quillon Ashgrove TC", 1)] }),
              what_happened: "Quit without notice.",
            },
          };
        }
        return { text: said(null, card) };
      });
      t.loopModel!(c224);
      const thread = t.thread();
      await thread.say("I need a exit for for Quillon Ashgrove TC. Quit without notice. not fulfilling a 2 weeks notice. store items were returned.");
      expect(thread.proposal?.employeeName).toBe("Quillon Ashgrove");
      const reply = await thread.say("Exit form. Tanning Consultant, Quillon Ashbrove");
      expect(reply.content, "the manager's own respelling was refused").not.toMatch(/Reply \*\*use|REFUSED/);
      expect(thread.proposal?.employeeName).toBe("Quillon Ashbrove");
      expect(thread.proposal?.templateKey).toBe("stc-exit");
      // Pau's s10 ruling (QA, 16 Nov 2026): the respelled name is not on the staff list, and the card says so.
      expect(lastCardFacts(c224.views)?.off_roster_name, "the card does not say the name is not on the staff list").toBe("Quillon Ashbrove");
    },
  },
  {
    id: "nov16-typed-name-c022-kept-name-stays-settled-no-give-up",
    title: "c022: \"can you create me a ca form for remi\" asks Did you mean **Remy Calder**?; \"keep remi\" makes the card; \"payroll is deductable\" and \"she was caught vaping, given verbal warning\" update that card, never the Did-you-mean again and never a give-up",
    report: `${REPORT}: c022`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      await salon(t);
      t.loopModel!(loopStandIn((view): LoopDecision => {
        const card = lastResult(view, "propose_form") as Result;
        const turn = managerTurns(view);
        // c022's model: person_evidence from the FIRST message on every turn, as the live chat did.
        const base = { template_key: "dpoa", employee_name: "remi", person_evidence: evidenceFrom(view, "can you create me a ca form for remi", turn - 1) };
        if (card) return { text: card.card ? `Here's the card for **${card.card.employee}**.` : card.ask_exactly ?? `I couldn't update the card, the name lookup kept stopping it (${card.reason_code}).` };
        if (turn <= 2) return { tool: "propose_form", input: base };
        if (turn === 3) return { tool: "propose_form", input: { ...base, payroll_deduct: "yes", payroll_evidence: evidenceFrom(view, latest(view)) } };
        return { tool: "propose_form", input: { ...base, payroll_deduct: "yes", payroll_evidence: evidenceFrom(view, "payroll is deductable", 1), warning_level: "verbal", level_evidence: evidenceFrom(view, "given verbal warning"), what_happened: "She was caught vaping." } };
      }));
      const thread = t.thread();
      const ask = await thread.say("can you create me a ca form for remi");
      expect(ask.content).toMatch(/Did you mean \*\*Remy Calder\*\*\?/);
      await thread.say("keep remi");
      expect(thread.proposal?.employeeName?.toLowerCase()).toBe("remi");
      for (const [words, check] of [
        ["payroll is deductable", () => expect((thread.proposal as { payrollDeduct?: string | null } | undefined)?.payrollDeduct, "the payroll answer did not reach the card").toBe("yes")],
        ["she was caught vaping, given verbal warning", () => expect((thread.proposal as { warningLevel?: string | null } | undefined)?.warningLevel, "the level did not reach the card").toBe("verbal")],
      ] as const) {
        const reply = await thread.say(words);
        expect(reply.content, `"${words}" asked the Did-you-mean again`).not.toMatch(/Did you mean/);
        expect(reply.content, `"${words}" gave up`).not.toMatch(/kept stopping|couldn't update/i);
        expect(thread.proposal?.employeeName?.toLowerCase()).toBe("remi");
        check();
      }
    },
  },
];

/* The control: a full name that is a close spelling of a roster person is still asked about (ruling A), never taken. */
NOV16_AGENT_LOOP_TYPED_NAME_TAKEN_CASES.push({
  id: "nov16-typed-name-close-spelling-still-asks",
  title: "The control: \"CA for TC Remi Calder, she was late to her shift on 11/14\" (a close spelling of Remy Calder, title in front) asks Did you mean **Remy Calder**?, never a card as typed",
  report: `${REPORT}; ruling A kept`,
  status: "fixed",
  fixFlags: [FLAG],
  async run(t) {
    if (!t.loopOn?.()) return;
    await salon(t);
    t.loopModel!(loopStandIn((view): LoopDecision => {
      const card = lastResult(view, "propose_form") as Result;
      if (!card) return { tool: "propose_form", input: { template_key: "dpoa", employee_name: "TC Remi Calder", person_evidence: evidenceFrom(view, "TC Remi Calder"), what_happened: "She was late to her shift on 11/14.", incident_date: "2026-11-14" } };
      return { text: card.card ? `Here's the card for **${card.card.employee}**.` : card.ask_exactly ?? (card as { note?: string }).note ?? "" };
    }));
    const thread = t.thread();
    const reply = await thread.say("CA for TC Remi Calder, she was late to her shift on 11/14");
    expect(thread.proposal ?? null, `a close spelling was taken as typed:\n${reply.content}`).toBeNull();
    expect(reply.content).toMatch(/Did you mean \*\*Remy Calder\*\*\?/);
  },
});
