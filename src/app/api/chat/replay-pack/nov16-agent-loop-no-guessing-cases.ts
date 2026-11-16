import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";
import { evidenceFrom, lastResult, loopStandIn, type LoopDecision, type LoopView } from "./loop-stand-in";
import { fullNameUsed, personPronoun } from "./reply-checks";

/**
 * ============================================================================
 * NEVER GUESS: A PRONOUN, OR A FORM FROM PASTED TEXT (QA, 16 Nov 2026; the Runner's c219 detail)
 * ============================================================================
 *
 * General rules (rules book):
 *  - Never guess a pronoun for an employee: their name, or "they", unless the manager used one for them. (c219 T2's reply
 *    called the person "he/his"; nothing in the script gave it.)
 *  - Text the manager pasted with no ask of their own (a meeting script, a letter, notes) is not a request yet: one line
 *    on what it is, then ONE question, what they would like. Never promise a form, a level or a termination before they
 *    ask. (c219 T1: a pasted termination-meeting script got "I'll build the Corrective Action Form with Termination".)
 *    The same principle as fix batch item 1 ("quit" alone is not a request), applied to pasted text.
 *
 * Offline, the stand-in follows the rules and each case checks the model was shown them (so it fails without them); with
 * AGENT_LOOP_LIVE=1 the real model answers and the same reply checks hold. Invented names only (Odalys Fenwick, "Lysa",
 * Juno Paxton, Rowan Kestrel).
 */

const FLAG = "AGENT_LOOP_ENABLED";
const REPORT = "The Runner's c219 detail (16 Nov 2026): T1 promised a termination Corrective Action from a pasted script; T2 guessed \"he/his\"";
const FIRST_NAME_RULE = "call the card's person exactly <reply_name>";
const PASTED_RULE = "When the manager has not said what they want made";
/* Pau (16 Nov 2026): the employee by first name every time; no pronoun for them (`reply-checks.ts`, QA's checker). */
const offline = process.env.AGENT_LOOP_LIVE !== "1";
const SCRIPT =
  "Lysa, this meeting is about the text you sent your salon director Juno Paxton on 11/3. It was disrespectful. Your employment with us is terminated, effective 11/5. Please return your keys; your final paycheck will be mailed.";

function start(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-11-15T22:40:00Z"));
  t.directory([...STAFF]);
  t.as("salon_director", KEARNEY);
}

const shownRules = (views: readonly LoopView[]) => views.map((view) => view.system).join("\n");

export const NOV16_AGENT_LOOP_NO_GUESSING_CASES: ReplayCase[] = [
  {
    id: "nov16-no-guessing-a-pasted-script-gets-one-question-not-a-promised-form",
    title: "Never guess (c219 T1's shape): a pasted termination-meeting script naming \"Lysa\" (nobody on the roster) and the director Juno Paxton, with no ask: no card, no promised Corrective Action or termination; the reply says what it is and asks one question",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      start(t);
      // Offline the stand-in follows the rule (no lookup before a form is chosen); live, the real model answers.
      const standIn = loopStandIn((): LoopDecision => ({ text: "This is a termination meeting script for Lysa. Do you want the Employee Exit Form, or a Corrective Action?" }));
      t.loopModel!(standIn);
      const thread = t.thread();
      const reply = await thread.say(SCRIPT);
      expect(shownRules(standIn.views), "the model is not taught to ask about pasted text").toContain(PASTED_RULE);
      expect(thread.proposal ?? null, "a card was made from a pasted script with no ask").toBeNull();
      expect(reply.content, "the reply promised a form or a termination before the manager asked").not.toMatch(/\b(?:I'll|I will|I'm going to)\b[^.?!]*\b(?:Corrective Action|termination|exit form)\b/i);
      expect(reply.content).toMatch(/\?/);
      expect(personPronoun(reply.content), `a pronoun for the person:\n${reply.content}`).toBeNull();
    },
  },
  {
    id: "nov16-no-guessing-no-pronoun-the-manager-never-used",
    title: "First name every time (Pau, 16 Nov 2026): \"exit form for rowan kestrel, last day 11/28\": the reply calls the employee Rowan and never he/him/his/she/her/they/them/their; the card keeps the full name",
    report: `${REPORT}; Pau's rule: the employee by first name every time`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      start(t);
      const standIn = loopStandIn((view): LoopDecision => {
        if (!lastResult(view, "find_staff")) return { tool: "find_staff", input: { name: "rowan kestrel" } };
        if (!lastResult(view, "propose_form")) return { tool: "propose_form", input: { template_key: "stc-exit", employee_id: "e-4", exit_type: "resignation", effective_date: "11/28", exit_evidence: { ...evidenceFrom(view, "exit form for rowan kestrel"), kind: "asks_for_exit_form" } } };
        return { text: "Here's the Resignation/Exit Form for Rowan. Rowan's last day worked: November 28, 2026. Filed as a resignation from your wording; say if it was a termination." };
      });
      t.loopModel!(standIn);
      const thread = t.thread();
      const reply = await thread.say("exit form for rowan kestrel, last day 11/28");
      expect(shownRules(standIn.views), "the model is not taught the first-name rule").toContain(FIRST_NAME_RULE);
      expect(personPronoun(reply.content), `a pronoun for the employee:\n${reply.content}`).toBeNull();
      expect(reply.content).toMatch(/\bRowan\b/);
      // QA (16 Nov 2026): never the full name in the reply's words (the card shows it).
      expect(fullNameUsed(reply.content, "Rowan Kestrel"), `the full name in the reply's words:\n${reply.content}`).toBeNull();
      expect(thread.proposal?.employeeName, "the card's name is no longer the full name").toBe("Rowan Kestrel");
      const named = standIn.views.flatMap((view) => view.results).find((result) => result.tool === "propose_form")?.output as { reply_name?: string } | undefined;
      expect(named?.reply_name, "propose_form did not say what to call the person").toBe("Rowan");
    },
  },
  {
    id: "nov16-no-guessing-two-people-sharing-a-first-name-get-full-names",
    title: "First name every time, the exception (Pau): with Rowan Kestrel and Rowan Pike in the same conversation (\"exit form for rowan kestrel, last day 11/28, rowan pike will cover the shift\"), the reply calls each by full name, never a bare \"Rowan\"",
    report: `${REPORT}; Pau's rule: two people sharing a first name are both called by full name`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      vi.setSystemTime(new Date("2026-11-15T22:40:00Z"));
      t.directory([...STAFF, { id: "e-8", firstName: "Rowan", lastName: "Pike", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0309"], positionName: "Tanning Consultant" }]);
      t.as("salon_director", KEARNEY);
      const standIn = loopStandIn((view): LoopDecision => {
        if (!lastResult(view, "find_staff")) return { tool: "find_staff", input: { name: "rowan kestrel" } };
        if (!lastResult(view, "propose_form")) return { tool: "propose_form", input: { template_key: "stc-exit", employee_id: "e-4", exit_type: "resignation", effective_date: "11/28", exit_evidence: { ...evidenceFrom(view, "exit form for rowan kestrel"), kind: "asks_for_exit_form" } } };
        return { text: "Here's the Resignation/Exit Form for Rowan Kestrel. Rowan Kestrel's last day worked: November 28, 2026; Rowan Pike covers the shift. Filed as a resignation from your wording; say if it was a termination." };
      });
      t.loopModel!(standIn);
      const thread = t.thread();
      const reply = await thread.say("exit form for rowan kestrel, last day 11/28, rowan pike will cover the shift");
      expect(shownRules(standIn.views), "the model is not taught the shared-first-name exception").toContain(FIRST_NAME_RULE);
      const plain = reply.content.replace(/\*\*/g, "");
      expect(plain, `a bare "Rowan" where two Rowans are in the conversation:\n${reply.content}`).not.toMatch(/\bRowan\b(?!['’]?s?\s+(?:Kestrel|Pike)|\s+(?:Kestrel|Pike))/);
      expect(plain).toMatch(/Rowan Kestrel/);
      const named = standIn.views.flatMap((view) => view.results).find((result) => result.tool === "propose_form")?.output as { reply_name?: string } | undefined;
      expect(named?.reply_name, "two Rowans, and reply_name is not the full name").toBe("Rowan Kestrel");
      expect(personPronoun(reply.content), `a pronoun for the employee:\n${reply.content}`).toBeNull();
    },
  },
  {
    id: "nov16-no-guessing-a-namesake-on-the-staff-list-only-gets-full-names",
    title: "reply_name (QA and Pau): Rowan Pike is on the staff list but never mentioned; \"exit form for rowan kestrel, last day 11/28\" still gets reply_name \"Rowan Kestrel\", and the reply never says a bare \"Rowan\" (a manager with two Rowans would not know which)",
    report: `${REPORT}; QA: the roster and the records decide the name, not the model's reading of a rule`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      vi.setSystemTime(new Date("2026-11-15T22:40:00Z"));
      t.directory([...STAFF, { id: "e-8", firstName: "Rowan", lastName: "Pike", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0309"], positionName: "Tanning Consultant" }]);
      t.as("salon_director", KEARNEY);
      const standIn = loopStandIn((view): LoopDecision => {
        if (!lastResult(view, "find_staff")) return { tool: "find_staff", input: { name: "rowan kestrel" } };
        const card = lastResult(view, "propose_form") as { reply_name?: string } | null;
        if (!card) return { tool: "propose_form", input: { template_key: "stc-exit", employee_id: "e-4", exit_type: "resignation", effective_date: "11/28", exit_evidence: { ...evidenceFrom(view, "exit form for rowan kestrel"), kind: "asks_for_exit_form" } } };
        return { text: `Here's the Resignation/Exit Form for **${card.reply_name}**. ${card.reply_name}'s last day worked: November 28, 2026.` };
      });
      t.loopModel!(standIn);
      const thread = t.thread();
      const reply = await thread.say("exit form for rowan kestrel, last day 11/28");
      const named = standIn.views.flatMap((view) => view.results).find((result) => result.tool === "propose_form")?.output as { reply_name?: string } | undefined;
      expect(named?.reply_name, "a namesake on the staff list, and reply_name is the bare first name").toBe("Rowan Kestrel");
      const plain = reply.content.replace(/\*\*/g, "");
      expect(plain, `a bare "Rowan" with another Rowan on the staff list:\n${reply.content}`).not.toMatch(/\bRowan\b(?!['’]?s?\s+Kestrel|\s+Kestrel)/);
      expect(personPronoun(reply.content), `a pronoun for the employee:\n${reply.content}`).toBeNull();
    },
  },
  {
    id: "nov16-no-guessing-no-name-question-before-a-form-is-chosen",
    title: "No name question before there is a form (QA, the live check: in 4 of 12 runs the name offer was the reply's only question): find_staff for \"Lysa\" (nobody) with no form chosen gives form_not_chosen and no ask_exactly; once propose_form runs for a form this turn, its refusal and a later find_staff carry \"Reply **use Lysa**\"",
    report: `${REPORT}; the Runner's live check (16 Nov 2026): the ask-one-question half passed 7 of 12`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      start(t);
      const USE_LYSA = "I can't find **Lysa** on your staff list. Reply **use Lysa** to put the name on the form as you typed it, or give me the full name.";
      const steps = [
        { tool: "find_staff", input: { name: "Lysa" } },
        { tool: "propose_form", input: { template_key: "stc-exit", employee_name: "Lysa", exit_type: "termination", effective_date: "11/5" } },
        { tool: "find_staff", input: { name: "Lysa" } },
      ] as const;
      const standIn = loopStandIn((view): LoopDecision => {
        const next = steps[view.results.length];
        if (!next) return { text: "This is a termination meeting script for Lysa. Do you want the Employee Exit Form, or a Corrective Action?" };
        return { tool: next.tool, input: { ...next.input, ...(next.tool === "find_staff" ? { person_evidence: evidenceFrom(view, "Lysa") } : {}) } };
      });
      t.loopModel!(standIn);
      const thread = t.thread();
      const reply = await thread.say(SCRIPT);
      const results = standIn.views.reduce<{ tool: string; output: unknown }[]>((most, view) => (view.results.length > most.length ? [...view.results] : most), []);
      type Out = { reason_code?: string; ask_exactly?: string; form_not_chosen?: boolean };
      // Both modes (QA): before a form is chosen (the first propose_form), no tool result carries a name question.
      const firstPropose = results.findIndex((result) => result.tool === "propose_form");
      const beforeForm = (firstPropose < 0 ? results : results.slice(0, firstPropose)).map((result) => result.output as Out);
      expect(beforeForm.filter((out) => out.reason_code === "not_on_roster" && out.ask_exactly), "a name question before a form was chosen").toEqual([]);
      if (firstPropose < 0) {
        const row = [...(t.rows?.("chat_traces") ?? [])].reverse().find((entry) => (entry.slots as { agent_loop?: unknown } | undefined)?.agent_loop);
        expect((row?.slots as { agent_loop?: { name_question?: unknown } } | undefined)?.agent_loop?.name_question, "a name question was recorded with no form chosen").toBeUndefined();
        expect(reply.content, `the reply asked a name question before a form was chosen:\n${reply.content}`).not.toMatch(/Reply \*\*use|full name|staff list/i);
      }
      expect(personPronoun(reply.content), `a pronoun for the person:\n${reply.content}`).toBeNull();
      if (offline) {
        // The stand-in's scripted calls: today's exact checks of the code path.
        const [before, propose, after] = results.map((result) => result.output as Out);
        expect(before, "find_staff asked the name before a form was chosen").toMatchObject({ reason_code: "not_on_roster", form_not_chosen: true });
        expect(before?.ask_exactly).toBeUndefined();
        expect(propose).toMatchObject({ reason_code: "not_on_roster", ask_exactly: USE_LYSA });
        expect(after).toMatchObject({ reason_code: "not_on_roster", ask_exactly: USE_LYSA });
        expect(after?.form_not_chosen).toBeUndefined();
      }
    },
  },
];
