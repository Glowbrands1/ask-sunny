import { expect, vi } from "vitest";

import { BEHAVIOURS, TESTY, TESTY_ACCOUNT, type Behaviour, type Phrasing } from "@/lib/ai/agent-loop/phrasing-table";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayCase, type ReplayContext, type ReplayThread } from "./cases";
import { evidenceFrom, lastResult, loopStandIn, type LoopDecision } from "./loop-stand-in";

/**
 * ============================================================================
 * PHRASING (QA's audit, 15 Nov 2026): THE SAME BEHAVIOUR, HOWEVER THE MANAGER TYPES IT
 * ============================================================================
 *
 * One case per behaviour per phrasing (`phrasing-table.ts`). The mocked model returns the SAME structured tool
 * arguments for every phrasing of a behaviour (as a model reading a request would); the code must then end in the
 * same outcome, asserted on saved data and structured tool results, never on an English phrase.
 *
 * TODO(PR1): the tools still read some phrasings with word lists (tools.ts WRITE_ACCOUNT_REQUEST, NAME_CORRECTION,
 * LEVEL_OR_PAYROLL_ANSWER, EXIT_ASKED, ASKS_ABOUT_FORMS), so a phrasing the list misses ends differently. Each such
 * phrasing is listed in `OPEN_UNTIL_PR1` and runs as an expected failure; PR 1 (evidence arguments, Coding-7)
 * removes the lists, and each entry is deleted in the same pull request as it starts to pass.
 */

const FLAG = "AGENT_LOOP_ENABLED";
const REPORT = "QA's audit (15 Nov 2026): the same request in different phrasings must end the same way";

const TEST_TESTY: DirectoryRow = { id: TESTY.id, firstName: TESTY.firstName, lastName: TESTY.lastName, preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0309"], positionName: "Tanning Consultant" };

/** The phrasings that end differently today, by case id: filled from the first run; PR 1 empties it. */
export const OPEN_UNTIL_PR1: Readonly<Record<string, string>> = {
};

const latest = (turns: readonly { role: string; text: string }[]) => [...turns].reverse().find((turn) => turn.role === "user")?.text ?? "";

const corrective = () => "dpoa";
const exitKey = () => "stc-exit";

async function setup(t: ReplayContext): Promise<void> {
  vi.setSystemTime(new Date("2026-11-13T22:40:00Z"));
  t.directory([...STAFF, TEST_TESTY]);
  t.as("salon_director", KEARNEY);
}

/** The card for Test Testy's Corrective Action, with the account on it (the mocked model's decision, every phrasing). */
const cardModel = (extra: Record<string, unknown> = {}) =>
  loopStandIn((view): LoopDecision => {
    if (!lastResult(view, "propose_form")) return { tool: "propose_form", input: { template_key: corrective(), employee_id: TESTY.id, what_happened: TESTY_ACCOUNT, ...extra } };
    return { text: "Here's the card." };
  });

/** A created draft with the account written and a written warning, then the draft's state to compare against. */
async function draft(t: ReplayContext, extra: Record<string, unknown> = {}): Promise<{ thread: ReplayThread; id: string }> {
  await setup(t);
  t.loopModel!(cardModel(extra));
  const thread = t.thread();
  await thread.say("ca for test testy, she was late to open the salon on 11/10");
  const id = await thread.create();
  return { thread, id };
}

/** A created draft whose level was set to written by a plain answer (the phrasing that works today), then its state. */
async function writtenDraft(t: ReplayContext): Promise<{ thread: ReplayThread; id: string }> {
  const { thread, id } = await draft(t);
  t.loopModel!(loopStandIn((view): LoopDecision => (lastResult(view, "edit_form") ? { text: "Done." } : { tool: "edit_form", input: { instance_id: id, values: { warning_type: "written" }, level_evidence: evidenceFrom(view) } })));
  await thread.say("make it a written");
  expect(t.checked(id).warning_type, "the setup draft is not a written").toEqual(["written"]);
  return { thread, id };
}

type Script = (t: ReplayContext, said: string) => Promise<void>;

const SCRIPTS: Record<Behaviour["key"], Script> = {
  "write-account": async (t, said) => {
    const { thread, id } = await draft(t);
    t.typeOnForm(id, { observation: "" });
    t.loopModel!(loopStandIn((view): LoopDecision => (lastResult(view, "edit_form") ? { text: "Done." } : { tool: "edit_form", input: { instance_id: id, values: { observation: TESTY_ACCOUNT } } })));
    await thread.say(said);
    expect(t.values(id).observation, "the account was not written onto the draft").toBe(TESTY_ACCOUNT);
  },
  "answer-level": async (t, said) => {
    await setup(t);
    t.loopModel!(loopStandIn((view): LoopDecision => {
      const text = latest(view.turns);
      if (!lastResult(view, "propose_form")) return { tool: "propose_form", input: { template_key: corrective(), employee_id: TESTY.id, what_happened: TESTY_ACCOUNT, ...(text === said ? { warning_level: "written" } : {}) } };
      return { text: "Here's the card." };
    }));
    const thread = t.thread();
    await thread.say("ca for test testy, she was late to open the salon on 11/10");
    await thread.say(said);
    expect(thread.proposal?.warningLevel, "the answered level is not on the card").toBe("written");
  },
  "answer-payroll": async (t, said) => {
    await setup(t);
    t.loopModel!(loopStandIn((view): LoopDecision => {
      const text = latest(view.turns);
      if (!lastResult(view, "propose_form")) return { tool: "propose_form", input: { template_key: corrective(), employee_id: TESTY.id, what_happened: TESTY_ACCOUNT, ...(text === said ? { payroll_deduct: "yes", payroll_amount: "20", payroll_evidence: evidenceFrom(view) } : {}) } };
      return { text: "Here's the card." };
    }));
    const thread = t.thread();
    await thread.say("ca for test testy, she was late to open the salon on 11/10");
    await thread.say(said);
    expect(thread.proposal as unknown).toMatchObject({ payrollDeduct: "yes", payrollDeductAmount: "20" });
  },
  "fix-name": async (t, said) => {
    // PR 1 (the rebuild plan): a name correction is edit_form intent "correct_name" with name_evidence quoting the new
    // name from this message, and QA's ruling 2: the form's reviser never changes the name. TODO(QA): the form's writer
    // refuses employee_name ("system fields are not drafted"), so today every phrasing ends the same way: the name write
    // is refused and nothing on the draft changes. Saving the corrected name needs a writer decision.
    const { thread, id } = await draft(t);
    const before = t.values(id);
    const editor = loopStandIn((view): LoopDecision => (lastResult(view, "edit_form") ? { text: "Done." } : { tool: "edit_form", input: { instance_id: id, intent: "correct_name", values: { employee_name: `${TESTY.firstName} ${TESTY.corrected}` }, name_evidence: evidenceFrom(view, TESTY.corrected) } }));
    t.loopModel!(editor);
    await thread.say(said);
    const result = editor.views.at(-1)!.results.find((entry) => entry.tool === "edit_form")?.output as { refused?: { field: string }[]; reason_code?: string } | undefined;
    expect(result?.reason_code, "the name evidence was refused (the quote holds the new name in every phrasing)").toBeUndefined();
    expect(result?.refused?.map((row) => row.field), "the name write was not reported refused").toEqual(["employee_name"]);
    expect(t.values(id), "a name correction changed the draft").toEqual(before);
  },
  "exit-form": async (t, said) => {
    await setup(t);
    t.loopModel!(loopStandIn((view): LoopDecision => {
      if (!lastResult(view, "propose_form")) return { tool: "propose_form", input: { template_key: exitKey(), employee_id: TESTY.id, exit_type: "resignation", exit_evidence: evidenceFrom(view) } };
      return { text: "Here's the card." };
    }));
    const thread = t.thread();
    await thread.say(said);
    expect(thread.proposal?.templateKey, "no Employee Exit Form card").toBe(exitKey());
    expect(thread.proposal?.employeeName).toBe(`${TESTY.firstName} ${TESTY.lastName}`);
  },
  "forms-on-file": async (t, said) => {
    await draft(t);
    const asker = loopStandIn((view): LoopDecision => (lastResult(view, "find_past_forms") ? { text: "Here is what is on file." } : { tool: "find_past_forms", input: { employee_name: `${TESTY.firstName} ${TESTY.lastName}`, forms_on_file_evidence: evidenceFrom(view) } }));
    t.loopModel!(asker);
    const thread = t.thread();
    const reply = await thread.say(said);
    const result = asker.views.flatMap((view) => view.results).find((entry) => entry.tool === "find_past_forms")?.output ?? {};
    expect(Array.isArray(result.forms) ? (result.forms as unknown[]).length : 0, "the forms on file were not handed back").toBeGreaterThan(0);
    expect(result.error, "the forms-on-file request was refused").toBeUndefined();
    expect(thread.proposal, "a card for a question about forms on file").toBeNull();
    expect(reply.formUpdate, "a question about forms on file changed a form").toBeUndefined();
  },
  "undo-level": async (t, said) => {
    const { thread, id } = await writtenDraft(t);
    t.loopModel!(loopStandIn((view): LoopDecision => (lastResult(view, "edit_form") ? { text: "Done." } : { tool: "edit_form", input: { instance_id: id, values: { warning_type: "verbal" }, level_evidence: evidenceFrom(view) } })));
    await thread.say(said);
    expect(t.checked(id).warning_type, "the level was not taken back to verbal").toEqual(["verbal"]);
  },
  "nothing-changed": async (t, said) => {
    const { thread, id } = await writtenDraft(t);
    const before = JSON.stringify({ values: t.values(id), checked: t.checked(id) });
    t.loopModel!(loopStandIn((view): LoopDecision => (lastResult(view, "edit_form") ? { text: "That is already the level." } : { tool: "edit_form", input: { instance_id: id, values: { warning_type: "written" }, level_evidence: evidenceFrom(view) } })));
    await thread.say(said);
    expect(JSON.stringify({ values: t.values(id), checked: t.checked(id) }), "asking for the level the draft already has changed the draft").toBe(before);
  },
};

export const caseId = (behaviour: Behaviour, index: number): string => `nov15-phrasing-${behaviour.key}-${index + 1}`;

function caseFor(behaviour: Behaviour, phrasing: Phrasing, index: number): ReplayCase {
  const id = caseId(behaviour, index);
  const open = OPEN_UNTIL_PR1[id];
  return {
    id,
    title: `phrasing (${behaviour.key}, ${phrasing.kind}): the outcome is the one every phrasing of this behaviour ends in`,
    report: `${REPORT}; ${behaviour.what}; the manager types "${phrasing.said}"`,
    // Production's flags already carry AGENT_LOOP_ENABLED (the loop answers listed users only), so both runs use the loop.
    status: open ? { open } : "fixed",
    fixFlags: [FLAG],
    ...(open ? { fixStatus: { open } } : {}),
    async run(t) {
      if (!t.loopOn?.()) return;
      await SCRIPTS[behaviour.key](t, phrasing.said);
    },
  };
}

export const NOV15_AGENT_LOOP_PHRASING_CASES: ReplayCase[] = BEHAVIOURS.flatMap((behaviour) => behaviour.phrasings.map((phrasing, index) => caseFor(behaviour, phrasing, index)));
