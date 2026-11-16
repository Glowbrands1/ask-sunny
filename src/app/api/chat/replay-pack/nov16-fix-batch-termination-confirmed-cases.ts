import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";
import { evidenceFrom, lastResult, loopStandIn, type LoopDecision, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * FIX BATCH ITEM 5, PART 2: A CITED TURN'S TERMINATION COUNTS ONLY THROUGH A CONFIRMED SPELLING (QA's ruling, 16 Nov 2026)
 * ============================================================================
 *
 * c219: "the termination level promised at T1 was missing". QA's ruling: a cited turn of the same request may unlock the
 * termination only when the link between that turn's name and this person is the manager's confirmed answer to this
 * chat's own "Did you mean" (the server's name question record, `confirmed-spelling.ts`, #1051). Never on the model's
 * request_evidence citation alone, and never from a turn that names another roster person. Level and payroll stay as K8
 * says. Invented names only: Remy Calder (roster), "Remi Calder" (nobody), Juno Paxton (roster).
 */

const FLAG = "AGENT_LOOP_ENABLED";
const NEAR_MISS = "NEAR_MISS_NEVER_SEATED_ENABLED";
const REPORT = "QA's 266 shadow replay, c219 (fix batch item 5): the termination level promised at T1 was missing; QA's ruling on cited turns (16 Nov 2026)";
const T1 = (name: string) => `we're terminating ${name}, she no call no showed on 11/12`;

function start(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-11-14T22:40:00Z"));
  t.directory([...STAFF]);
  t.as("salon_director", KEARNEY);
}

type CardOut = { reason_code?: string; not_on_card?: { field: string; reason_code: string }[]; facts?: { termination_stated?: unknown } };
const proposeOutputs = (views: readonly LoopView[]) => views.flatMap((view) => view.results.filter((result) => result.tool === "propose_form")).map((result) => result.output as CardOut);
const lastSaid = (view: LoopView) => [...view.turns].reverse().find((turn) => turn.role === "user")?.text ?? "";

/**
 * T1: the termination for a typed name (looked up only when `ask`, so find_staff's Did-you-mean is recorded); T2: the
 * person, then a termination CA citing T1 as request_evidence.
 */
function model(t1Name: string, ask: boolean) {
  return loopStandIn((view): LoopDecision => {
    const said = lastSaid(view);
    const staff = lastResult(view, "find_staff") as { note?: string; matches?: { employee_id: string }[] } | null;
    if (said.startsWith("we're terminating")) {
      if (ask && !staff) return { tool: "find_staff", input: { name: t1Name } };
      const asked = /Ask the manager, in these words: ([\s\S]+)$/.exec(staff?.note ?? "")?.[1];
      return { text: asked ?? "Who is this Corrective Action Form for?" };
    }
    if (!staff) return { tool: "find_staff", input: { name: "Remy Calder" } };
    if (!lastResult(view, "propose_form")) {
      return {
        tool: "propose_form",
        input: {
          template_key: "dpoa", employee_id: staff.matches?.[0]?.employee_id ?? "e-2", warning_level: "termination", policy: "Attendance",
          what_happened: "She no call no showed on 11/12.", incident_date: "2026-11-12",
          request_evidence: [evidenceFrom(view, "she no call no showed on 11/12", 1)],
        },
      };
    }
    const card = lastResult(view, "propose_form") as CardOut & { error?: string };
    return { text: card.reason_code ?? "Here's the Corrective Action Form for **Remy Calder**." };
  });
}

export const NOV16_FIX_BATCH_TERMINATION_CONFIRMED_CASES: ReplayCase[] = [
  {
    id: "nov16-fix-batch-5-confirmed-spelling-unlocks-the-termination",
    title: "Fix batch item 5, part 2: \"we're terminating Remi Calder, she no call no showed on 11/12\" gets \"Did you mean **Remy Calder**?\"; \"Remy Calder\" typed back confirms it, so the cited T1 unlocks the termination (termination_stated)",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG, NEAR_MISS],
    async run(t) {
      if (!t.loopOn?.()) return;
      start(t);
      const standIn = model("Remi Calder", true);
      t.loopModel!(standIn);
      const thread = t.thread();
      const ask = await thread.say(T1("Remi Calder"));
      expect(ask.content).toMatch(/Did you mean \*\*Remy Calder\*\*\?/);
      await thread.say("Remy Calder");
      const out = proposeOutputs(standIn.views).at(-1)!;
      expect(out.facts?.termination_stated, `a confirmed spelling did not unlock T1's termination:\n${JSON.stringify(out)}`).toBeTruthy();
      expect(out.not_on_card?.some((row) => row.reason_code === "termination_not_stated") ?? false).toBe(false);
    },
  },
  {
    id: "nov16-fix-batch-5-unconfirmed-citation-does-not-unlock-the-termination",
    title: "Fix batch item 5, part 2: the same T1 with no Did-you-mean asked (the app asked \"Who is this … for?\"), then \"Remy Calder\": the cited T1 joins the request but never unlocks the termination (termination_not_stated)",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG, NEAR_MISS],
    async run(t) {
      if (!t.loopOn?.()) return;
      start(t);
      const standIn = model("Remi Calder", false);
      t.loopModel!(standIn);
      const thread = t.thread();
      await thread.say(T1("Remi Calder"));
      await thread.say("Remy Calder");
      const out = proposeOutputs(standIn.views).at(-1)!;
      expect(out.facts?.termination_stated ?? null, `an unconfirmed citation unlocked the termination:\n${JSON.stringify(out)}`).toBeNull();
      expect(out.not_on_card?.some((row) => row.field === "warning_level" && row.reason_code === "termination_not_stated")).toBe(true);
    },
  },
  {
    id: "nov16-fix-batch-5-a-turn-about-another-person-unlocks-nothing",
    title: "Fix batch item 5, part 2: \"we're terminating Juno Paxton, she no call no showed on 11/12\" cited on Remy Calder's card is refused (request_evidence_other_person): no card, no termination",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG, NEAR_MISS],
    async run(t) {
      if (!t.loopOn?.()) return;
      start(t);
      t.loopModel!(model("Juno Paxton", false));
      const thread = t.thread();
      await thread.say(T1("Juno Paxton"));
      const reply = await thread.say("Remy Calder");
      expect(thread.proposal, "another person's termination turn made Remy's card").toBeFalsy();
      expect(reply.content).toBe("request_evidence_other_person");
    },
  },
];
