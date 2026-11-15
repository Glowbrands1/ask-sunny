import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";
import { lastResult, loopStandIn, type LoopDecision, type LoopView, evidenceFrom } from "./loop-stand-in";

/**
 * ============================================================================
 * THE MODEL DECIDES A TERMINATION; CODE ONLY LOCKS IT (QA's design, 15 Nov 2026; Pau's standing approval)
 * ============================================================================
 *
 * QA's two reviews of batch G found that reading intent with patterns breaks either way ("After two prior written
 * warnings, we are terminating her." read as history; "we fired her sister" read as this form's termination). So in the
 * agent loop the MODEL decides, taught by the rules book's examples, and code only locks it: a termination level (and an
 * exit's "termination") is kept only when the manager's own words carry a termination word, and Create checks that
 * word again, server-side. Every input from both reviews is here, with the stand-in model's decision as the rules book
 * teaches it, and the lock refusing a termination where the words carry none. Invented names only (Remy Calder).
 */

const FLAG = "AGENT_LOOP_ENABLED";
const REPORT = "QA's reviews of batch G (15 Nov 2026) and QA's design for terminations in the loop";
const ACCOUNT = "She was a no call no show on 11/12.";
const HEDGE = "If this form is a termination, tick Termination on the form yourself; it needs DM/HR approval before it's finalized.";
const offline = process.env.AGENT_LOOP_LIVE !== "1";
const toolResults = (views: readonly LoopView[], tool: string) => views.flatMap((view) => view.results.filter((result) => result.tool === tool)).map((result) => JSON.stringify(result.output));

/** The manager's message: their words, naming the person when they do not already, then the account. */
const said = (words: string) => `${/remy calder/i.test(words) ? words.replace(/<A>/g, "Remy Calder") : `ca for remy calder. ${words}`} ${ACCOUNT}`;

/** A Corrective Action card for Remy Calder, where the stand-in model decides `termination` or not. */
async function card(t: ReplayContext, words: string, termination: boolean) {
  vi.setSystemTime(new Date("2026-11-14T22:40:00Z"));
  t.directory([...STAFF]);
  t.as("salon_director", KEARNEY);
  const model = loopStandIn((view): LoopDecision => {
    const result = lastResult(view, "propose_form") as { facts?: { termination_stated?: { approval: string; plan_closing: string }; termination_mentioned_not_stated?: boolean } } | null;
    if (!lastResult(view, "find_staff")) return { tool: "find_staff", input: { name: "remy calder" } };
    if (!result) return { tool: "propose_form", input: { template_key: "dpoa", employee_id: "e-2", what_happened: ACCOUNT, incident_date: "2026-11-12", ...(termination ? { warning_level: "termination" } : {}) } };
    const stated = result.facts?.termination_stated;
    return {
      text: stated
        ? `Here's the Corrective Action Form for **Remy Calder**.\n\n**Type of Warning:** Termination, as you said — I'll tick it on the form. Tell me if that should change.\n${stated.approval}\n\n**Observation of Offense:** ${ACCOUNT}`
        // Batch G2 (item 3): the stand-in gives the hedge line only when the tool says so (termination_mentioned_not_stated), as the rules book teaches.
        : `Here's the Corrective Action Form for **Remy Calder**.\n\n${result.facts?.termination_mentioned_not_stated ? `${HEDGE}\n\n` : ""}**Observation of Offense:** ${ACCOUNT}`,
    };
  });
  t.loopModel!(model);
  const thread = t.thread();
  const reply = await thread.say(said(words));
  return { thread, reply, model };
}

/* The model reads these as this form's termination (the rules book's IS list, and QA's regressions that must stay true). */
const IS_TERMINATION = [
  "we're terminating her",
  "termination CA for <A>",
  "create a termination for <A>",
  "we fired her today",
  "my DM approved her termination",
  "after two prior warnings we are terminating her",
  "After two prior written warnings, we are terminating her.",
  "She has prior warnings, terminate her.",
  "termination CA, she was previously warned twice",
  "she no call no showed her first day, terminate her",
  "I would like a termination CA for <A>",
];

/* The model reads these as NOT this form's termination: a warning, history, another person, intent, a question. */
const NOT_TERMINATION = [
  "if this happens again it will result in termination",
  "future violations may result in termination of employment",
  "Any further violations will result in termination.",
  "I don't think it should be a termination",
  "she was fired from her last job",
  "she has been terminated at Target",
  "she was terminated at Target years ago",
  "He has been terminated at his previous job",
  "Previously she has been terminated and rehired",
  "They fired him at his old salon",
  "they fired him at Walmart",
  "she got fired her first week at Target",
  "we fired her sister",
  "I told her we'd fire her",
  "I need to fire her",
  "I'd like to fire her",
  "we will fire her",
  "if this continues we will terminate her",
  "HR wants us to fire her",
  "should I terminate her?",
  // QA's third review: history that main's reader would tick at Create; in the loop only the model decides.
  "She got a termination warning in March. Now she was late again, make a CA",
  "termination CA last year, now she's late again, write her up",
];

/* The words carry no termination word: the lock refuses a termination the model asked for. */
const NO_WORD = ["write her up, she has two prior warnings", "final written for <A>, last chance", "let her go home early today"];

/** A short, stable id part for one input. */
const slug = (words: string) => words.toLowerCase().replace(/<a>/g, "a").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);

export const NOV15_AGENT_LOOP_TERMINATION_DECISION_CASES: ReplayCase[] = [
  ...IS_TERMINATION.map((words): ReplayCase => ({
    id: `nov15-termination-decision-is-${slug(words)}`,
    title: `QA's design: "${words}" — the model decides this form is a termination: the card says Termination, as you said, with the DM/HR approval line, and Create ticks it`,
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      const { thread, reply } = await card(t, words, true);
      expect(reply.content, `"${words}" is not carded as a termination:\n${reply.content}`).toMatch(/\*\*Type of Warning:\*\* Termination, as you said/);
      expect(reply.content).toContain("Termination needs your DM/HR approval before you finalize.");
      const id = await thread.create();
      expect(t.checked(id).warning_type, `Create did not tick Termination for "${words}"`).toEqual(["termination"]);
    },
  })),
  ...NOT_TERMINATION.map((words): ReplayCase => ({
    id: `nov15-termination-decision-not-${slug(words)}`,
    title: `QA's design: "${words}" — the model decides this is NOT this form's termination: the hedge line, and Create ticks nothing`,
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      const { thread, reply } = await card(t, words, false);
      expect(reply.content, `"${words}" was carded as a termination`).not.toMatch(/Termination, as you said/);
      expect(reply.content).toContain(HEDGE);
      const id = await thread.create();
      expect(t.checked(id).warning_type ?? [], `Create ticked Termination for "${words}"`).not.toContain("termination");
    },
  })),
  ...([
    ["t1", "we're terminating Remy Calder, she no call no showed 11/12"],
    ["t3", "create a termination for Remy Calder, she no call no showed on 11/12"],
    ["t4", "we fired Remy Calder today for stealing from the register"],
  ] as const).map(([tag, words]): ReplayCase => ({
    id: `nov15-g2-termination-with-an-offense-is-the-ca-${tag}`,
    title: `G2 item 2 (QA's live run part 2, ${tag.toUpperCase()}): "${words}" is the Corrective Action Form with Termination, dated the offense's day, plus one line offering the exit form; never an exit form dated today`,
    report: `${REPORT}; QA's live run part 2 on batch G (15 Nov 2026), item 2: an Exit form dated today, the incident date lost`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      vi.setSystemTime(new Date("2026-11-14T22:40:00Z"));
      t.directory([...STAFF]);
      t.as("salon_director", KEARNEY);
      const model = loopStandIn((view): LoopDecision => {
        const results = view.results.filter((result) => result.tool === "propose_form").map((result) => result.output as { exit_not_stated?: boolean; facts?: { termination_stated?: { approval: string } } });
        if (!lastResult(view, "find_staff")) return { tool: "find_staff", input: { name: "remy calder" } };
        // The live bug: the model reached for the exit form first.
        if (results.length === 0) return { tool: "propose_form", input: { template_key: "stc-exit", employee_id: "e-2", exit_type: "termination" } };
        const last = results.at(-1)!;
        if ((last as { exit_not_stated?: boolean }).exit_not_stated && results.length === 1) return { tool: "propose_form", input: { template_key: "dpoa", employee_id: "e-2", what_happened: tag === "t4" ? "She stole from the register today." : ACCOUNT, incident_date: tag === "t4" ? "2026-11-14" : "2026-11-12", warning_level: "termination" } };
        const stated = last.facts?.termination_stated;
        return { text: `Here's the Corrective Action Form for **Remy Calder**.\n\n${stated ? `**Type of Warning:** Termination, as you said — I'll tick it on the form. Tell me if that should change.\n${stated.approval}` : HEDGE}\n\nWant the Employee Exit Form for Remy Calder too?` };
      });
      t.loopModel!(model);
      const thread = t.thread();
      const reply = await thread.say(words);
      expect(thread.proposal?.templateKey, `"${words}" was not the Corrective Action Form:\n${reply.content}`).toBe("dpoa");
      expect(thread.proposal?.formDate, "the offense's date was lost").toBe(tag === "t4" ? "2026-11-14" : "2026-11-12");
      expect(reply.content).toMatch(/Termination, as you said/);
      expect(reply.content).toContain("Want the Employee Exit Form for Remy Calder too?");
    },
  })),
  ...([
    ["t7", "Remy Calder was late on 11/14, if this happens again it will result in termination"],
    ["t8", "write up Remy Calder for lateness 11/14, she was fired from her last job btw"],
    ["t9", "Remy Calder was terminated at Target years ago, now she was late 11/14, make a CA"],
    ["t11", "Remy Calder got a termination warning in March, now she was late again on 11/14, make a CA"],
    ["t13", "CA for Remy Calder, late 11/14, we fired her sister last month"],
  ] as const).map(([tag, words]): ReplayCase => ({
    id: `nov15-g2-termination-not-this-form-${tag}`,
    title: `G2 item 3 (QA's live run part 2, ${tag.toUpperCase()}): "${words}" — a termination word that is not this form's: the CA with the hedge line (termination_mentioned_not_stated), and Create ticks nothing`,
    report: `${REPORT}; QA's live run part 2 on batch G (15 Nov 2026), item 3`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      vi.setSystemTime(new Date("2026-11-14T22:40:00Z"));
      t.directory([...STAFF]);
      t.as("salon_director", KEARNEY);
      const model = loopStandIn((view): LoopDecision => {
        const result = lastResult(view, "propose_form") as { facts?: { termination_mentioned_not_stated?: boolean } } | null;
        if (!lastResult(view, "find_staff")) return { tool: "find_staff", input: { name: "remy calder" } };
        if (!result) return { tool: "propose_form", input: { template_key: "dpoa", employee_id: "e-2", what_happened: "She was late on 11/14.", incident_date: "2026-11-14" } };
        return { text: `Here's the Corrective Action Form for **Remy Calder**.\n\n${result.facts?.termination_mentioned_not_stated ? `${HEDGE}\n\n` : ""}**Observation of Offense:** She was late on 11/14.` };
      });
      t.loopModel!(model);
      const thread = t.thread();
      const reply = await thread.say(words);
      expect(thread.proposal?.templateKey).toBe("dpoa");
      expect(reply.content, `"${words}" was carded as a termination`).not.toMatch(/Termination, as you said/);
      expect(reply.content, `no hedge line for "${words}"`).toContain(HEDGE);
      const id = await thread.create();
      expect(t.checked(id).warning_type ?? [], `Create ticked Termination for "${words}"`).not.toContain("termination");
    },
  })),
  {
    id: "nov15-g2-prior-actions-keep-the-count-t6",
    title: "G2 item 4 (QA's live run part 2, T6): \"after two prior written warnings…\": Prior actions keep the count, \"Written warning (2), dates not given\", never this incident's date",
    report: `${REPORT}; QA's live run part 2 on batch G (15 Nov 2026), item 4: "Written warning — 11/14/2026"`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      vi.setSystemTime(new Date("2026-11-14T22:40:00Z"));
      t.directory([...STAFF]);
      t.as("salon_director", KEARNEY);
      const model = loopStandIn((view): LoopDecision => {
        const results = view.results.filter((result) => result.tool === "propose_form").map((result) => result.output as { not_on_card?: { field: string }[] });
        if (!lastResult(view, "find_staff")) return { tool: "find_staff", input: { name: "remy calder" } };
        const input = { template_key: "dpoa", employee_id: "e-2", what_happened: "She was late again on 11/14.", incident_date: "2026-11-14", warning_level: "termination" };
        // The live slip: the count lost and today's date put on the earlier steps.
        if (results.length === 0) return { tool: "propose_form", input: { ...input, prior_actions: "Written warning — 11/14/2026" } };
        if (results.length === 1 && results[0]!.not_on_card?.some((entry) => entry.field === "prior_actions")) return { tool: "propose_form", input: { ...input, prior_actions: "Written warning (2), dates not given" } };
        return { text: "Here's the Corrective Action Form for **Remy Calder**." };
      });
      t.loopModel!(model);
      const thread = t.thread();
      await thread.say("after two prior written warnings we are terminating Remy Calder for being late again on 11/14");
      expect((thread.proposal as { priorActions?: string | null } | null)?.priorActions, "the prior actions lost the count or took the incident's date").toBe("Written warning (2), dates not given");
    },
  },
  {
    id: "nov15-termination-decision-lock-refuses-no-word",
    title: "QA's design, the lock: a termination the model asks for where the manager's words carry no termination word is not kept (not_on_card), and Create ticks nothing; a card forged with loopTermination is refused at Create too",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      for (const words of NO_WORD) {
        const { thread, reply, model } = await card(t, words, true);
        expect(reply.content, `"${words}" was carded as a termination`).not.toMatch(/Termination, as you said/);
        if (offline) expect(toolResults(model.views, "propose_form")[0] ?? "", `the lock kept a termination for "${words}"`).toMatch(/"not_on_card":\[[^\]]*"field":"warning_level"/);
        expect((thread.proposal as { loopTermination?: true } | null)?.loopTermination, "the card carries a termination").toBeUndefined();
        const id = await thread.create();
        expect(t.checked(id).warning_type ?? [], `Create ticked Termination for "${words}"`).not.toContain("termination");
      }
      // Create's own server-side check: a card that says termination, from a chat with no termination word.
      const { thread } = await card(t, NO_WORD[0]!, false);
      (thread as unknown as { proposal: Record<string, unknown> }).proposal = { ...thread.proposal!, loopTermination: true };
      const id = await thread.create();
      expect(t.checked(id).warning_type ?? [], "Create accepted a termination with no termination word in the chat").not.toContain("termination");
    },
  },
  {
    id: "nov15-termination-decision-flag-off-ticks-nothing",
    title: "QA's third review, item 1: with TERMINATION_STATED_TICKS off, nothing in the loop or at Create ticks Termination, the model's decision and the word notwithstanding",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      vi.stubEnv("TERMINATION_STATED_TICKS_ENABLED", "false");
      try {
        const { thread, reply } = await card(t, "we're terminating her", true);
        expect(reply.content, "a termination was carded with the flag off").not.toMatch(/Termination, as you said/);
        const id = await thread.create();
        expect(t.checked(id).warning_type ?? [], "Create ticked Termination with the flag off").not.toContain("termination");
        // A card that says termination anyway: Create's own check is gated too.
        const forged = await card(t, "we're terminating her", false);
        (forged.thread as unknown as { proposal: Record<string, unknown> }).proposal = { ...forged.thread.proposal!, loopTermination: true, fromAgentLoop: true };
        const forgedId = await forged.thread.create();
        expect(t.checked(forgedId).warning_type ?? [], "Create accepted a loop termination with the flag off").not.toContain("termination");
        // edit_form on the draft: "make it a termination".
        t.loopModel!(loopStandIn((view): LoopDecision => (lastResult(view, "edit_form") ? { text: "Done." } : { tool: "edit_form", input: { instance_id: id, values: { warning_type: "termination" } } })));
        await thread.say("make it a termination");
        expect(t.checked(id).warning_type ?? [], "edit_form ticked Termination with the flag off").not.toContain("termination");
      } finally {
        vi.unstubAllEnvs();
      }
    },
  },
  {
    id: "nov15-termination-decision-no-values-future-date",
    title: "QA's third review, item 3: \"the date is wrong, change it to 12/20/2026\" through edit_form with no values (the reviser's path) writes no date after today on a Corrective Action; one question",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      const { thread } = await card(t, "write her up, she has two prior warnings", false);
      const id = await thread.create();
      const before = t.values(id).form_date ?? "";
      const model = loopStandIn((view): LoopDecision => {
        const edit = lastResult(view, "edit_form") as { error?: string } | null;
        if (!edit) return { tool: "edit_form", input: { instance_id: id } };
        return { text: edit.error ? "12/20/2026 is after today, so I didn't change the date. Which day should it be?" : "Done." };
      });
      t.loopModel!(model);
      const reply = await thread.say("the date is wrong, change it to 12/20/2026");
      expect(t.values(id).form_date ?? "", `a date after today was written through the reviser:\n${reply.content}`).toBe(before);
      if (offline) expect(toolResults(model.views, "edit_form")[0] ?? "", "edit_form did not refuse the date").toMatch(/is after today/);
    },
  },
  {
    id: "nov15-termination-decision-exit-keeps-the-stated-date",
    title: "QA's third review, item 5: \"terminate her, termination date 11/28\", \"we fired her on 11/12, exit form\" and \"terminated as of 11/20\" are dated the day the manager typed (the model's effective_date, locked), never today",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      vi.setSystemTime(new Date("2026-11-15T18:00:00Z"));
      t.directory([...STAFF]);
      t.as("salon_director", KEARNEY);
      for (const [words, date, iso] of [
        ["exit form for remy calder, terminate her, termination date 11/28", "11/28", "2026-11-28"],
        ["remy calder, we fired her on 11/12, exit form", "11/12", "2026-11-12"],
        ["exit form for remy calder, terminated as of 11/20", "11/20", "2026-11-20"],
      ] as const) {
        t.loopModel!(loopStandIn((view): LoopDecision => {
          if (!lastResult(view, "find_staff")) return { tool: "find_staff", input: { name: "remy calder" } };
          if (!lastResult(view, "propose_form")) return { tool: "propose_form", input: { template_key: "stc-exit", exit_evidence: evidenceFrom(view), employee_id: "e-2", exit_type: "termination", effective_date: date } };
          return { text: "Here's the Employee Exit Form for **Remy Calder**." };
        }));
        const thread = t.thread();
        await thread.say(words);
        expect(thread.proposal?.formDate, `"${words}" was not dated the stated day`).toBe(iso);
      }
    },
  },
  {
    id: "nov15-termination-decision-exit",
    title: "QA's design, exits: the model decides resignation (\"…last day 11/28. Not a termination.\", \"resigned in lieu of termination\", \"terminated at her last salon\", …) and the stated last day is the card's date; a termination exit without a termination word is not kept",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      vi.setSystemTime(new Date("2026-11-15T18:00:00Z"));
      t.directory([...STAFF]);
      t.as("salon_director", KEARNEY);
      const exit = async (words: string, termination: boolean) => {
        const model = loopStandIn((view): LoopDecision => {
          if (!lastResult(view, "find_staff")) return { tool: "find_staff", input: { name: "remy calder" } };
          if (!lastResult(view, "propose_form")) return { tool: "propose_form", input: { template_key: "stc-exit", exit_evidence: evidenceFrom(view), employee_id: "e-2", incident_date: "2026-11-28", exit_type: termination ? "termination" : "resignation" } };
          return { text: "Here's the Employee Exit Form for **Remy Calder**." };
        });
        t.loopModel!(model);
        const thread = t.thread();
        await thread.say(words);
        return { thread, model };
      };
      for (const words of [
        "exit form for remy calder, she gave notice, last day 11/28. Not a termination.",
        "exit form for remy calder. She quit, last day 11/28. She was fired from her last job btw",
        "exit form for remy calder, she resigned, last day 11/28, let her go home early today",
        "exit form for remy calder, she resigned in lieu of termination, last day 11/28",
        "exit form for remy calder, she quit after we talked about termination, last day 11/28",
        "exit form for remy calder, she resigned, last day 11/28, she was terminated at her last salon",
      ]) {
        const { thread, model } = await exit(words, false);
        expect(thread.proposal?.formDate, `the stated last day was replaced after "${words}"`).toBe("2026-11-28");
        if (offline) expect(toolResults(model.views, "propose_form")[0] ?? "", `"${words}" was filed as a termination`).not.toMatch(/exit_termination/);
      }
      // The lock: a termination the model asks for where the words carry no termination word.
      const { thread, model } = await exit("exit form for remy calder, she quit, last day 11/28", true);
      expect(thread.proposal?.formDate).toBe("2026-11-28");
      if (offline) expect(toolResults(model.views, "propose_form")[0] ?? "", "the lock kept a termination exit with no termination word").toMatch(/"not_on_card":\[[^\]]*"field":"exit_type"/);
    },
  },
];
