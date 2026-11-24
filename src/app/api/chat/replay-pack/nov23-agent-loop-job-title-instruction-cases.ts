import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";
import { evidenceFrom, lastResult, loopStandIn, type LoopDecision, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * THE CARD'S JOB TITLE: WOVEN'S, UNLESS THE MANAGER TELLS YOU ANOTHER (Pau's job-title rule via QA, 23 Nov 2026)
 * ============================================================================
 *
 * The 266-chat run's 204 and 260 (re-checked on main 7787aa9): the manager wrote a title beside the name ("… <P> tanning
 * consultant at manhattan …") and the card kept Woven's ("Job title: HR — Woven lists <P> as HR"). Pau's rule: Woven's
 * title by default; an explicit instruction ("no, use Shift Lead"), quoted in job_title_evidence, overrides it; a title
 * mentioned in passing does not. Invented people: the pack's STAFF (Remy Calder and Juno Paxton, Woven titles Tanning
 * Consultant and Assistant Salon Director).
 */

const FLAG = "AGENT_LOOP_ENABLED";
const REPORT = "Pau's job-title rule (via QA, 23 Nov 2026); the 266-chat run's 204 and 260: a title the manager wrote beside the name vs Woven's";
const T1 = "create a verbal CA for Remy Calder, late to open on 11/21";
const SAID = "no, use Shift Lead";

type Out = { reason_code?: string; card?: { job_title?: string | null }; facts?: { job_title_as_you_said?: string } } | null;

function start(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-11-22T18:00:00Z"));
  t.directory([...STAFF]);
  t.as("salon_director", KEARNEY);
}

const said = (view: LoopView) => view.turns.filter((turn) => turn.role === "user").at(-1)?.text ?? "";
const outputs = (model: ReturnType<typeof loopStandIn>) => model.views.flatMap((view) => view.results.filter((result) => result.tool === "propose_form")).map((result) => result.output as Out);
const roleOf = (thread: { proposal?: unknown }) => (thread.proposal as { employeeRole?: string | null } | undefined)?.employeeRole ?? null;

export const NOV23_AGENT_LOOP_JOB_TITLE_INSTRUCTION_CASES: ReplayCase[] = [
  {
    id: "nov23-job-title-instruction-overrides-woven",
    title: "\"no, use Shift Lead\" after Remy's CA card (Woven: Tanning Consultant): the card and the saved form say Shift Lead",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.() || process.env.AGENT_LOOP_LIVE === "1") return;
      start(t);
      const model = loopStandIn((view): LoopDecision => {
        const out = lastResult(view, "propose_form") as Out;
        if (out?.card || out?.reason_code) return { text: "Here's the Corrective Action Form for **Remy**." };
        const base = { template_key: "dpoa", employee_id: "e-2", person_evidence: evidenceFrom(view, "Remy Calder"), what_happened: "Remy was late to open on 11/21.", incident_date: "2026-11-21" };
        return { tool: "propose_form", input: said(view) === SAID ? { ...base, job_title: "Shift Lead", job_title_evidence: evidenceFrom(view, SAID) } : base };
      });
      t.loopModel!(model);
      const thread = t.thread();
      await thread.say(T1);
      expect(roleOf(thread), "the card does not start with Woven's title (the case proves nothing)").toBe("Tanning Consultant");
      await thread.say(SAID);
      expect(roleOf(thread), `the manager's instruction did not change the title:\n${JSON.stringify(outputs(model).at(-1)).slice(0, 600)}`).toBe("Shift Lead");
      expect(outputs(model).at(-1)?.facts?.job_title_as_you_said).toBe("Shift Lead");
      const id = await thread.create();
      expect(t.values(id).job_title ?? "", "the saved form does not say Shift Lead").toBe("Shift Lead");
    },
  },
  {
    id: "nov23-job-title-in-passing-keeps-woven",
    title: "260's shape: \"… Juno Paxton tanning consultant at Kearney …\" (Woven: Assistant Salon Director): a title beside the name is not an instruction; the card keeps Woven's",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.() || process.env.AGENT_LOOP_LIVE === "1") return;
      start(t);
      const text = "create a CA for Juno Paxton tanning consultant at Kearney, late to open on 11/21";
      const model = loopStandIn((view): LoopDecision => {
        const out = lastResult(view, "propose_form") as Out;
        if (out?.card) return { text: "Here's the card." };
        const base = { template_key: "dpoa", employee_id: "e-3", person_evidence: evidenceFrom(view, "Juno Paxton"), what_happened: "Juno was late to open on 11/21.", incident_date: "2026-11-21" };
        // The live model read the title beside the name as an instruction; handed back, it proposes without it.
        return { tool: "propose_form", input: out?.reason_code ? base : { ...base, job_title: "Tanning Consultant", job_title_evidence: evidenceFrom(view, "Juno Paxton tanning consultant") } };
      });
      t.loopModel!(model);
      const thread = t.thread();
      await thread.say(text);
      expect(outputs(model).map((out) => out?.reason_code).filter(Boolean)).toContain("job_title_not_instructed");
      expect(roleOf(thread), "a title said in passing replaced Woven's").toBe("Assistant Salon Director");
    },
  },
  {
    id: "nov23-job-title-needs-evidence",
    title: "Control: job_title with no evidence quoting the manager is handed back; the card keeps Woven's title",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.() || process.env.AGENT_LOOP_LIVE === "1") return;
      start(t);
      const model = loopStandIn((view): LoopDecision => {
        const out = lastResult(view, "propose_form") as Out;
        if (out?.card) return { text: "Here's the card." };
        const base = { template_key: "dpoa", employee_id: "e-2", person_evidence: evidenceFrom(view, "Remy Calder"), what_happened: "Remy was late to open on 11/21.", incident_date: "2026-11-21" };
        return { tool: "propose_form", input: out?.reason_code ? base : { ...base, job_title: "Shift Lead" } };
      });
      t.loopModel!(model);
      const thread = t.thread();
      await thread.say(T1);
      expect(outputs(model).map((out) => out?.reason_code).filter(Boolean)).toContain("job_title_not_instructed");
      expect(roleOf(thread)).toBe("Tanning Consultant");
    },
  },
];
