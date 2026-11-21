import { randomUUID } from "node:crypto";

import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";
import { evidenceFrom, lastResult, loopStandIn, type LoopDecision } from "./loop-stand-in";

/**
 * ============================================================================
 * A CLOSE SPELLING NEVER OPENS SOMEONE'S FORM; ONE TYPED WORD NEVER MATCHES A TWO-WORD NAME (QA, 20 Nov 2026; high)
 * ============================================================================
 *
 * Live on main 2c8ec520 (conv_mwp0r3kv21hgh8w, after #1131): "show me forms for Tes" opened the draft of "Test Te" with no
 * question ("Opening Test Te's form…"). find_past_forms found no form under "Tes" and fell back to the one name on file
 * that the request spells closely (`closelySpelledEmployee`, REOPEN_CLOSE_SPELLING): the one typed word "tes" was one
 * letter from "test" AND from "te", so it counted for both words, and the one form was best_match. General rule: each
 * word of a name on file needs its own typed word to spell it closely; and on the agent loop a close spelling is only
 * ever a Did-you-mean question (Pau's ruling A), never a list or an open. Invented names: the form is filed under
 * "Rowe Ro" (nobody on the roster), and the manager types "Row" (as "Tes" for "Test Te") or "Rowa Ro".
 */

const FLAG = "AGENT_LOOP_ENABLED";
const REPORT = "QA's live re-test after #1131 (20 Nov 2026, conv_mwp0r3kv21hgh8w): \"show me forms for Tes\" opened \"Test Te\"'s draft";
const offline = process.env.AGENT_LOOP_LIVE !== "1";

type Found = { forms?: { employee?: string; instance_id?: string }[]; best_match?: string; did_you_mean?: string; ask_exactly?: string };

/** A draft CA filed under "Rowe Ro" (a name typed on a form, nobody on the roster): Remy Calder's card, renamed. */
async function onFile(t: ReplayContext): Promise<string> {
  vi.setSystemTime(new Date("2026-11-19T15:00:00Z"));
  t.directory([...STAFF]);
  t.as("salon_director", KEARNEY);
  t.loopModel!(loopStandIn((view): LoopDecision => (lastResult(view, "propose_form") ? { text: "Here's the card." } : { tool: "propose_form", input: { template_key: "dpoa", employee_id: "e-2", what_happened: "Late to open on 11/19.", incident_date: "2026-11-19" } })));
  const setup = t.thread();
  await setup.say("ca for remy calder, late to open on 11/19");
  const id = await setup.create();
  const rows = t.forms() as unknown as Record<string, unknown>[];
  const row = rows.find((entry) => entry.id === id)!;
  const rowe = randomUUID();
  rows.push({ ...row, id: rowe, employee_name: "Rowe Ro" });
  row.status = "finalized";
  vi.setSystemTime(new Date("2026-11-20T15:00:00Z"));
  return rowe;
}

/** The live model: find_past_forms with the typed name, then open_form on best_match when there is one. */
async function look(t: ReplayContext, said: string, typed: string) {
  const model = loopStandIn((view): LoopDecision => {
    const found = lastResult(view, "find_past_forms") as Found | null;
    if (!found) return { tool: "find_past_forms", input: { employee_name: typed, open: true, forms_on_file_evidence: evidenceFrom(view, said) } };
    if (found.best_match && !lastResult(view, "open_form")) return { tool: "open_form", input: { instance_id: found.best_match, forms_on_file_evidence: evidenceFrom(view, said) } };
    return { text: found.ask_exactly ?? (lastResult(view, "open_form") ? "Opening the form." : "There's nothing on file under that name.") };
  });
  t.loopModel!(model);
  const reply = await t.thread().say(said);
  return { found: lastResult(model.views.at(-1)!, "find_past_forms") as Found, opened: lastResult(model.views.at(-1)!, "open_form"), reply };
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

export const NOV20_AGENT_LOOP_FORMS_ON_FILE_CLOSE_SPELLING_ASKS_CASES: ReplayCase[] = [
  fixed("nov20-close-spelling-one-word-never-two-word-name", "Live shape: a draft filed under \"Rowe Ro\"; \"show me forms for Row\" (one word, a letter from both \"rowe\" and \"ro\") lists none of Rowe Ro's forms and opens nothing", async (t) => {
    const rowe = await onFile(t);
    const { found, opened, reply } = await look(t, "show me forms for Row", "Row");
    expect((found.forms ?? []).map((form) => form.instance_id), JSON.stringify(found)).not.toContain(rowe);
    expect(found.best_match).toBeUndefined();
    expect(opened, `a form was opened for a name nobody typed:\n${reply.content}`).toBeNull();
  }),
  fixed("nov20-close-spelling-asks-never-opens", "\"show me forms for Rowa Ro\" (a close spelling of the name on file, word for word): the reply asks \"Did you mean **Rowe Ro**?\"; no form is listed or opened", async (t) => {
    await onFile(t);
    const { found, opened } = await look(t, "show me forms for Rowa Ro", "Rowa Ro");
    expect(found.forms ?? [], JSON.stringify(found)).toEqual([]);
    expect(found.best_match).toBeUndefined();
    expect(found.ask_exactly ?? "").toMatch(/Did you mean \*\*Rowe Ro\*\*\?/);
    expect(opened).toBeNull();
  }),
];
