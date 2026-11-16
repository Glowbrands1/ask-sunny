import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";
import { evidenceFrom, lastResult, loopStandIn, type LoopDecision, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * THE RETRY GUARD (QA, 16 Nov 2026; the 266 re-run on the fix batch, head b155c737)
 * ============================================================================
 *
 * c219 turn 3 ("For <A>", <A> off the active roster) ran find_staff once and then propose_form FIVE times in a row, and
 * stopped at 7 of 8 steps (36.9 s); c134 turn 3 alternated propose_form / find_staff / find_staff. The model was retrying
 * after refusals that did not say what to ask. Keyed on (tool, reason_code) in one turn, whatever the args: the second
 * refusal carries stop_retrying {reason_code, ask_exactly?}; any later call of that tool in the turn is refused without
 * running it. propose_form's own not_on_roster refusal now carries find_staff's use-<name> line as ask_exactly. Code
 * never writes the reply. Invented names only (Remy Calder, "Odalis").
 */

const FLAG = "AGENT_LOOP_ENABLED";
const REPORT = "QA's 266 re-run on the fix batch (16 Nov 2026): c219 turn 3 ran propose_form five times, c134 alternated propose_form and find_staff";
const USE_ODALIS = "I can't find **Odalis** on your staff list. Reply **use Odalis** to put the name on the form as you typed it, or give me the full name.";

function start(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-11-15T22:40:00Z"));
  t.directory([...STAFF]);
  t.as("salon_director", KEARNEY);
}

type Out = { reason_code?: string; ask_exactly?: string; stop_retrying?: { reason_code: string; ask_exactly?: string }; card?: unknown };
/** Every result of the tool in the turn: each view holds the turn's results so far, so the fullest one has them all. */
const outputs = (views: readonly LoopView[], tool: string) =>
  views.map((view) => view.results.filter((result) => result.tool === tool).map((result) => result.output as Out)).reduce<Out[]>((most, outs) => (outs.length > most.length ? outs : most), []);
const ran = (outs: readonly Out[]) => outs.filter((out) => out.reason_code !== "stop_retrying");

export const NOV16_AGENT_LOOP_RETRY_GUARD_CASES: ReplayCase[] = [
  {
    id: "nov16-retry-guard-a-stubborn-model-runs-propose-form-at-most-twice",
    title: "Retry guard: a model that proposes Remy's CA with a policy that is no heading on every step, changing what_happened each time, gets not_a_heading twice (stop_retrying on the second) and every later propose_form is refused without running (stop_retrying)",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      start(t);
      let tries = 0;
      const stubborn = loopStandIn((view): LoopDecision => {
        if (!lastResult(view, "find_staff")) return { tool: "find_staff", input: { name: "remy calder" } };
        tries += 1;
        return { tool: "propose_form", input: { template_key: "dpoa", employee_id: "e-2", policy: "Being Late Policy", what_happened: `She was late on 11/12 (try ${tries}).`, incident_date: "2026-11-12" } };
      });
      t.loopModel!(stubborn);
      await t.thread().say("ca for remy calder, late on 11/12, being late policy");
      const outs = outputs(stubborn.views, "propose_form");
      expect(ran(outs).length, `propose_form ran more than twice in one turn:\n${JSON.stringify(outs.map((out) => out.reason_code))}`).toBeLessThanOrEqual(2);
      expect(ran(outs).map((out) => out.reason_code)).toEqual(["not_a_heading", "not_a_heading"]);
      expect(ran(outs)[1]!.stop_retrying?.reason_code).toBe("not_a_heading");
      expect(outs.length, "the stubborn model was not refused again").toBeGreaterThan(2);
      expect(outs.slice(2).every((out) => out.reason_code === "stop_retrying")).toBe(true);
      // The blocked calls are counted in the turn's trace (agent_loop.stop_retrying: n), never their values.
      const row = [...(t.rows?.("chat_traces") ?? [])].reverse().find((entry) => (entry.slots as { agent_loop?: unknown } | undefined)?.agent_loop);
      const looped = (row?.slots as { agent_loop?: { stop_retrying?: number; steps?: { tool: string; error_kind?: string }[] } } | undefined)?.agent_loop;
      const blocked = (looped?.steps ?? []).filter((step) => step.tool === "propose_form" && step.error_kind === "stop_retrying").length;
      expect(blocked, "no blocked call in the trace's steps").toBeGreaterThanOrEqual(outs.length - 2);
      expect(looped?.stop_retrying).toBe(blocked);
      expect((looped?.steps ?? []).filter((step) => step.tool === "propose_form" && step.error_kind !== "stop_retrying").length, "the trace shows propose_form ran more than twice").toBe(2);
    },
  },
  {
    id: "nov16-retry-guard-c134-shape-asks-use-name-instead-of-retrying",
    title: "Retry guard (c134's shape): propose_form for \"Odalis\" (nobody on the roster) is refused with ask_exactly \"Reply **use Odalis** …\"; a model that looks Odalis up again and proposes again gets stop_retrying with that line, and its reply ends with it",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      start(t);
      const model = loopStandIn((view): LoopDecision => {
        const card = lastResult(view, "propose_form") as Out | null;
        if (card?.stop_retrying) return { text: `I couldn't put that on a form yet. ${card.stop_retrying.ask_exactly ?? ""}`.trim() };
        const proposals = view.results.filter((result) => result.tool === "propose_form").length;
        const lookups = view.results.filter((result) => result.tool === "find_staff").length;
        if (lookups <= proposals) return { tool: "find_staff", input: { name: "Odalis" } };
        return { tool: "propose_form", input: { template_key: "dpoa", employee_name: "Odalis", what_happened: "She was late on 11/12.", incident_date: "2026-11-12", request_evidence: [evidenceFrom(view, "late on 11/12")] } };
      });
      t.loopModel!(model);
      const thread = t.thread();
      const reply = await thread.say("ca for odalis, late on 11/12");
      const outs = outputs(model.views, "propose_form");
      expect(ran(outs).length, JSON.stringify(outs)).toBe(2);
      expect(outs[0]!.reason_code).toBe("not_on_roster");
      expect(outs[0]!.ask_exactly).toBe(USE_ODALIS);
      expect(outs[1]!.stop_retrying).toEqual({ reason_code: "not_on_roster", ask_exactly: USE_ODALIS });
      expect(reply.content).toContain(USE_ODALIS);
      expect(thread.proposal ?? null).toBeNull();
    },
  },
  {
    id: "nov16-retry-guard-two-different-codes-never-stop",
    title: "Retry guard control: propose_form refused once for not_a_heading and once for date_not_stated in one turn (two codes) gets no stop_retrying, and the third, right call makes the card",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      start(t);
      const model = loopStandIn((view): LoopDecision => {
        if (!lastResult(view, "find_staff")) return { tool: "find_staff", input: { name: "remy calder" } };
        const proposals = view.results.filter((result) => result.tool === "propose_form").length;
        const base = { template_key: "dpoa", employee_id: "e-2", what_happened: "She was late on 11/12 and 11/13." };
        if (proposals === 0) return { tool: "propose_form", input: { ...base, policy: "Being Late Policy", incident_date: "2026-11-12" } };
        if (proposals === 1) return { tool: "propose_form", input: { ...base, policy: "Attendance", incident_date: "2026-11-09" } };
        if (proposals === 2) return { tool: "propose_form", input: { ...base, policy: "Attendance", incident_date: "2026-11-12" } };
        return { text: "Here's the Corrective Action Form for **Remy Calder**." };
      });
      t.loopModel!(model);
      const thread = t.thread();
      await thread.say("ca for remy calder, late on 11/12 and 11/13");
      const outs = outputs(model.views, "propose_form");
      expect(outs.map((out) => out.reason_code ?? null).slice(0, 2)).toEqual(["not_a_heading", "date_not_stated"]);
      expect(outs.some((out) => out.stop_retrying), JSON.stringify(outs)).toBe(false);
      expect(thread.proposal?.employeeName, "the right third call made no card").toBe("Remy Calder");
    },
  },
  {
    id: "nov16-retry-guard-c134-alternating-lookups-of-one-name-stop-by-call-3",
    title: "Retry guard (the timed re-run's c134 T3): a first name nobody has (\"Tavi\"), looked up and proposed in turn (find_staff, propose_form, find_staff \"use Tavi\" …): not_on_roster counts across both tools for that name, and the turn ends with \"Reply **use Tavi**\" by call 3",
    report: `${REPORT}; c134 T3 called find_staff and propose_form 7 times, all not_on_roster`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      start(t);
      const USE_TAVI = "I can't find **Tavi** on your staff list. Reply **use Tavi** to put the name on the form as you typed it, or give me the full name.";
      const calls = ["find_staff", "propose_form", "find_staff", "propose_form", "find_staff", "propose_form", "find_staff"] as const;
      const model = loopStandIn((view): LoopDecision => {
        const results = view.results;
        const latest = results.at(-1)?.output as Out | undefined;
        if (latest?.stop_retrying) return { text: `Tavi isn't on your staff list yet. ${latest.stop_retrying.ask_exactly ?? ""}`.trim() };
        const next = calls[results.length];
        if (!next) return { text: "Who is this for?" };
        if (next === "find_staff") return { tool: "find_staff", input: { name: results.length >= 2 ? "use Tavi" : "Tavi", person_evidence: evidenceFrom(view, "for tavi") } };
        return { tool: "propose_form", input: { template_key: "dpoa", employee_name: "Tavi", what_happened: "She was late on 11/12.", incident_date: "2026-11-12" } };
      });
      t.loopModel!(model);
      const reply = await t.thread().say("ca for tavi, late on 11/12");
      const all = model.views.reduce<{ tool: string; output: unknown }[]>((most, view) => (view.results.length > most.length ? [...view.results] : most), []);
      const ranCalls = all.filter((result) => (result.output as Out).reason_code !== "stop_retrying");
      expect(ranCalls.length, `the lookups of one name went on: ${JSON.stringify(all.map((result) => [result.tool, (result.output as Out).reason_code]))}`).toBeLessThanOrEqual(3);
      expect(reply.content).toContain(USE_TAVI);
    },
  },
];
