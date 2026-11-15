import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";
import { lastResult, loopStandIn, type LoopDecision, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * BATCH K: THE 266 SHADOW REPLAY'S GUARD BREACHES (QA, 15 Nov 2026)
 * ============================================================================
 *
 * QA's shadow replay of real manager chats through the agent loop (part 1, 138 conversations with a truth form)
 * found the loop carded the wrong person where today's app asked. The Runner's masked pack gave each conversation's
 * shape; every case here keeps that shape with invented people (Remy Calder is on the roster; "Remi Calder", "Remi" and
 * "Remi Caldor" are close spellings of her that are nobody on it).
 */

const FLAG = "AGENT_LOOP_ENABLED";
/* Pau 15 Nov: A (a close spelling is never seated); on in production. */
const NEAR_MISS = "NEAR_MISS_NEVER_SEATED_ENABLED";
const REPORT = "QA's 266 shadow replay, part 1 (15 Nov 2026), from the Runner's masked pack";

const latest = (view: LoopView) => [...view.turns].reverse().find((turn) => turn.role === "user")?.text ?? "";

type StaffResult = { matches?: { employee_id: string; name: string }[]; did_you_mean?: unknown[]; not_on_roster?: string; note?: string } | null;

/**
 * A stand-in that does what the tool results say: a Did-you-mean (or any "Ask …" note) is asked in the note's own
 * words; one match is carded with the account the manager gave.
 */
function namingModel(name: (said: string) => string, account: string) {
  return loopStandIn((view): LoopDecision => {
    const staff = lastResult(view, "find_staff") as StaffResult;
    if (!staff) return { tool: "find_staff", input: { name: name(latest(view)) } };
    const asked = /Ask the manager, in these words: ([\s\S]+)$/.exec(staff.note ?? "")?.[1];
    if (asked) return { text: asked };
    const person = staff.matches?.[0];
    if (!person) return { text: "Who is this Coaching Form for?" };
    if (!lastResult(view, "propose_form")) return { tool: "propose_form", input: { template_key: "coaching", employee_id: person.employee_id, what_happened: account } };
    return { text: `Here's the Coaching Form for **${person.name}**.\n\nUsing **${person.name}** from your staff list.` };
  });
}

async function salon(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-11-14T22:40:00Z"));
  t.directory([...STAFF]);
  t.as("salon_director", KEARNEY);
}

export const NOV15_AGENT_LOOP_BATCH_K_CASES: ReplayCase[] = [
  ...([
    ["c119", "create a coaching document for Remi Calder", "Remi Calder"],
    ["c137", "put together a coaching document for Remi", "Remi"],
  ] as const).map(([tag, words, typed]): ReplayCase => ({
    id: `nov15-k1-near-miss-is-asked-${tag}`,
    title: `K1 (QA's shadow replay, ${tag}'s shape): "${words}", where "${typed}" is nobody on the roster but spells close to Remy Calder, gets today's Did-you-mean (with keeping the name as typed), never a card for Remy Calder`,
    report: `${REPORT}: ${tag}, an off-roster person carded as a roster person who only spelled close`,
    status: "fixed",
    fixFlags: [FLAG, NEAR_MISS],
    async run(t) {
      if (!t.loopOn?.()) return;
      await salon(t);
      t.loopModel!(namingModel(() => typed, "She was late to her shift on 11/14."));
      const thread = t.thread();
      const reply = await thread.say(words);
      expect(thread.proposal ?? null, `a card was made for a close spelling:\n${reply.content}`).toBeNull();
      expect(reply.content).toMatch(/Did you mean \*\*Remy Calder\*\*\?/);
      expect(reply.content, "keeping the typed name is not offered").toMatch(new RegExp(`"no" to keep \\*\\*${typed}\\*\\*`));
    },
  })),
  {
    id: "nov15-k1-card-shortcut-never-overrides-a-different-name-c022",
    title: "K1 (QA's shadow replay, c022's shape): a card made from a first name alone (\"remy\"), then the manager types a different full name (\"Remi Caldor\"): asked about, never \"the person on this chat's card, use them\"",
    report: `${REPORT}: c022, the manager re-typed the truth person's full name and the card kept the close spelling`,
    status: "fixed",
    fixFlags: [FLAG, NEAR_MISS],
    async run(t) {
      if (!t.loopOn?.()) return;
      await salon(t);
      t.loopModel!(namingModel((said) => (/caldor/i.test(said) ? "Remi Caldor" : "remy"), "She was late to her shift on 11/14."));
      const thread = t.thread();
      await thread.say("coaching for remy, she was late to her shift on 11/14");
      expect(thread.proposal?.employeeName, "the first card is not Remy Calder's").toBe("Remy Calder");
      const reply = await thread.say("Remi Caldor");
      expect(reply.content, `the different name was read as the card's person:\n${reply.content}`).toMatch(/Did you mean \*\*Remy Calder\*\*\?/);
    },
  },
  {
    id: "nov15-k1-card-shortcut-kept-for-a-person-the-manager-typed",
    title: "K1, the control: after a card for \"Remy Calder\" typed in full, \"edit remy caldr ca\" is still that card's person, with no Did-you-mean",
    report: `${REPORT}; the live re-run's sf-s26 shape, kept`,
    status: "fixed",
    fixFlags: [FLAG, NEAR_MISS],
    async run(t) {
      if (!t.loopOn?.()) return;
      await salon(t);
      const model = namingModel((said) => (/caldr\b/i.test(said) ? "remy caldr" : "Remy Calder"), "She was late to her shift on 11/14.");
      t.loopModel!(model);
      const thread = t.thread();
      await thread.say("coaching for Remy Calder, she was late to her shift on 11/14");
      const reply = await thread.say("edit remy caldr ca");
      expect(reply.content, "the card's own person was asked about").not.toMatch(/Did you mean/);
    },
  },
];

NOV15_AGENT_LOOP_BATCH_K_CASES.push(
  {
    id: "nov15-k2-part-of-a-first-name-is-asked-c261",
    title: "K2 (QA's shadow replay, c261's shape): \"write up rowa for being late on 11/14\", where \"rowa\" only begins Rowan Kestrel's first name, is asked about (Did you mean **Rowan Kestrel**?), never carded",
    report: `${REPORT}: c261, a typo that began another roster person's first name seated her and looked up her forms`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      await salon(t);
      t.loopModel!(namingModel(() => "rowa", "She was late to her shift on 11/14."));
      const thread = t.thread();
      const reply = await thread.say("write up rowa for being late on 11/14");
      expect(thread.proposal ?? null, `a part of a first name was carded:\n${reply.content}`).toBeNull();
      expect(reply.content).toMatch(/Did you mean \*\*Rowan Kestrel\*\*\?/);
    },
  },
  {
    id: "nov15-k2-a-whole-first-name-is-still-used",
    title: "K2, the control: \"write up rowan for being late on 11/14\", the whole first name of the only Rowan, is carded at once with \"Using **Rowan Kestrel** from your staff list.\"",
    report: `${REPORT}; Pau's 14 Nov first-name rule, kept`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      await salon(t);
      t.loopModel!(namingModel(() => "rowan", "She was late to her shift on 11/14."));
      const thread = t.thread();
      const reply = await thread.say("write up rowan for being late on 11/14");
      expect(thread.proposal?.employeeName, reply.content).toBe("Rowan Kestrel");
    },
  },
);

const PASTE = "Observation of Concern\nFollowing a review of employee hours worked, it was confirmed that Tessa Varnell utilized tanning equipment while clocked in for scheduled shifts.";

NOV15_AGENT_LOOP_BATCH_K_CASES.push(
  {
    id: "nov15-k4-an-account-about-another-person-is-asked-c137",
    title: "K4 (QA's shadow replay, c137's shape): after Remy Calder's coaching card, a pasted account that names only Tessa Varnell (nobody on the roster) gives account_names_other_person, and the reply asks which person the form is for, never \"Added your account\" to Remy's card",
    report: `${REPORT}: c137 and c134, a pasted account about one person put on another person's card`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      await salon(t);
      const model = loopStandIn((view): LoopDecision => {
        const said = latest(view);
        const card = lastResult(view, "propose_form") as { facts?: { account_names_other_person?: { named: { name: { untrusted_text: string } }[]; card_person: string } } } | null;
        if (/Observation of Concern/.test(said)) {
          if (!card) return { tool: "propose_form", input: { template_key: "coaching", employee_id: "e-2", what_happened: said } };
          const other = card.facts?.account_names_other_person;
          return { text: other ? `This account is about **${other.named[0]!.name.untrusted_text}**. Is the form for **${other.named[0]!.name.untrusted_text}** or **${other.card_person}**?` : "Added your account to the Coaching Form for **Remy Calder**." };
        }
        if (!lastResult(view, "find_staff")) return { tool: "find_staff", input: { name: "Remy Calder" } };
        if (!card) return { tool: "propose_form", input: { template_key: "coaching", employee_id: "e-2" } };
        return { text: "Here's the Coaching Form for **Remy Calder**." };
      });
      t.loopModel!(model);
      const thread = t.thread();
      await thread.say("put together a coaching document for Remy Calder");
      const reply = await thread.say(PASTE);
      expect(reply.content, `the other person's account went on Remy's card:\n${reply.content}`).toMatch(/This account is about \*\*Tessa Varnell\*\*/);
    },
  },
  {
    id: "nov15-k4-a-witness-is-a-fact-and-not-asked",
    title: "K4, QA's ruling (no code exemption for a witness): \"coaching for Remy Calder, Remy left early on 11/14, Juno Paxton saw it\" lists Juno Paxton with her sentence in account_names_other_person, and the model, reading it as a witness, asks nothing",
    report: `${REPORT}; QA's K4 ruling, 15 Nov 2026`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      await salon(t);
      const model = loopStandIn((view): LoopDecision => {
        if (!lastResult(view, "find_staff")) return { tool: "find_staff", input: { name: "Remy Calder" } };
        const card = lastResult(view, "propose_form") as { facts?: { account_names_other_person?: unknown } } | null;
        if (!card) return { tool: "propose_form", input: { template_key: "coaching", employee_id: "e-2", what_happened: "Remy left early on 11/14, Juno Paxton saw it." } };
        return { text: "Here's the Coaching Form for **Remy Calder**." };
      });
      t.loopModel!(model);
      const reply = await t.thread().say("coaching for Remy Calder, Remy left early on 11/14, Juno Paxton saw it");
      const fact = (model.views.flatMap((view) => view.results).find((result) => result.tool === "propose_form")!.output as { facts?: { account_names_other_person?: { named: { name: { untrusted_text: string }; sentence: { untrusted_text: string } }[] } } }).facts?.account_names_other_person;
      expect(fact?.named.map((entry) => entry.name.untrusted_text)).toEqual(["Juno Paxton"]);
      expect(fact?.named[0]!.sentence.untrusted_text).toMatch(/Juno Paxton saw it/);
      expect(reply.content).toBe("Here's the Coaching Form for **Remy Calder**.");
    },
  },

);

/** Remy's Corrective Action card with Verbal, then the app's own reply, then the manager's answer (K5's shape). */
function payrollModel(appAsks: string) {
  return loopStandIn((view): LoopDecision => {
    const said = latest(view);
    const card = lastResult(view, "propose_form") as { card?: { payroll_deduct?: string | null } } | null;
    if (!lastResult(view, "find_staff")) return { tool: "find_staff", input: { name: "Remy Calder" } };
    // The model's slip: every later turn passes payroll yes once the manager said "yes", and drops it again after.
    const input = { template_key: "dpoa", employee_id: "e-2", what_happened: "She was below the company average last month in PPTA and spa %.", warning_level: "verbal" };
    if (!card) return { tool: "propose_form", input: /^yes/i.test(said) ? { ...input, payroll_deduct: "yes" } : input };
    // As the rules book teaches: payroll_said_earlier is passed again, once.
    const earlier = (card as { facts?: { payroll_said_earlier?: string } }).facts?.payroll_said_earlier;
    if (earlier && view.results.filter((result) => result.tool === "propose_form").length === 1) return { tool: "propose_form", input: { ...input, payroll_deduct: earlier } };
    return { text: /^yes/i.test(said) || /coaching/.test(said) ? `Here's the Corrective Action Form for **Remy Calder**.` : `Here's the Corrective Action Form for **Remy Calder**.\n\n${appAsks}` };
  });
}

NOV15_AGENT_LOOP_BATCH_K_CASES.push(
  {
    id: "nov15-k5b-payroll-answer-holds-on-later-turns-c163",
    title: "K5(b) (QA's shadow replay, c163 T6): after \"yes\" ticked payroll, \"we have already done coaching\" re-proposes the card and payroll stays yes, never silently empty",
    report: `${REPORT}: c163, at T6 payroll fell back to empty with no word to the manager`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      await salon(t);
      t.loopModel!(payrollModel("Payroll deduct isn't set; tell me if it applies."));
      const thread = t.thread();
      await thread.say("verbal CA for Remy Calder, she was below the company average last month in PPTA and spa %");
      await thread.say("yes");
      await thread.say("we have already done coaching");
      expect((thread.proposal as { payrollDeduct?: string | null } | null)?.payrollDeduct, "the payroll answer was dropped on a later turn").toBe("yes");
    },
  },
  {
    id: "nov15-k5b-payroll-answer-never-reaches-another-persons-card",
    title: "K5(b), scoped (rebuild plan bug 3): after \"yes\" ticked payroll on Remy Calder's card, \"now a CA for Juno Paxton, she was late on 11/14\" never carries that payroll to Juno's card, even when the model passes it",
    report: `${REPORT}; QA's rebuild plan, bug 3: one person's payroll answer unlocked another person's card`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      await salon(t);
      const remy = payrollModel("Payroll deduct isn't set; tell me if it applies.");
      t.loopModel!(remy);
      const thread = t.thread();
      await thread.say("verbal CA for Remy Calder, she was below the company average last month in PPTA and spa %");
      await thread.say("yes");
      expect((thread.proposal as { payrollDeduct?: string | null } | null)?.payrollDeduct, "Remy's payroll answer was not ticked").toBe("yes");
      t.loopModel!(loopStandIn((view): LoopDecision => {
        if (!lastResult(view, "find_staff")) return { tool: "find_staff", input: { name: "Juno Paxton" } };
        // The model's slip: the earlier person's payroll answer passed onto the next person's card.
        if (!lastResult(view, "propose_form")) return { tool: "propose_form", input: { template_key: "dpoa", employee_id: "e-3", what_happened: "She was late on 11/14.", incident_date: "2026-11-14", payroll_deduct: "yes" } };
        return { text: "Here's the Corrective Action Form for **Juno Paxton**." };
      }));
      await thread.say("now a CA for Juno Paxton, she was late on 11/14");
      expect(thread.proposal?.employeeName).toBe("Juno Paxton");
      expect((thread.proposal as { payrollDeduct?: string | null } | null)?.payrollDeduct ?? null, "Remy's payroll answer reached Juno's card").toBeNull();
    },
  },
);

NOV15_AGENT_LOOP_BATCH_K_CASES.push({
  id: "nov15-k6-a-date-from-another-persons-account-is-not-kept-c079",
  title: "K6 (QA's shadow replay, c079's shape): after Remy Calder's coaching dated from her account (10/16), \"create a coaching document for Juno Paxton\" with no date is never dated 10/16 (not_kept incident_date)",
  report: `${REPORT}: c079, the second person's card took the first person's date`,
  status: "fixed",
  fixFlags: [FLAG],
  async run(t) {
    if (!t.loopOn?.()) return;
    await salon(t);
    const model = loopStandIn((view): LoopDecision => {
      const said = latest(view);
      const juno = /juno paxton/i.test(said);
      if (!lastResult(view, "find_staff")) return { tool: "find_staff", input: { name: juno ? "Juno Paxton" : "Remy Calder" } };
      // The model's slip: the earlier account's date carried onto the next person's card.
      if (!lastResult(view, "propose_form")) return { tool: "propose_form", input: juno ? { template_key: "coaching", employee_id: "e-3", incident_date: "2026-10-16" } : { template_key: "coaching", employee_id: "e-2", what_happened: "On 10-16-26 the policy acknowledgement report showed Remy Calder did not complete her acknowledgements.", incident_date: "2026-10-16" } };
      return { text: `Here's the Coaching Form for **${juno ? "Juno Paxton" : "Remy Calder"}**.` };
    });
    t.loopModel!(model);
    const thread = t.thread();
    await thread.say("create a coaching document for Remy Calder regarding On 10-16-26 the policy acknowledgement report showed Remy did not complete her acknowledgements");
    expect(thread.proposal?.formDate, "the first card's date is not its account's").toBe("2026-10-16");
    await thread.say("create a coaching document for Juno Paxton");
    expect(thread.proposal?.employeeName).toBe("Juno Paxton");
    expect(thread.proposal?.formDate, "the second person's card took the first person's date").not.toBe("2026-10-16");
  },
});

NOV15_AGENT_LOOP_BATCH_K_CASES.push({
  id: "nov15-k12b-confirm-question-also-asks-what-happened-c009",
  title: "K12b (QA's D ruling, the c009/c015/c185 shape): \"put together a coaching document for Remi Calder\" asks \"Did you mean **Remy Calder**? … If so, tell me what happened.\" in one reply; \"yes, she was late to her shift on 11/14\" gives the ready card in the next turn, with no second question",
  report: `${REPORT}: c009, c015, c185, the confirm question then a separate "What happened?" turn`,
  status: "fixed",
  fixFlags: [FLAG],
  async run(t) {
    if (!t.loopOn?.()) return;
    await salon(t);
    const model = loopStandIn((view): LoopDecision => {
      const said = latest(view);
      const staff = lastResult(view, "find_staff") as (StaffResult & { also_ask_if_no_account?: string }) | null;
      const confirmed = /^yes\b/i.test(said);
      if (!staff) return { tool: "find_staff", input: { name: confirmed ? "Remy Calder" : "Remi Calder" } };
      const asked = /Ask the manager, in these words: ([\s\S]+)$/.exec(staff.note ?? "")?.[1];
      if (asked) return { text: [asked, staff.also_ask_if_no_account].filter(Boolean).join("\n\n") };
      const person = staff.matches?.[0];
      if (person && !lastResult(view, "propose_form")) return { tool: "propose_form", input: { template_key: "coaching", employee_id: person.employee_id, what_happened: said.replace(/^yes,?\s*/i, ""), incident_date: "2026-11-14" } };
      return { text: `Here's the Coaching Form for **${person?.name ?? ""}**.` };
    });
    t.loopModel!(model);
    const thread = t.thread();
    const ask = await thread.say("put together a coaching document for Remi Calder");
    expect(ask.content).toMatch(/Did you mean \*\*Remy Calder\*\*\?[\s\S]*If so, tell me what happened\./);
    await thread.say("yes, she was late to her shift on 11/14");
    expect(thread.proposal?.employeeName).toBe("Remy Calder");
    expect(thread.proposal?.status, "the card is not ready after the one answer").toBe("ready");
  },
});
