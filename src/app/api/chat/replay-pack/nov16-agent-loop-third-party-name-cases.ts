import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";
import { evidenceFrom, lastResult, loopStandIn, type LoopDecision, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * A THIRD PERSON NAMED IN THIS PERSON'S TURN (QA's follow-up to #1064, 16 Nov 2026)
 * ============================================================================
 *
 * (a) A level stated in a turn that also names a third party was refused as other_person: "Test Testi was disrespectful
 * to her salon director Juno Paxton … I need a written CA" lost Written. The turn names this card's person too, so it is
 * this person's turn (the #1052 item 5 rule) and the level carries.
 * (b) title_differs read "Salon Director" from "your salon director Juno Paxton". A title said about another person is
 * never this person's: it belongs to the name it is attached to, by the name reader.
 * Invented names only: "Test Testi" (typed, nobody), Juno Paxton and Remy Calder (roster).
 */

const FLAG = "AGENT_LOOP_ENABLED";
const REPORT = "QA's follow-up to #1064 (16 Nov 2026): a third person named in this person's turn took the level (other_person) and the title (title_differs)";

function start(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-11-15T22:40:00Z"));
  t.directory([...STAFF]);
  t.as("salon_director", KEARNEY);
}

type CardOut = { reason_code?: string; ask_exactly?: string; level_evidence?: string; facts?: { title_differs?: { woven: string; manager_said: string } } } | null;
const lastCardOut = (views: readonly LoopView[]) => views.flatMap((view) => view.results).filter((result) => result.tool === "propose_form").at(-1)?.output as CardOut;

export const NOV16_AGENT_LOOP_THIRD_PARTY_NAME_CASES: ReplayCase[] = [
  ...(["Test Testi", "Remy Calder"] as const).map((name): ReplayCase => ({
    id: `nov16-third-party-named-level-carries-${name.replace(/\s+/g, "-").toLowerCase()}`,
    title: `(a) "${name} was disrespectful to her salon director Juno Paxton on 11/3. I need a written CA.": the turn names ${name}, so it is ${name}'s turn although it names Juno Paxton too, and the card keeps Written`,
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      start(t);
      const SAID = `${name} was disrespectful to her salon director Juno Paxton on 11/3. I need a written CA.`;
      const standIn = loopStandIn((view): LoopDecision => {
        const card = lastResult(view, "propose_form") as CardOut;
        if (card) return { text: card.ask_exactly ?? card.reason_code ?? "Here's the Corrective Action Form." };
        const staff = lastResult(view, "find_staff") as { matches?: { employee_id: string }[] } | null;
        if (name === "Remy Calder" && !staff) return { tool: "find_staff", input: { name, person_evidence: evidenceFrom(view, name) } };
        return {
          tool: "propose_form",
          input: {
            template_key: "dpoa", ...(name === "Remy Calder" ? { employee_id: staff?.matches?.[0]?.employee_id } : { employee_name: name }),
            what_happened: `${name} was disrespectful to the salon director on 11/3.`, incident_date: "2026-11-03",
            warning_level: "written", level_evidence: evidenceFrom(view, "I need a written CA"),
          },
        };
      });
      t.loopModel!(standIn);
      const thread = t.thread();
      const reply = await thread.say(SAID);
      expect(thread.proposal?.employeeName, `no CA card for ${name}:\n${reply.content}`).toBe(name);
      expect(lastCardOut(standIn.views)?.level_evidence, "the level was read as the third person's").not.toBe("other_person");
      expect((thread.proposal as { warningLevel?: string | null } | null)?.warningLevel ?? null, `the stated level was dropped:\n${reply.content}`).toBe("written");
    },
  })),
  {
    id: "nov16-third-party-title-is-not-this-persons-title",
    title: "(b) an exit form for Remy Calder from \"Remy Calder, this meeting is about the text you sent your salon director Juno Paxton on 11/3 …\": \"salon director\" is Juno Paxton's title, so there is no title_differs; \"Remy Calder, our salon director, …\" still gives title_differs",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      start(t);
      const exitFor = () => loopStandIn((view): LoopDecision => {
        const card = lastResult(view, "propose_form") as CardOut;
        if (card) return { text: card.ask_exactly ?? card.reason_code ?? "Here's the Resignation/Exit Form." };
        const staff = lastResult(view, "find_staff") as { matches?: { employee_id: string }[] } | null;
        if (!staff) return { tool: "find_staff", input: { name: "Remy Calder", person_evidence: evidenceFrom(view, "Remy Calder") } };
        return {
          tool: "propose_form",
          input: {
            template_key: "stc-exit", employee_id: staff.matches?.[0]?.employee_id, exit_type: "termination", effective_date: "11/5",
            exit_evidence: { ...evidenceFrom(view, "I need an exit form"), kind: "asks_for_exit_form" },
          },
        };
      });
      const OTHER = "Remy Calder, this meeting is about the text you sent your salon director Juno Paxton on 11/3. It was disrespectful. Your employment with us is terminated, effective 11/5.";
      const other = exitFor();
      t.loopModel!(other);
      const one = t.thread();
      const first = await one.say(`I need an exit form with this information. ${OTHER}`);
      expect(one.proposal?.employeeName, `no exit card:\n${first.content}`).toBe("Remy Calder");
      expect(lastCardOut(other.views)?.facts?.title_differs, "Juno Paxton's title was read as Remy Calder's").toBeUndefined();

      const OWN = "Remy Calder, our salon director, sent a disrespectful text on 11/3. Her employment with us is terminated, effective 11/5.";
      const own = exitFor();
      t.loopModel!(own);
      const two = t.thread();
      await two.say(`I need an exit form with this information. ${OWN}`);
      expect(lastCardOut(own.views)?.facts?.title_differs, "the title said for Remy Calder was lost").toMatchObject({ manager_said: "Salon Director" });
    },
  },
];
