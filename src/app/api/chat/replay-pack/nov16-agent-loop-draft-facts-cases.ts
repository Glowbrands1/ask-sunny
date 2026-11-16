import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";
import { evidenceFrom, lastResult, loopStandIn, type LoopDecision, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * THE REPLY SAYS WHAT THE CODE DID, FROM FACTS (QA's live findings, 16 Nov 2026)
 * ============================================================================
 *
 * Two replies on production said what had not happened: "press Create when it looks right" about a change already saved
 * on a draft, and "I opened a new draft" when the draft revising a finalized form was already open and was reused.
 * edit_form now says what the change was saved on (form_state) and whether the revision draft was reused
 * (revision_draft.reused); the rules book words the reply from those facts. Invented people: Remy Calder.
 */

const FLAG = "AGENT_LOOP_ENABLED";
const REPORT = "QA's live findings, 16 Nov 2026 (production, main e2e92554): the reply must match what the code did";

type EditResult = { form_state?: string; revision_draft?: { id?: string; from_id?: string; reused?: boolean }; payroll_amount_missing?: { ask_exactly?: string }; error?: string } | null;

async function remyDraft(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-11-14T22:40:00Z"));
  t.directory([...STAFF]);
  t.as("salon_director", KEARNEY);
  t.loopModel!(loopStandIn((view): LoopDecision => {
    if (!lastResult(view, "find_staff")) return { tool: "find_staff", input: { name: "remy calder" } };
    if (!lastResult(view, "propose_form")) return { tool: "propose_form", input: { template_key: "dpoa", employee_id: "e-2", what_happened: "Remy Calder was 20 minutes late on 11/12.", incident_date: "2026-11-12" } };
    return { text: "Here's the Corrective Action Form for **Remy Calder**." };
  }));
  const thread = t.thread();
  await thread.say("ca for remy calder, she was 20 minutes late on 11/12");
  return { thread, id: await thread.create() };
}

/** A stand-in that makes the edit, then words the reply from edit_form's facts only. */
function editing(instanceId: () => string, values: Record<string, string>, seen: EditResult[], askedQuote?: string) {
  return loopStandIn((view: LoopView): LoopDecision => {
    const result = lastResult(view, "edit_form") as EditResult;
    // A form that is not open on screen needs the manager's own ask (the privacy rule's forms_on_file_evidence).
    if (!result) return { tool: "edit_form", input: { instance_id: instanceId(), values, ...(askedQuote ? { forms_on_file_evidence: evidenceFrom(view, askedQuote) } : {}) } };
    seen.push(result);
    if (result.revision_draft) return { text: result.revision_draft.reused ? "I made the change on the draft that already revises the finalized form; the original is unchanged." : "I opened a new draft that revises the finalized form; the original is unchanged." };
    return { text: result.form_state === "saved_draft" ? "It's saved on the draft." : "The card above is still open; press Create when it looks right." };
  });
}

export const NOV16_AGENT_LOOP_DRAFT_FACTS_CASES: ReplayCase[] = [
  {
    id: "nov16-draft-facts-saved-draft-never-press-create",
    title: "A change on a saved draft (\"change the date on that CA to 11/13\"): edit_form says form_state saved_draft, so the reply says it's saved on the draft and never \"press Create\"; the rules book teaches it",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      const { thread, id } = await remyDraft(t);
      const seen: EditResult[] = [];
      const model = editing(() => id, { form_date: "11/13" }, seen);
      t.loopModel!(model);
      const reply = await thread.say("change the date on that CA to 11/13");
      expect(seen.at(-1)?.form_state, JSON.stringify(seen.at(-1))).toBe("saved_draft");
      expect(reply.content).not.toMatch(/press Create/i);
      expect(model.views[0]?.system).toMatch(/form_state says what the change was saved on[^"]*"It's saved on the draft\."[^.]*Never tell the manager to press Create/);
    },
  },
  {
    id: "nov16-draft-facts-revision-draft-reused-not-new",
    title: "Two changes to a finalized form: the first opens a revision draft (reused false, \"I opened a new draft\"); the second goes on that same draft (reused true) and the reply never says a new draft was opened",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      const { thread, id } = await remyDraft(t);
      t.draftWrites({ observation: "Observed:\nRemy Calder was 20 minutes late on 11/12." }, { warning_type: ["verbal"] });
      Object.assign(t.forms().find((row) => row.id === id)!, { status: "finalized", form_date: "2026-11-12" });
      const seen: EditResult[] = [];
      t.loopModel!(editing(() => id, { form_date: "11/13" }, seen));
      const first = await thread.say("change the date on that CA to 11/13");
      t.loopModel!(editing(() => id, { form_date: "11/11" }, seen, "the finalized one"));
      const second = await thread.say("actually change the date on the finalized one to 11/11");
      expect(seen[0]?.revision_draft?.reused, JSON.stringify(seen[0])).toBe(false);
      expect(first.content).toMatch(/opened a new draft/);
      // The screen's copy of the id is a UUID (the route takes only UUIDs for the open form), so count the drafts instead.
      expect(t.forms().filter((row) => row.status === "draft").length, "the second change opened another revision").toBe(1);
      expect(seen.at(-1)?.revision_draft?.reused, JSON.stringify(seen.at(-1))).toBe(true);
      expect(second.content, "a reused draft was called new").not.toMatch(/opened a new draft/);
    },
  },
];

/*
 * QA's live finding (16 Nov 2026, case B): "tick payroll deduct" saved Payroll = Yes, and the reply said "Is payroll
 * deduct applicable? Yes, as you said." without asking the amount. edit_form now says payroll_amount_missing (read from
 * the saved form) with the one question to ask; with the amount given, no such fact.
 */
NOV16_AGENT_LOOP_DRAFT_FACTS_CASES.push(
  ...([
    ["no-amount", "tick payroll deduct", { payroll_deduct: "yes" }, true],
    ["with-amount", "tick payroll deduct, $15", { payroll_deduct: "yes", payroll_deduct_amount: "15" }, false],
  ] as const).map(([tag, words, values, missing]): ReplayCase => ({
    id: `nov16-draft-facts-payroll-yes-asks-the-amount-${tag}`,
    title: `"${words}" on a saved CA draft: payroll is saved as Yes, and edit_form ${missing ? "says payroll_amount_missing, so the reply asks the amount in one question" : "says nothing is missing (the amount was given)"}`,
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      const { thread, id } = await remyDraft(t);
      const seen: EditResult[] = [];
      t.loopModel!(loopStandIn((view: LoopView): LoopDecision => {
        const result = lastResult(view, "edit_form") as EditResult;
        if (!result) return { tool: "edit_form", input: { instance_id: id, values, payroll_evidence: evidenceFrom(view, words) } };
        seen.push(result);
        return { text: ["**Is payroll deduct applicable?** Yes, as you said.", result.payroll_amount_missing?.ask_exactly].filter(Boolean).join("\n\n") };
      }));
      const reply = await thread.say(words);
      expect(t.checked(id).payroll_deduct, JSON.stringify(seen.at(-1))).toEqual(["yes"]);
      if (missing) {
        expect(seen.at(-1)?.payroll_amount_missing?.ask_exactly, JSON.stringify(seen.at(-1))).toMatch(/Payroll deduction amount/);
        expect(reply.content).toMatch(/Payroll deduction amount\*\*\?/);
      } else {
        expect(seen.at(-1)?.payroll_amount_missing, JSON.stringify(seen.at(-1))).toBeUndefined();
      }
    },
  })),
);

/*
 * QA's live finding (16 Nov 2026): "as you said" was said for a value the turn did not state. propose_form and edit_form
 * now list stated_this_turn: the level and payroll whose evidence is the message being answered now. A level stated in
 * the first message and read back on the card the next turn rebuilt is read back without "as you said".
 */
NOV16_AGENT_LOOP_DRAFT_FACTS_CASES.push({
  id: "nov16-draft-facts-as-you-said-only-this-turn",
  title: "\"written warning for Remy Calder, she was late to her shift on 11/14\" then \"no payroll\": the first card's stated_this_turn has the level; the second card's has payroll only, so the level is read back without \"as you said\"",
  report: REPORT,
  status: "fixed",
  fixFlags: [FLAG],
  async run(t) {
    if (!t.loopOn?.()) return;
    vi.setSystemTime(new Date("2026-11-14T22:40:00Z"));
    t.directory([...STAFF]);
    t.as("salon_director", KEARNEY);
    const facts: { stated_this_turn?: string[] }[] = [];
    t.loopModel!(loopStandIn((view: LoopView): LoopDecision => {
      const managerTurns = view.turns.filter((turn) => turn.role === "user").length;
      const card = lastResult(view, "propose_form") as { facts?: { stated_this_turn?: string[] } } | null;
      if (!lastResult(view, "find_staff")) return { tool: "find_staff", input: { name: "Remy Calder" } };
      if (!card) {
        return {
          tool: "propose_form",
          input: {
            template_key: "dpoa",
            employee_id: "e-2",
            warning_level: "written",
            level_evidence: evidenceFrom(view, "written warning", managerTurns === 1 ? 0 : 1),
            ...(managerTurns > 1 ? { payroll_deduct: "no", payroll_evidence: evidenceFrom(view, "no payroll") } : {}),
            what_happened: "She was late to her shift on 11/14.",
            incident_date: "2026-11-14",
          },
        };
      }
      facts.push(card.facts ?? {});
      const said = (field: string) => (card.facts?.stated_this_turn ?? []).includes(field);
      return { text: ["Here's the Corrective Action Form for **Remy Calder**.", `**Type of Warning:** Written Warning${said("warning_level") ? ", as you said" : ""}.`, managerTurns > 1 ? `**Is payroll deduct applicable?** No${said("payroll_deduct") ? ", as you said" : ""}.` : ""].filter(Boolean).join("\n") };
    }));
    const thread = t.thread();
    const first = await thread.say("written warning for Remy Calder, she was late to her shift on 11/14");
    const second = await thread.say("no payroll");
    expect(facts[0]?.stated_this_turn, JSON.stringify(facts[0])).toEqual(["warning_level"]);
    expect(first.content).toMatch(/Written Warning, as you said/);
    expect(facts[1]?.stated_this_turn, JSON.stringify(facts[1])).toEqual(["payroll_deduct"]);
    expect(second.content, "the level from the first message was called \"as you said\"").toMatch(/Written Warning\.\n/);
    expect(second.content).toMatch(/No, as you said/);
  },
});
