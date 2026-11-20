import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayCase, type ReplayContext } from "./cases";
import { evidenceFrom, loopStandIn, type LoopDecision, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * A PLAIN ASK FOR FORMS ON FILE IS NEVER STOPPED BY THE RETRY GUARD (Pau's live chat, 20 Nov 2026, 14:23–14:24Z)
 * ============================================================================
 *
 * Production on main 94e2c956: "list ca for the month" was refused privacy_not_asked once, then worked. "list ca or
 * coaching forms for <P> co" and "show me CA and coaching forms for <P> Co this month" were each refused privacy_not_asked
 * twice, then stop_retrying twice, and the reply said "I wasn't able to pull those forms up just now — could you try
 * asking again" / "a lookup issue on my end". The traces' refusals are 379 characters: evidence_not_manager_turn, which is
 * what a call with no forms_on_file_evidence gets (it was optional in the schema). The model sent two such calls in ONE
 * step (CA and coaching, in parallel); the retry guard counted both before the model had seen either refusal, so the
 * call it then made WITH evidence was never run. General rule: refusals in the same model step count once (the model
 * could not act on the first); forms_on_file_evidence is required by find_past_forms' schema; the refusal names this
 * turn's message id; and a refused tool is never told to the manager as a lookup problem or "try again". Each stand-in
 * below calls as live did. Invented names only (Liesel Cobb).
 */

const FLAG = "AGENT_LOOP_ENABLED";
const REPORT = "Pau's live chat (20 Nov 2026, 14:23–14:24Z, main 94e2c956): find_past_forms refused privacy_not_asked then stop_retrying on plain asks for forms on file";
const offline = process.env.AGENT_LOOP_LIVE !== "1";

const LIESEL: DirectoryRow = { id: "e-liesel-cobb", firstName: "Liesel", lastName: "Cobb", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0309"], positionName: "Tanning Consultant" };

type Out = Record<string, unknown>;
const pastFormsResults = (view: LoopView) => view.results.filter((result) => result.tool === "find_past_forms").map((result) => result.output);

/** A finalized CA and a finalized Coaching Form on file for Liesel Cobb, this month. */
async function onFile(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-11-10T22:40:00Z"));
  for (const form of ["dpoa", "coaching"] as const) {
    t.loopModel!(loopStandIn((view): LoopDecision => (view.results.some((result) => result.tool === "propose_form")
      ? { text: "Here's the card." }
      : { tool: "propose_form", input: { template_key: form, employee_id: LIESEL.id, what_happened: "Liesel Cobb was late to open on 11/10.", incident_date: "2026-11-10", ...(form === "coaching" ? { policy: "Late Opening" } : {}) } })));
    const setup = t.thread();
    await setup.say(`${form === "dpoa" ? "ca" : "coaching form"} for liesel cobb, late to open on 11/10`);
    const id = await setup.create();
    Object.assign(t.forms().find((row) => row.id === id)!, { status: "finalized", form_date: "2026-11-10" });
  }
  vi.setSystemTime(new Date("2026-11-20T14:23:00Z"));
}

/**
 * The live model: first `bad` calls of find_past_forms in one step with no forms_on_file_evidence (as live), then one call
 * with the evidence quoting `quote`; then a reply. The results it saw are kept.
 */
function liveModel(calls: readonly Record<string, unknown>[], quote: string, seen: Out[][]) {
  return loopStandIn((view): LoopDecision => {
    const results = pastFormsResults(view);
    if (results.length === 0) return calls.length === 1 ? { tool: "find_past_forms", input: calls[0]! } : { tools: calls.map((input) => ({ tool: "find_past_forms", input })) };
    if (results.length === calls.length) return { tool: "find_past_forms", input: { ...calls[0]!, form: undefined, forms_on_file_evidence: evidenceFrom(view, quote) } };
    seen.push(results);
    return { text: "Here's what's on file." };
  });
}

const fixed = (id: string, title: string, run: (t: ReplayContext) => Promise<void>): ReplayCase => ({
  id,
  title,
  report: REPORT,
  status: "fixed",
  fixFlags: [FLAG],
  async run(t) {
    if (!t.loopOn?.() || !offline) return;
    t.directory([...STAFF, LIESEL]);
    t.as("salon_director", KEARNEY);
    await onFile(t);
    await run(t);
  },
});

const MONTH = { date_from: "2026-11-01", date_to: "2026-11-20" };

export const NOV20_AGENT_LOOP_FORMS_ON_FILE_PARALLEL_REFUSALS_CASES: ReplayCase[] = [
  fixed("nov20-forms-on-file-list-ca-for-the-month", "T1 \"list ca for the month\": one find_past_forms call without evidence is refused (naming this turn's message id), the call with evidence lists the CA on file", async (t) => {
    const seen: Out[][] = [];
    t.loopModel!(liveModel([{ form: "CA", ...MONTH }], "list ca for the month", seen));
    await t.thread().say("list ca for the month");
    const [refused, listed] = seen[0] ?? [];
    expect(refused?.reason_code, JSON.stringify(refused)).toBe("privacy_not_asked");
    expect(typeof refused?.this_message_id, JSON.stringify(refused)).toBe("string");
    expect(listed?.reason_code, JSON.stringify(listed)).toBeUndefined();
  }),
  ...([
    ["list ca or coaching forms for liesel co", "T2"],
    ["show me CA and coaching forms for liesel Co this month", "T3"],
  ] as const).map(([said, turn]) => fixed(`nov20-forms-on-file-parallel-refusals-not-stopped-${turn.toLowerCase()}`, `${turn} "${said}": two find_past_forms calls in one step without evidence (CA and coaching, as live) are refused, and the call made with evidence after them RUNS (never stop_retrying) and lists Liesel Cobb's forms`, async (t) => {
    const seen: Out[][] = [];
    const base = { employee_name: "liesel co", ...(turn === "T3" ? MONTH : {}) };
    t.loopModel!(liveModel([{ ...base, form: "CA" }, { ...base, form: "coaching" }], said, seen));
    await t.thread().say(said);
    const results = seen[0] ?? [];
    expect(results.slice(0, 2).map((result) => result.reason_code), JSON.stringify(results)).toEqual(["privacy_not_asked", "privacy_not_asked"]);
    const listed = results[2];
    expect(listed?.reason_code, `the call with evidence was not run: ${JSON.stringify(listed)}`).toBeUndefined();
    expect(JSON.stringify(listed), JSON.stringify(listed)).toContain("Liesel Cobb");
  })),
  fixed("nov20-forms-on-file-refusal-never-a-lookup-issue", "The model is taught that a refused tool is never told to the manager as a lookup problem or \"try again\", and find_past_forms' schema requires forms_on_file_evidence", async (t) => {
    let system = "";
    let required: unknown = null;
    t.loopModel!(loopStandIn((view): LoopDecision => {
      system = view.system;
      return { text: "Here's what's on file." };
    }));
    await t.thread().say("list ca for the month");
    const { agentLoopTools } = await import("@/lib/ai/agent-loop/run");
    required = (agentLoopTools().find((tool) => tool.name === "find_past_forms")?.input_schema as { required?: unknown } | undefined)?.required;
    expect(system).toMatch(/never tell the manager it was a lookup problem/i);
    expect(required).toEqual(["forms_on_file_evidence"]);
  }),
];
