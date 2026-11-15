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
    status: { open: "\"Using **Remy Calder** from your staff list.\": the close spelling is seated (Pau's 14 Nov one-strong-close-match)" },
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
    status: { open: "\"A close spelling of Remy Calder, the person on this chat's card. Use them\"" },
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

/** A stand-in that reads the name as a topic and asks who, until the app's check hands the name back (K3b's slip). */
function topicModel(name: string) {
  return loopStandIn((view): LoopDecision => {
    const said = latest(view);
    const staff = lastResult(view, "find_staff") as StaffResult;
    if (!/\[app check\]/.test(said) && !staff) return { text: "Corrective Action citing **Standards of Conduct** (p.12). Who is it for?" };
    if (!staff) return { tool: "find_staff", input: { name } };
    const asked = /Ask the manager, in these words: ([\s\S]+)$/.exec(staff.note ?? "")?.[1];
    return { text: asked ?? "Who is this form for?" };
  });
}

NOV15_AGENT_LOOP_BATCH_K_CASES.push(
  {
    id: "nov15-k3-one-word-name-gets-the-use-offer-c134",
    title: "K3a (QA's shadow replay, c134's shape): \"put together an exit for Wrenna\", nobody on the roster, gets \"Reply **use Wrenna**\"; \"use Wrenna\" makes the Exit card for Wrenna, never \"it does not read as a person's name\"",
    report: `${REPORT}: c134 and the B group, an off-roster first name judged not a person's name, so the form was never carded`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      await salon(t);
      const model = loopStandIn((view): LoopDecision => {
        const said = latest(view);
        const staff = lastResult(view, "find_staff") as StaffResult;
        if (/^use wrenna/i.test(said)) {
          if (!lastResult(view, "propose_form")) return { tool: "propose_form", input: { template_key: "stc-exit", employee_name: "Wrenna", effective_date: "11/14" } };
          return { text: "Here's the Employee Exit Form for **Wrenna**." };
        }
        if (!staff) return { tool: "find_staff", input: { name: "Wrenna" } };
        const asked = /Ask the manager, in these words: ([\s\S]+)$/.exec(staff.note ?? "")?.[1];
        return { text: asked ?? "Who is this Resignation/Exit Form for?" };
      });
      t.loopModel!(model);
      const thread = t.thread();
      const offer = await thread.say("put together an exit for Wrenna");
      expect(offer.content, `no use-<name> offer:\n${offer.content}`).toContain("Reply **use Wrenna**");
      await thread.say("use Wrenna");
      expect(thread.proposal?.employeeName, "the exit was not carded for the name as typed").toBe("Wrenna");
    },
  },
  ...([
    ["c165", "I need to make a corrective action for Brisa", "Brisa"],
    ["c124", "Talia", "Talia"],
  ] as const).map(([tag, words, name]): ReplayCase => ({
    id: `nov15-k3-name-not-looked-up-is-handed-back-${tag}`,
    title: `K3b (QA's shadow replay, ${tag}'s shape): "${words}" answered with "Who is it for?" and no find_staff call goes back once with "${name}" as a fact, and the reply makes today's "use ${name}" offer`,
    report: `${REPORT}: ${tag}, a name in the person slot read as a topic and never looked up`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      await salon(t);
      const model = topicModel(name);
      t.loopModel!(model);
      const thread = t.thread();
      if (tag === "c124") {
        t.loopModel!(loopStandIn(() => ({ text: "Coaching Form citing **Attendance** (JBA Policy Manual p.14). Who is it for?" })));
        await thread.say("attendance policy coaching form");
        t.loopModel!(model);
      }
      const reply = await thread.say(words);
      expect(model.views.some((view) => /\[app check\][\s\S]*find_staff was not called/.test(latest(view))), "the name was not handed back").toBe(true);
      expect(reply.content, `no use-<name> offer:\n${reply.content}`).toContain(`Reply **use ${name}**`);
    },
  })),
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
        const card = lastResult(view, "propose_form") as { facts?: { account_names_other_person?: { named: { untrusted_text: string }[]; card_person: string } } } | null;
        if (/Observation of Concern/.test(said)) {
          if (!card) return { tool: "propose_form", input: { template_key: "coaching", employee_id: "e-2", what_happened: said } };
          const other = card.facts?.account_names_other_person;
          return { text: other ? `This account is about **${other.named[0]!.untrusted_text}**. Is the form for **${other.named[0]!.untrusted_text}** or **${other.card_person}**?` : "Added your account to the Coaching Form for **Remy Calder**." };
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
    id: "nov15-k4-an-account-naming-the-card-person-is-not-asked",
    title: "K4, the control: an account that names the card's own person (\"Remy left early on 11/14, Juno Paxton saw it\") gives no account_names_other_person",
    report: `${REPORT}; the control`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      await salon(t);
      const model = loopStandIn((view): LoopDecision => {
        if (!lastResult(view, "find_staff")) return { tool: "find_staff", input: { name: "Remy Calder" } };
        const card = lastResult(view, "propose_form") as { facts?: Record<string, unknown> } | null;
        if (!card) return { tool: "propose_form", input: { template_key: "coaching", employee_id: "e-2", what_happened: "Remy left early on 11/14, Juno Paxton saw it." } };
        return { text: card.facts?.account_names_other_person ? "This account is about someone else." : "Here's the Coaching Form for **Remy Calder**." };
      });
      t.loopModel!(model);
      const reply = await t.thread().say("coaching for Remy Calder, Remy left early on 11/14, Juno Paxton saw it");
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
    id: "nov15-k5a-bare-yes-after-a-payroll-only-question-ticks-payroll-c163",
    title: "K5(a) (QA's ruling on c163): a bare \"yes\" after a reply whose only open question was payroll (\"Payroll deduct isn't set; tell me if it applies.\") ticks payroll yes",
    report: `${REPORT}: c163, QA's ruling that this reading stands`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      await salon(t);
      t.loopModel!(payrollModel("Payroll deduct isn't set; tell me if it applies."));
      const thread = t.thread();
      await thread.say("verbal CA for Remy Calder, she was below the company average last month in PPTA and spa %");
      await thread.say("yes");
      expect((thread.proposal as { payrollDeduct?: string | null } | null)?.payrollDeduct).toBe("yes");
    },
  },
  {
    id: "nov15-k5a-bare-yes-after-two-questions-ticks-nothing",
    title: "K5(a) (QA's ruling): a bare \"yes\" after a reply that asked two things (\"Payroll deduct and warning level aren't set; tell me if they apply.\") ticks no payroll",
    report: `${REPORT}: c163, QA's ruling (ask which when two or more things were asked)`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      await salon(t);
      t.loopModel!(payrollModel("Payroll deduct and warning level aren't set; tell me if they apply."));
      const thread = t.thread();
      await thread.say("CA for Remy Calder, she was below the company average last month in PPTA and spa %");
      await thread.say("yes");
      expect((thread.proposal as { payrollDeduct?: string | null } | null)?.payrollDeduct ?? null, "a bare yes to two questions was ticked as payroll").toBeNull();
    },
  },
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
