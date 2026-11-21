import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";
import { evidenceFrom, lastResult, loopStandIn, type LoopDecision } from "./loop-stand-in";

/**
 * ============================================================================
 * A PARTIAL NAME NEVER SEATS SOMEONE ON A CARD WITHOUT ASKING (board f110; QA handoff 22 Nov 2026, §7 Sunny 1)
 * ============================================================================
 *
 * #1160 (f065) made "show me forms for Tes" ask before opening "Test Te"'s form on file. The card side kept the old
 * match: find_staff (and propose_form's own lookup) took any typed word of 3+ letters that STARTS a roster name as that
 * person, so "a CA for Tes" seated "Tessa …" with no Did-you-mean. General rule (Pau's ruling A, as #1160): a typed word
 * names a roster person only when it is a whole first, preferred or last name; a word that is only the start of one is a
 * Did-you-mean question. Invented names: Rowan Kestrel is on the roster; the manager types "Row" (as "Tes").
 */

const FLAG = "AGENT_LOOP_ENABLED";
const REPORT = "QA handoff 22 Nov 2026 (board f110): partial names still match staff (as \"show me forms for Tes\", #1160, on the card side)";
const offline = process.env.AGENT_LOOP_LIVE !== "1";

type Found = { matches?: { employee_id?: string }[]; ask_exactly?: string; reason_code?: string };
type Proposed = { card?: unknown; employee_id?: string; ask_exactly?: string; reason_code?: string } | null;

/** The live model: find_staff with the typed name; one match → propose_form with its id; otherwise ask what find_staff says. */
async function ask(t: ReplayContext, said: string, typed: string, via: "find_staff" | "propose_form") {
  vi.setSystemTime(new Date("2026-11-22T15:00:00Z"));
  t.directory([...STAFF]);
  t.as("salon_director", KEARNEY);
  const model = loopStandIn((view): LoopDecision => {
    const proposed = lastResult(view, "propose_form") as Proposed;
    if (proposed) return { text: proposed.ask_exactly ?? "Here's the card." };
    if (via === "propose_form") return { tool: "propose_form", input: { template_key: "dpoa", employee_name: typed, person_evidence: evidenceFrom(view, said), what_happened: "Late to open on 11/21.", incident_date: "2026-11-21" } };
    const found = lastResult(view, "find_staff") as Found | null;
    if (!found) return { tool: "find_staff", input: { name: typed, person_evidence: evidenceFrom(view, said) } };
    const only = found.matches?.length === 1 ? found.matches[0]!.employee_id : undefined;
    if (only) return { tool: "propose_form", input: { template_key: "dpoa", employee_id: only, what_happened: "Late to open on 11/21.", incident_date: "2026-11-21" } };
    return { text: found.ask_exactly ?? "Who is this form for?" };
  });
  t.loopModel!(model);
  const reply = await t.thread().say(said);
  const last = model.views.at(-1)!;
  return { found: lastResult(last, "find_staff") as Found | null, proposed: lastResult(last, "propose_form") as Proposed, reply };
}

const fixed = (id: string, title: string, run: (t: ReplayContext) => Promise<void>): ReplayCase => ({
  id,
  title,
  report: REPORT,
  status: "fixed",
  fixFlags: [FLAG],
  async run(t) {
    if (!t.loopOn?.() || !offline) return;
    await run(t);
  },
});

export const NOV22_AGENT_LOOP_PARTIAL_NAME_ASKS_CASES: ReplayCase[] = [
  fixed("nov22-partial-name-whole-first-partial-last-asks", "\"ca for Rowan Kes, late to open on 11/21\" (a whole first name, the start of a last name): find_staff asks \"Did you mean **Rowan Kestrel**?\"; no card", async (t) => {
    const { found, proposed, reply } = await ask(t, "ca for Rowan Kes, late to open on 11/21", "Rowan Kes", "find_staff");
    expect(found?.matches ?? [], JSON.stringify(found)).toEqual([]);
    expect(found?.ask_exactly ?? "").toMatch(/Did you mean \*\*Rowan Kestrel\*\*\?/);
    expect(proposed, `a card was made for a partial name:\n${reply.content}`).toBeNull();
    expect(reply.formProposal ?? null).toBeNull();
  }),
  fixed("nov22-partial-name-two-partial-words-asks", "\"ca for Row Kes, late to open on 11/21\" (two partial words): find_staff gives no match and asks the Did-you-mean, never \"Who is this form for?\"", async (t) => {
    const { found, reply } = await ask(t, "ca for Row Kes, late to open on 11/21", "Row Kes", "find_staff");
    expect(found?.matches ?? [], JSON.stringify(found)).toEqual([]);
    expect(reply.content).toMatch(/Did you mean \*\*Rowan Kestrel\*\*\?/);
    expect(reply.formProposal ?? null).toBeNull();
  }),
  fixed("nov22-partial-name-propose-form-asks", "propose_form with employee_name \"Rowan Kes\" (its own lookup): no card, the Did-you-mean is handed back", async (t) => {
    const { proposed, reply } = await ask(t, "ca for Rowan Kes, late to open on 11/21", "Rowan Kes", "propose_form");
    expect(proposed?.card ?? null, JSON.stringify(proposed)).toBeNull();
    expect(proposed?.ask_exactly ?? "").toMatch(/Did you mean \*\*Rowan Kestrel\*\*\?/);
    expect(reply.formProposal ?? null).toBeNull();
  }),
  fixed("nov22-partial-name-whole-name-control", "Control: \"ca for Rowan, …\" and \"ca for Rowan Kestrel, …\" (whole names) still make Rowan Kestrel's card", async (t) => {
    for (const typed of ["Rowan", "Rowan Kestrel"]) {
      const { found, reply } = await ask(t, `ca for ${typed}, late to open on 11/21`, typed, "find_staff");
      expect((found?.matches ?? []).map((row) => row.employee_id), typed).toEqual(["e-4"]);
      expect(reply.formProposal?.employeeName, reply.content).toBe("Rowan Kestrel");
    }
  }),
];
