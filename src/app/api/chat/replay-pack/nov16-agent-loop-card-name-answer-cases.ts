import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";
import { evidenceFrom, lastResult, loopStandIn, type LoopDecision, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * A FULL NAME AFTER AN OFF-ROSTER CARD CORRECTS THAT CARD (QA's live c219 re-ask, main e2e92554, 16 Nov 2026)
 * ============================================================================
 *
 * T1 a pasted script; T2 "I need an exit form with this information" gave an exit card for the typed name (not on the
 * staff list: the card asks the manager to check it); T3 "For <full name>" did not update the card, and the reply re-asked
 * "resignation or termination, would you like me to prepare the Employee Exit Form?" although the card existed. Variant:
 * "For Test Testy" kept the earlier spelling. Expected: T3's full name is the person for the existing exit card, through
 * #1050's roster check (s10); never a re-ask about a card that exists. The off-roster card's check is recorded as a name
 * question, so the full name in the next message answers it. Invented names only: "Test Testi" (typed, nobody), Odalys
 * Fenwick (nobody), Juno Paxton and Remy Calder (roster).
 */

const FLAG = "AGENT_LOOP_ENABLED";
const REPORT = "QA's live c219 re-ask (16 Nov 2026, main e2e92554): T3 \"For <full name>\" did not update the exit card and re-asked about the form";
const ASK = "I need an exit form with this information.";
const SCRIPT = "Test Testi, this meeting is about the text you sent your salon director Juno Paxton on 11/3. It was disrespectful. Your employment with us is terminated, effective 11/5. Please return your keys; your final paycheck will be mailed.";

function start(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-11-15T22:40:00Z"));
  t.directory([...STAFF]);
  t.as("salon_director", KEARNEY);
}

const lastSaid = (view: LoopView) => [...view.turns].reverse().find((turn) => turn.role === "user")?.text ?? "";
type CardOut = {
  reason_code?: string;
  ask_exactly?: string;
  not_on_card?: { field: string; reason_code: string }[];
  facts?: { name_corrected?: { from: string; to: string }; exit_termination?: { form_label: string; effective: string } };
} | null;
const lastCardOut = (views: readonly LoopView[]) => views.flatMap((view) => view.results).filter((result) => result.tool === "propose_form").at(-1)?.output as CardOut;

/** The model: T2 makes the exit card for the typed name; later turns propose the same exit card for the name given. */
function model(name: string) {
  return loopStandIn((view): LoopDecision => {
    const said = lastSaid(view);
    const card = lastResult(view, "propose_form") as CardOut;
    if (card) return { text: card.ask_exactly ?? card.reason_code ?? "Here's the Resignation/Exit Form." };
    const exit = (employee: string, back: number) => ({
      tool: "propose_form" as const,
      input: {
        template_key: "stc-exit", employee_name: employee, exit_type: "termination", effective_date: "11/5",
        exit_evidence: { ...evidenceFrom(view, ASK, back), kind: "asks_for_exit_form" },
        request_evidence: [evidenceFrom(view, "this meeting is about the text you sent", back + 1), evidenceFrom(view, ASK, back)],
      },
    });
    if (said.startsWith(ASK)) return { ...exit("Test Testi", 0), input: { ...exit("Test Testi", 0).input, request_evidence: [evidenceFrom(view, "this meeting is about the text you sent", 1)] } };
    if (said.startsWith("For ")) return exit(name, 1);
    if (said.startsWith("use ")) return exit(name, 2);
    return { text: "This is a termination meeting script for Test. Do you want the Resignation/Exit Form for Test, or a Corrective Action?" };
  });
}

const RE_ASK = /would you like me to prepare|resignation or (?:a )?termination\?/i;

export const NOV16_AGENT_LOOP_CARD_NAME_ANSWER_CASES: ReplayCase[] = [
  ...(["Odalys Fenwick", "Test Testy"] as const).map((name): ReplayCase => ({
    id: `nov16-card-name-answer-off-roster-${name.replace(/\s+/g, "-").toLowerCase()}-c219`,
    title: `c219 re-ask: after the exit card for "Test Testi" (typed, not on the staff list), "For ${name}" corrects that card through the roster check: "${name}" is nobody on the list, so the reply asks "Reply **use ${name}** …" (never a re-ask about the form), and "use ${name}" puts ${name} on the exit card from the script's turns`,
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      start(t);
      const standIn = model(name);
      t.loopModel!(standIn);
      const thread = t.thread();
      await thread.say(SCRIPT);
      await thread.say(`${ASK} ${SCRIPT}`);
      expect(thread.proposal?.employeeName, "T2 made no exit card for the typed name").toBe("Test Testi");
      const t3 = await thread.say(`For ${name}`);
      expect(t3.content, `T3 re-asked about a card that exists:\n${t3.content}`).not.toMatch(RE_ASK);
      expect(t3.content, `T3 did not run the roster check for the corrected name:\n${t3.content}`).toContain(`Reply **use ${name}**`);
      await thread.say(`use ${name}`);
      expect(thread.proposal?.templateKey).toBe("stc-exit");
      expect(thread.proposal?.employeeName, "the answer did not correct the existing exit card").toBe(name);
    },
  })),
  {
    id: "nov16-card-name-answer-on-roster-corrects-at-once-c219",
    title: "c219 re-ask: after the exit card for \"Test Testi\" (typed, not on the staff list), \"For Remy Calder\" (on the staff list) corrects that exit card at once (name_corrected Test Testi → Remy Calder), from the script's turns",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      start(t);
      const standIn = model("Remy Calder");
      t.loopModel!(standIn);
      const thread = t.thread();
      await thread.say(SCRIPT);
      await thread.say(`${ASK} ${SCRIPT}`);
      const t3 = await thread.say("For Remy Calder");
      expect(t3.content).not.toMatch(RE_ASK);
      expect(thread.proposal?.templateKey).toBe("stc-exit");
      expect(thread.proposal?.employeeName, `the roster person did not correct the card:\n${t3.content}`).toBe("Remy Calder");
      const out = lastCardOut(standIn.views);
      expect(out?.facts?.name_corrected).toEqual({ from: "Test Testi", to: "Remy Calder" });
      /* QA (16 Nov 2026, live 0/6): the script's turns named "Test Testi"; after the correction they are Remy Calder's own turns. */
      expect(out?.not_on_card ?? [], "the termination was dropped after the name correction").not.toContainEqual({ field: "exit_type", reason_code: "termination_not_stated" });
      expect(out?.facts?.exit_termination, "the exit card is not a termination").toEqual({ form_label: "Immediate involuntary separation", effective: "2026-11-05" });
    },
  },
  {
    id: "nov16-card-name-answer-on-roster-corrected-ca-keeps-the-stated-level-c219",
    title: "c219 re-ask, Corrective Action variant: \"Test Testi was disrespectful to a client at the front desk on 11/3. I need a written CA.\" made a written CA card for \"Test Testi\" (not on the staff list); \"For Remy Calder\" corrects that card and keeps the written level stated in the turn that named Test Testi",
    report: `${REPORT}; QA's follow-up (16 Nov 2026): every evidence check (level included) reads the turns that named the earlier name`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      start(t);
      const SAID = "Test Testi was disrespectful to a client at the front desk on 11/3. I need a written CA.";
      const standIn = loopStandIn((view): LoopDecision => {
        const said = lastSaid(view);
        const card = lastResult(view, "propose_form") as CardOut;
        if (card) return { text: card.ask_exactly ?? card.reason_code ?? "Here's the Corrective Action Form." };
        const back = said.startsWith("For ") ? 1 : 0;
        return {
          tool: "propose_form",
          input: {
            template_key: "dpoa", employee_name: said.startsWith("For ") ? "Remy Calder" : "Test Testi",
            what_happened: "Disrespectful to a client at the front desk on 11/3.", incident_date: "2026-11-03",
            warning_level: "written", level_evidence: evidenceFrom(view, "I need a written CA", back),
            request_evidence: [evidenceFrom(view, "was disrespectful", back)],
          },
        };
      });
      t.loopModel!(standIn);
      const thread = t.thread();
      await thread.say(SAID);
      expect(thread.proposal?.employeeName, "T1 made no CA card for the typed name").toBe("Test Testi");
      const t2 = await thread.say("For Remy Calder");
      expect(thread.proposal?.employeeName, `the roster person did not correct the card:\n${t2.content}`).toBe("Remy Calder");
      expect(lastCardOut(standIn.views)?.facts?.name_corrected).toEqual({ from: "Test Testi", to: "Remy Calder" });
      expect((thread.proposal as { warningLevel?: string | null } | null)?.warningLevel ?? null, `the stated level was dropped after the correction:\n${t2.content}`).toBe("written");
    },
  },
  {
    id: "nov16-card-check-hand-back-compares-the-card-on-screen-c219",
    title: "c219 live (QA, 16 Nov 2026): a CA card citing the Standards of Conduct is on screen; the next reply repeats that card's **Policy:** line with nothing proposed this turn. The card check compares it with the card on screen, so it is never \"That change isn't on the card yet: policy (…)\"; and a turn with no card on screen never gets that sentence",
    report: `${REPORT}; QA's follow-up (16 Nov 2026): "That change isn't on the card yet: policy (Standards of Conduct Policy, JBA Policy Manual p.12). Tell me again and I'll update the card." with no card on screen, and at T3`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      start(t);
      const SAID = "ca for Remy Calder, she was disrespectful to a client at the front desk on 11/3";
      const standIn = loopStandIn((view): LoopDecision => {
        const said = lastSaid(view);
        const card = lastResult(view, "propose_form") as { card?: { policy?: string | null }; reason_code?: string } | null;
        const staff = lastResult(view, "find_staff") as { matches?: { employee_id: string }[] } | null;
        if (said.startsWith("ca for Remy") && !staff) return { tool: "find_staff", input: { name: "Remy Calder", person_evidence: evidenceFrom(view, "Remy Calder") } };
        if (said.startsWith("ca for Remy") && !card) {
          return { tool: "propose_form", input: { template_key: "dpoa", employee_id: staff?.matches?.[0]?.employee_id, what_happened: "Disrespectful to a client at the front desk on 11/3.", incident_date: "2026-11-03", policy: "Standards of Conduct", request_evidence: [evidenceFrom(view, "disrespectful to a client")] } };
        }
        // The card's own policy line, as the card holds it (the cited heading, manual and page).
        const policy = (view.results.map((result) => (result.output as { card?: { policy?: string | null } } | null)?.card?.policy).filter(Boolean).at(-1)) ?? "Standards of Conduct Policy, JBA Policy Manual p.12";
        return { text: `The Corrective Action Form for Remy is below; press Create when it's right.\n\n**Policy:** ${policy}` };
      });
      t.loopModel!(standIn);
      const thread = t.thread();
      const t1 = await thread.say(SAID);
      expect(thread.proposal?.employeeName, `no CA card:\n${t1.content}`).toBe("Remy Calder");
      expect(t1.content).not.toMatch(/isn't on the card yet/);
      const t2 = await thread.say("thanks, is that the right policy?");
      expect(t2.formProposal ?? null, "nothing was proposed this turn").toBeNull();
      expect(t2.content, "the card check compared the reply with no card, not the card on screen").not.toMatch(/isn't on the card yet/);

      // No card on screen at all (a reply with a policy line and no card): never the hand-back.
      const words = t.thread();
      t.loopModel!(loopStandIn((): LoopDecision => ({ text: "Disrespect toward a coworker falls under the conduct rules.\n\n**Policy:** Standards of Conduct Policy, JBA Policy Manual p.12" })));
      const plain = await words.say("is a rude text to a director a conduct issue?");
      expect(words.proposal ?? null).toBeNull();
      expect(plain.content, "the card check wrote its hand-back with no card on screen").not.toMatch(/isn't on the card yet/);
    },
  },
];
