import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayCase, type ReplayContext, type ReplayThread } from "./cases";
import { lastResult, loopStandIn, type LoopDecision, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * THIS MORNING'S SILENT-FAILURE SCAN (QA, 15 Nov 2026): A CA CHAT ON TODAY'S APP, AND THE LOOP'S ANSWER
 * ============================================================================
 *
 * Pau: "Using the AI loop, I hope we don't have these mistakes going forward. Sunny first." The manager's exact
 * words, with the employee swapped for QA's invented "Wren Halloway". Today's app read the Action Plan instruction as
 * a policy name, said "I haven't changed the form" to the Termination question and to the account sent again, and
 * these cases hold the loop to what it must do instead (batch G: G8, G9, G10, G11, G13).
 */

const FLAG = "AGENT_LOOP_ENABLED";
const REPORT = "QA's silent-failure scan (15 Nov 2026), a production Corrective Action chat";

const WREN: DirectoryRow = { id: "e-wren-halloway", firstName: "Wren", lastName: "Halloway", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0309"], positionName: "Tanning Consultant" };

const T1 = "create corrective action for Wren Halloway";
const T2 = "Wren did not complete the daily cleaning checklist on Saturday (11.07.2026) and Sunday (11.08.2026)";
const T4 = "under the type of warning drop down box I can't select Termination.";
const T8 = "Action Plan: Violation of Company policy has resulted in immediate termination of employment.";
const T9 = "The action plan section of the form needs to reflect the following verbage: Violation of Company policy has resulted in immediate termination of employment.";
const T10 = "change date of document to 11-15-2026";
const PLAN = "Violation of Company policy has resulted in immediate termination of employment.";
const ACCOUNT = "Wren did not complete the daily cleaning checklist on Saturday (11.07.2026) and Sunday (11.08.2026).";

const latest = (view: LoopView) => [...view.turns].reverse().find((turn) => turn.role === "user")?.text ?? "";
const toolResults = (views: readonly LoopView[], tool: string) => views.flatMap((view) => view.results.filter((result) => result.tool === tool)).map((result) => JSON.stringify(result.output));
const offline = process.env.AGENT_LOOP_LIVE !== "1";

/** t1 and t2, then Create: Wren's Corrective Action draft, open, with the account as the manager wrote it. */
async function wrensDraft(t: ReplayContext): Promise<{ thread: ReplayThread; id: string }> {
  vi.setSystemTime(new Date("2026-11-13T22:00:00Z"));
  t.directory([...STAFF, WREN]);
  t.as("salon_director", KEARNEY);
  t.loopModel!(loopStandIn((view): LoopDecision => {
    if (!lastResult(view, "find_staff")) return { tool: "find_staff", input: { name: "Wren Halloway" } };
    if (/daily cleaning checklist/.test(latest(view)) && !lastResult(view, "propose_form")) return { tool: "propose_form", input: { template_key: "dpoa", employee_id: WREN.id, what_happened: ACCOUNT } };
    if (!lastResult(view, "propose_form")) return { tool: "propose_form", input: { template_key: "dpoa", employee_id: WREN.id } };
    return { text: "Here's the Corrective Action Form for **Wren Halloway**." };
  }));
  const thread = t.thread();
  await thread.say(T1);
  await thread.say(T2);
  const id = await thread.create();
  t.typeOnForm(id, { observation: ACCOUNT });
  return { thread, id };
}

export const NOV15_AGENT_LOOP_SILENT_FAILURE_CASES: ReplayCase[] = [
  {
    id: "nov15-silent-g8-action-plan-instruction-is-the-field",
    title: "G8: \"Action Plan: Violation of Company policy has resulted in immediate termination of employment.\" writes that Action Plan, never a policy lookup; so does \"The action plan section of the form needs to reflect the following verbage: …\"",
    report: `${REPORT}: t8 and t9 got "I couldn't find a section called 'violation of company'" and nothing changed`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      const { thread, id } = await wrensDraft(t);
      const model = loopStandIn((view): LoopDecision => {
        if (!lastResult(view, "edit_form")) return { tool: "edit_form", input: { instance_id: id, values: { action_plan: PLAN } } };
        return { text: `Updated the Action Plan: ${PLAN}` };
      });
      t.loopModel!(model);
      for (const turn of [T8, T9]) {
        const reply = await thread.say(turn);
        // Pau's approval (15 Nov 2026): a plan ending in a stated termination keeps no future-violations closing.
        expect(t.values(id).action_plan ?? "", `the Action Plan is not the manager's text after "${turn}":\n${reply.content}`).toBe(PLAN);
        expect(reply.content, "the instruction was read as a policy name").not.toMatch(/couldn't find a section/i);
      }
      if (offline) expect(model.views.some((view) => view.results.some((result) => result.tool === "read_policy" || result.tool === "search_knowledge")), "an Action Plan instruction became a policy lookup").toBe(false);
    },
  },
  {
    id: "nov15-silent-g9-cant-select-termination",
    title: "G9: \"under the type of warning drop down box I can't select Termination.\" is a question about the form and changes nothing, before or after the termination Action Plan; \"make it a termination\" ticks it with the DM/HR approval line",
    report: `${REPORT}: t4 got "I haven't changed the form."`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      const { thread, id } = await wrensDraft(t);
      // Asked alone (no termination stated yet): a question about the form, nothing written.
      const model = loopStandIn((view): LoopDecision => {
        const said = latest(view);
        const edit = lastResult(view, "edit_form") as { error?: string; termination_approval_line?: string } | null;
        if (/Action Plan:/.test(said)) return lastResult(view, "edit_form") ? { text: `Updated the Action Plan: ${PLAN}` } : { tool: "edit_form", input: { instance_id: id, values: { action_plan: PLAN } } };
        /*
         * QA's design (15 Nov 2026): the model decides. T4 carries the word "Termination", so the lock alone would pass
         * it; the rules book teaches that "I can't select Termination" is a question about the form, and the model
         * answers it and changes nothing. "make it a termination" says it, so the model sets it.
         */
        if (said === T4) return { text: "To pick Termination, open the Type of Warning box on the form; tell me if this form is a termination and I'll set it." };
        if (!edit) return { tool: "edit_form", input: { instance_id: id, values: { warning_type: "termination" } } };
        return { text: edit.error ? "To pick Termination, open the Type of Warning box on the form; tell me if this form is a termination and I'll set it." : `**Type of Warning:** Termination, as you said. ${edit.termination_approval_line ?? ""}` };
      });
      t.loopModel!(model);
      await thread.say(T4);
      expect(t.checked(id).warning_type ?? [], "Termination was ticked without the manager stating a termination").not.toContain("termination");
      await thread.say(T8);
      /*
       * Changed on purpose (QA's review of batch G, 15 Nov 2026, item 1): edit_form ticks Termination only when THIS
       * message states it, so T4 after the plan is still a question about the form; the manager saying it ticks it.
       */
      await thread.say(T4);
      expect(t.checked(id).warning_type ?? [], "T4 alone ticked Termination from an earlier turn").not.toContain("termination");
      const reply = await thread.say("make it a termination");
      expect(t.checked(id).warning_type, `Termination was not ticked:\n${reply.content}`).toEqual(["termination"]);
      expect(reply.content, "no DM/HR approval line").toMatch(/Termination needs your DM\/HR approval before you finalize\./);
      expect(reply.content).not.toMatch(/haven't changed the form/i);
    },
  },
  {
    id: "nov15-silent-g10-account-sent-again",
    title: "G10: the same account sent again with the draft open (t5) says it is already on the form, and nothing is written twice",
    report: `${REPORT}: t5 (t2 sent again) got "I haven't changed the form"`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      const { thread, id } = await wrensDraft(t);
      const before = t.values(id).observation;
      t.loopModel!(loopStandIn((view): LoopDecision => {
        const read = lastResult(view, "read_form") as { values?: { observation?: { untrusted_text?: string } } } | null;
        if (!read) return { tool: "read_form", input: { instance_id: id } };
        return { text: `That's already on the form: "${read.values?.observation?.untrusted_text ?? ""}"` };
      }));
      const reply = await thread.say(T2);
      expect(t.values(id).observation, "the account was written twice").toBe(before);
      expect(reply.content, `the reply does not say it is already on the form:\n${reply.content}`).toMatch(/already on the form/i);
    },
  },
  {
    id: "nov15-silent-g11-document-date-the-manager-sets",
    title: "G11: \"change date of document to 11-15-2026\" sent at 7:35 PM CT on 11/13 is refused (after today, on a Corrective Action) with one question; the same message with a date not after today sets the document's date",
    report: `${REPORT}: t10, a document date the manager set after today`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      const { thread, id } = await wrensDraft(t);
      vi.setSystemTime(new Date("2026-11-14T01:35:00Z")); // 7:35 PM Central on 11/13
      const before = t.values(id).form_date ?? "";
      const model = (date: string) => loopStandIn((view): LoopDecision => {
        const edit = lastResult(view, "edit_form") as { error?: string } | null;
        if (!edit) return { tool: "edit_form", input: { instance_id: id, values: { form_date: date } } };
        return { text: edit.error ? "11/15/2026 is after today, so I didn't change the date. Which day should it be?" : "Dated 11/12/2026, as you asked." };
      });
      /*
       * Changed on purpose (QA's design, 15 Nov 2026, item D): on a Corrective Action or Coaching form, form_date after
       * today is always refused with one question, however the message names it.
       */
      t.loopModel!(model("2026-11-15"));
      const reply = await thread.say(T10);
      expect(t.values(id).form_date ?? "", `a document date after today was written:\n${reply.content}`).toBe(before);
      expect(reply.content).toMatch(/after today.*Which day/);
      t.loopModel!(model("2026-11-12"));
      await thread.say("change date of document to 11-12-2026");
      expect(t.values(id).form_date ?? "", "the manager's own document date was not written").toBe("2026-11-12");
    },
  },
  {
    id: "nov15-silent-g13-new-facts-with-a-tone-ask",
    title: "G13 (the sibling app's chat, fixed in this loop first): new examples, then \"take what i said but use it in a more professional tone\": every example is on the card, only the rewording is declined, and payroll is not asked again",
    report: `${REPORT}; the sibling app's chat: the card kept only the first sentence and asked payroll again`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      vi.setSystemTime(new Date("2026-11-14T22:40:00Z"));
      t.directory([...STAFF, WREN]);
      t.as("salon_director", KEARNEY);
      const first = "Wren Halloway left the front desk unattended on 11/10.";
      const all = `${first} She also skipped the bed sanitation on 11/11. On 11/12 she left early without telling anyone.`;
      const model = loopStandIn((view): LoopDecision => {
        const said = latest(view);
        const proposed = lastResult(view, "propose_form") as { reword_paused?: boolean } | null;
        if (!lastResult(view, "find_staff")) return { tool: "find_staff", input: { name: "Wren Halloway" } };
        if (/professional tone/.test(said)) {
          if (!proposed) return { tool: "propose_form", input: { template_key: "dpoa", employee_id: WREN.id, what_happened: all, payroll_deduct: "no" } };
          return { text: `Here's the Corrective Action Form for **Wren Halloway**, with all three examples.\n\n**Observation of Offense:** ${all}\n\nRewording isn't available yet. Tell me exactly what to change and I'll update it.` };
        }
        if (!proposed) return { tool: "propose_form", input: { template_key: "dpoa", employee_id: WREN.id, what_happened: first, ...(/no payroll/.test(said) ? { payroll_deduct: "no" } : {}) } };
        return { text: `Here's the Corrective Action Form for **Wren Halloway**.\n\n**Observation of Offense:** ${first}` };
      });
      t.loopModel!(model);
      const thread = t.thread();
      await thread.say("ca for wren halloway, she left the front desk unattended on 11/10, no payroll deduct");
      const reply = await thread.say("she also skipped the bed sanitation on 11/11. on 11/12 she left early without telling anyone. take what i said but use it in a more professional tone");
      expect(thread.proposal?.issue ?? "", `an example was dropped:\n${reply.content}`).toMatch(/front desk[\s\S]*bed sanitation[\s\S]*left early/);
      expect(reply.content, "the rewording part was not declined").toMatch(/Rewording isn't available yet/);
      expect(reply.content, "payroll was asked again").not.toMatch(/payroll deduct (?:isn't set|applicable\?)|tell me if (?:payroll|it) applies/i);
    },
  },
  {
    id: "nov15-silent-g19-termination-on-the-card",
    title: "G19 (Pau's P15 ruling A on the loop's card): \"Create a CA for <A>, we're terminating her for the no call no show\": the card says Termination, as you said, with the DM/HR approval line, and Create ticks Termination; a hedge leaves the level empty",
    report: `${REPORT}; QA: the loop's card said "Warning level isn't set" while Create ticked Termination`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      vi.setSystemTime(new Date("2026-11-14T22:40:00Z"));
      t.directory([...STAFF, WREN]);
      t.as("salon_director", KEARNEY);
      const model = loopStandIn((view): LoopDecision => {
        const result = lastResult(view, "propose_form") as { facts?: { termination_stated?: { approval: string; plan_closing: string } } } | null;
        if (!lastResult(view, "find_staff")) return { tool: "find_staff", input: { name: "Wren Halloway" } };
        // QA's design (15 Nov 2026): the model decides this form is a termination (not a hedge); the tool locks it on the word.
        if (!result) return { tool: "propose_form", input: { template_key: "dpoa", employee_id: WREN.id, what_happened: "Wren Halloway was a no call no show.", ...(/might terminate/.test(latest(view)) ? {} : { warning_level: "termination" }) } };
        const stated = result.facts?.termination_stated;
        return {
          text: stated
            ? `Here's the Corrective Action Form for **Wren Halloway**.\n\n**Type of Warning:** Termination, as you said — I'll tick it on the form. Tell me if that should change.\n${stated.approval}\n\n**Action Plan:** Create builds the plan from the policy; it ends with: ${stated.plan_closing}\n\n**Observation of Offense:** Wren Halloway was a no call no show.`
            : "Here's the Corrective Action Form for **Wren Halloway**.\n\nYou'll tick Termination on the form yourself; it needs DM/HR approval before it's finalized.\n\n**Observation of Offense:** Wren Halloway was a no call no show.",
        };
      });
      t.loopModel!(model);
      const thread = t.thread();
      const reply = await thread.say("Create a CA for Wren Halloway, we're terminating her for the no call no show");
      // Changed on purpose (QA, 15 Nov: G19 folded into H12's one termination_stated fact, { approval, plan_closing }, and its rules line).
      expect(reply.content, `the card does not say Termination:\n${reply.content}`).toMatch(/\*\*Type of Warning:\*\* Termination, as you said/);
      expect(reply.content, "a termination card promised future violations").not.toMatch(/Future policy violations/);
      expect(reply.content).toMatch(/Termination needs your DM\/HR approval before you finalize\./);
      const id = await thread.create();
      expect(t.checked(id).warning_type, "Create did not tick Termination: the card and the form disagree").toEqual(["termination"]);
      // A hedge: no level, one line.
      t.loopModel!(model);
      const hedge = t.thread();
      const answer = await hedge.say("Create a CA for Wren Halloway, we might terminate her if this continues, she was a no call no show");
      expect(answer.content, "a hedge was carded as a termination").not.toMatch(/Termination, as you said/);
      expect(answer.content).toContain("You'll tick Termination on the form yourself; it needs DM/HR approval before it's finalized.");
    },
  },
  {
    id: "nov15-silent-g19-termination-with-the-date",
    title: "G19 (QA's addition): \"create a termination for <A>, she no call no showed on 11/12\": a Corrective Action card dated 11/12, Type of Warning: Termination, as you said, with the DM/HR approval line, and Create ticks Termination",
    report: `${REPORT}; QA's addition 1 to G19 (15 Nov 2026)`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      vi.setSystemTime(new Date("2026-11-14T22:40:00Z"));
      t.directory([...STAFF, WREN]);
      t.as("salon_director", KEARNEY);
      const model = loopStandIn((view): LoopDecision => {
        const result = lastResult(view, "propose_form") as { facts?: { termination_stated?: { approval: string; plan_closing: string } } } | null;
        if (!lastResult(view, "find_staff")) return { tool: "find_staff", input: { name: "Wren Halloway" } };
        // QA's design (15 Nov 2026): the model decides this form is a termination; the tool locks it on the word.
        if (!result) return { tool: "propose_form", input: { template_key: "dpoa", employee_id: WREN.id, what_happened: "Wren Halloway was a no call no show on 11/12.", incident_date: "2026-11-12", warning_level: "termination" } };
        const stated = result.facts?.termination_stated;
        return {
          text: stated
            ? `Here's the Corrective Action Form for **Wren Halloway**.\n\n**Type of Warning:** Termination, as you said — I'll tick it on the form. Tell me if that should change.\n${stated.approval}\n\n**Action Plan:** Create builds the plan from the policy; it ends with: ${stated.plan_closing}\n\n**Observation of Offense:** Wren Halloway was a no call no show on 11/12.`
            : "Here's the Corrective Action Form for **Wren Halloway**.\n\nYou'll tick Termination on the form yourself; it needs DM/HR approval before it's finalized.",
        };
      });
      t.loopModel!(model);
      const thread = t.thread();
      const reply = await thread.say("create a termination for Wren Halloway, she no call no showed on 11/12");
      expect(thread.proposal?.templateKey, `no Corrective Action card:\n${reply.content}`).toBe("dpoa");
      expect(thread.proposal?.formDate, "the card is not dated the no call no show").toBe("2026-11-12");
      // Changed on purpose (QA, 15 Nov: G19 folded into H12's one termination_stated fact, { approval, plan_closing }, and its rules line).
      expect(reply.content, `the card does not say Termination:\n${reply.content}`).toMatch(/\*\*Type of Warning:\*\* Termination, as you said/);
      expect(reply.content, "a termination card promised future violations").not.toMatch(/Future policy violations/);
      expect(reply.content).toMatch(/Termination needs your DM\/HR approval before you finalize\./);
      const id = await thread.create();
      expect(t.checked(id).warning_type, "Create did not tick Termination").toEqual(["termination"]);
    },
  },
  {
    id: "nov15-silent-review-g1-termination-only-from-this-message",
    title: "QA's review of batch G, item 1: edit_form ticks Termination only when THIS message states it: \"if this happens again it will result in termination\" and a termination said earlier about someone else never unlock it",
    report: `${REPORT}; QA's review of batch G (15 Nov 2026), item 1`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      const { thread, id } = await wrensDraft(t);
      /* QA's design (15 Nov 2026): the model decides; this one reads a future warning as no termination, then a bare "tick it" as one, which the lock refuses. */
      const ticker = loopStandIn((view): LoopDecision => {
        if (/I'll do his form later|will result in termination/.test(latest(view))) return { text: "You'll tick Termination on the form yourself; it needs DM/HR approval before it's finalized." };
        if (!lastResult(view, "edit_form")) return { tool: "edit_form", input: { instance_id: id, values: { warning_type: "termination" } } };
        return { text: "Done." };
      });
      t.loopModel!(ticker);
      await thread.say("if this happens again it will result in termination, put that on the form");
      expect(t.checked(id).warning_type ?? [], "a future \"will result in termination\" ticked Termination").not.toContain("termination");
      await thread.say("Remy Calder has been terminated, I'll do his form later");
      await thread.say("ok tick the warning box on this one");
      expect(t.checked(id).warning_type ?? [], "a termination said about another person unlocked this form").not.toContain("termination");
      if (offline) expect(toolResults(ticker.views, "edit_form").at(-1) ?? "", "the lock did not refuse a message with no termination word").toMatch(/must come from the manager's own words/);
    },
  },
  {
    id: "nov15-silent-review-g4-incident-date-after-today-refused",
    title: "QA's review of batch G, item 4: \"wrong date, she was late on 11/20\" (after today) writes no date; only the form's own date, named as such, may be after today",
    report: `${REPORT}; QA's review of batch G (15 Nov 2026), item 4`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      const { thread, id } = await wrensDraft(t);
      const before = t.values(id).form_date ?? "";
      t.loopModel!(loopStandIn((view): LoopDecision => {
        if (!lastResult(view, "edit_form")) return { tool: "edit_form", input: { instance_id: id, values: { form_date: "11/20/2026" } } };
        return { text: "Which day was it?" };
      }));
      await thread.say("wrong date, she was late on 11/20");
      expect(t.values(id).form_date ?? "", "an incident date after today was written as the form's date").toBe(before);
    },
  },
  {
    id: "nov15-silent-review-g5-warning-level-exact",
    title: "QA's review of batch G, item 5: a warning level of \"written termination\" is refused, never ticked as Termination or as Written",
    report: `${REPORT}; QA's review of batch G (15 Nov 2026), item 5`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      const { thread, id } = await wrensDraft(t);
      t.loopModel!(loopStandIn((view): LoopDecision => {
        if (!lastResult(view, "edit_form")) return { tool: "edit_form", input: { instance_id: id, values: { warning_type: "written termination" } } };
        return { text: "Done." };
      }));
      await thread.say("make it a termination, written up today");
      expect(t.checked(id).warning_type ?? [], "an inexact level was ticked").toEqual([]);
    },
  },
  {
    id: "nov15-silent-review-g6-dictated-plan-is-the-managers-text",
    title: "QA's review of batch G, item 6: \"Action Plan: <text>\" saves the text after the label as the manager typed it, never the model's string",
    report: `${REPORT}; QA's review of batch G (15 Nov 2026), item 6`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      const { thread, id } = await wrensDraft(t);
      t.loopModel!(loopStandIn((view): LoopDecision => {
        if (!lastResult(view, "edit_form")) return { tool: "edit_form", input: { instance_id: id, values: { action_plan: "wren will complete the daily cleaning checklist every shift and initial it" } } };
        return { text: "Updated the Action Plan." };
      }));
      await thread.say("Action Plan: Wren Will complete the Daily Cleaning Checklist every shift and initial it");
      expect(t.values(id).action_plan ?? "", "the Action Plan is not the manager's own text").toMatch(/^Wren Will complete the Daily Cleaning Checklist every shift and initial it/);
    },
  },
  {
    id: "nov15-silent-g19-demotion-is-not-a-level",
    title: "G19: on a Corrective Action draft, a warning level of \"demotion\" is refused and nothing is ticked (verbal, written or termination only)",
    report: `${REPORT}; QA: anything that was not verbal or written was ticked as termination`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      const { thread, id } = await wrensDraft(t);
      const model = loopStandIn((view): LoopDecision => {
        const edit = lastResult(view, "edit_form") as { error?: string } | null;
        if (!edit) return { tool: "edit_form", input: { instance_id: id, values: { warning_type: "demotion" } } };
        return { text: edit.error ? "A demotion isn't a warning level on the Corrective Action Form; the Demotion Form records it." : "Done." };
      });
      t.loopModel!(model);
      await thread.say("make it a demotion");
      expect(t.checked(id).warning_type ?? [], "a demotion was ticked as a level").toEqual([]);
      if (offline) expect(toolResults(model.views, "edit_form")[0], "a demotion level was not refused").toMatch(/"error":"(?:[^"]*is not a warning level on this form|warning_type must come from the manager's own words)/);
    },
  },
  {
    id: "nov15-silent-g8-termination-form-tick-then-plan",
    title: "G8 order (QA): Termination and the dictated Action Plan in one message: the level is ticked first, the plan is saved exactly as said (no future-violations closing), via chat; any other key in the same edit never goes through the manager's own save",
    report: `${REPORT}: a termination plan must never end with "Future policy violations may result in…"`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      const { thread, id } = await wrensDraft(t);
      t.loopModel!(loopStandIn((view): LoopDecision => {
        if (!lastResult(view, "edit_form")) return { tool: "edit_form", input: { instance_id: id, values: { warning_type: "termination", action_plan: PLAN, observation: `${ACCOUNT} She was told on 11/09.` } } };
        return { text: `**Type of Warning:** Termination, as you said. Termination needs your DM/HR approval before you finalize.\n\nUpdated the Action Plan: ${PLAN}` };
      }));
      await thread.say(T8);
      expect(t.checked(id).warning_type, "Termination was not ticked").toEqual(["termination"]);
      expect(t.values(id).action_plan, "the termination plan carries a closing").toBe(PLAN);
      const viaChat = (t.rows?.("form_instance_events") ?? []).filter((row) => (row.detail as { via?: string } | undefined)?.via === "chat");
      expect(viaChat.length, "the manager's stated writes are not marked via chat").toBeGreaterThan(0);
      // Each via-chat save carries one key (the tick, then the plan); the observation never goes through it.
      expect(viaChat.every((row) => ((row.detail as { fields?: number }).fields ?? 0) + ((row.detail as { groups?: number }).groups ?? 0) <= 1), "another key reached the manager's own save").toBe(true);
    },
  },
];
