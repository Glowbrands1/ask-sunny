import { expect, vi } from "vitest";

import { STEP_LIMIT_REPLY } from "@/lib/ai/agent-loop/replies";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayCase, type ReplayContext } from "./cases";
import { evidenceFrom, lastResult, loopStandIn, type LoopDecision, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * REBUILD PLAN PR 6: SPEED (QA, 16 Nov 2026; the Runner's timed re-run: a turn costs about 4.5 s per model call)
 * ============================================================================
 *
 * General rules this PR adds, and the cases here:
 * 1. A card needs no find_staff step: propose_form looks a typed name up with find_staff's own code. One person and
 *    nothing to ask → the card (2 model calls instead of 3). Anything else → find_staff's own result, unchanged, and no
 *    card: not_on_roster, ambiguous_person, did_you_mean with keep-as-typed (QA: one case each); a name it finds no one
 *    for and says nothing about falls to propose_form's own not_on_roster refusal (the retry guard's, #1054).
 * 2. The policy manual is read once per turn (never kept past it).
 * 3. One budget for the turn's model calls: AGENT_LOOP_MAX_STEPS counts the reviser's own calls too, and a reviser
 *    that would leave no room for the reply is refused (reason_code step_budget), so the turn ends with a reply.
 * 4. find_staff says when it cut its list at 10 (more_matches).
 * Invented names only (Remy Calder, Sky Ardent, the Sam list).
 */

const FLAG = "AGENT_LOOP_ENABLED";
const REPORT = "Rebuild plan PR 6, speed (QA, 16 Nov 2026)";

type Trace = { stopped: string; steps_used: number; step_limit: number; model_calls: number; tool_model_calls?: number; steps: { tool: string; error_kind?: string; model_calls?: number }[] };
const loopTraceOf = (t: ReplayContext): Trace | undefined => {
  const row = [...(t.rows?.("chat_traces") ?? [])].reverse().find((entry) => (entry.slots as { agent_loop?: unknown } | undefined)?.agent_loop);
  return (row?.slots as { agent_loop: Trace } | undefined)?.agent_loop;
};

const SKY: DirectoryRow[] = [
  { id: "e-20", firstName: "Sky", lastName: "Ardent", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0309"], positionName: "Tanning Consultant" },
  { id: "e-21", firstName: "Sky", lastName: "Ardent", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0309"], positionName: "Salon Director" },
];
const SAMS: DirectoryRow[] = ["Abbot", "Briar", "Crane", "Dorsey", "Ellery", "Fenwick", "Garland", "Hollis", "Ingram", "Jessop", "Kerrow", "Lindell"].map((lastName, index) => ({
  id: `e-s${index}`, firstName: "Sam", lastName, preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0309"], positionName: "Tanning Consultant",
}));

function setUp(t: ReplayContext, extra: DirectoryRow[] = []) {
  vi.setSystemTime(new Date("2026-11-14T22:40:00Z"));
  t.directory([...STAFF, ...extra]);
  t.as("salon_director", KEARNEY);
}

/** propose_form's facts (they sit under `facts` on its result). */
const factsOf = (output: Record<string, unknown>) => (output.facts ?? {}) as Record<string, unknown>;

/** The tool result a turn's stand-in got, for the first call of that tool. */
const firstResult = (views: readonly LoopView[], tool: string) => views.flatMap((view) => view.results).find((result) => result.tool === tool)?.output ?? null;

/**
 * The same message twice in fresh chats: find_staff's own answer, then propose_form's with employee_name. Returns both,
 * so a case can check propose_form handed back exactly find_staff's reason code and facts, and made no card.
 */
async function lookupBothWays(t: ReplayContext, message: string, name: string, quote: string) {
  const viaFindStaff = loopStandIn((view): LoopDecision => (lastResult(view, "find_staff") ? { text: "Asked." } : { tool: "find_staff", input: { name, person_evidence: evidenceFrom(view, quote) } }));
  t.loopModel!(viaFindStaff);
  await t.thread().say(message);
  const viaPropose = loopStandIn((view): LoopDecision => (lastResult(view, "propose_form") ? { text: "Asked." } : { tool: "propose_form", input: { template_key: "dpoa", employee_name: name, person_evidence: evidenceFrom(view, quote), what_happened: "She was 20 minutes late on 11/12." } }));
  t.loopModel!(viaPropose);
  const reply = await t.thread().say(message);
  const staff = firstResult(viaFindStaff.views, "find_staff")!;
  const proposed = firstResult(viaPropose.views, "propose_form")!;
  return { staff, proposed, reply };
}

/**
 * propose_form's result without its own keys: what is left must be find_staff's result, unchanged. Its reason_code is
 * find_staff's own; only a Did you mean (find_staff gives it no code) gets propose_form's name_to_confirm.
 */
function asFindStaff(proposed: Record<string, unknown>, staff: Record<string, unknown>): Record<string, unknown> {
  const { card, looked_up_by, error, ...rest } = proposed;
  void card;
  void looked_up_by;
  void error;
  if (!("reason_code" in staff) && rest.reason_code === "name_to_confirm") delete rest.reason_code;
  return rest;
}

async function expectSameAsFindStaff(t: ReplayContext, message: string, name: string, quote: string, check: (staff: Record<string, unknown>) => void) {
  const { staff, proposed, reply } = await lookupBothWays(t, message, name, quote);
  check(staff);
  expect(asFindStaff(proposed, staff), `propose_form changed find_staff's answer:\nfind_staff ${JSON.stringify(staff)}\npropose_form ${JSON.stringify(proposed)}`).toEqual(staff);
  expect(proposed.card, "a card was made").toBeNull();
  expect(proposed.looked_up_by).toBe("propose_form");
  expect(typeof proposed.error, "no card, yet no refusal").toBe("string");
  expect(reply.formProposal ?? null, "a card reached the screen").toBeNull();
}

export const NOV16_AGENT_LOOP_PR6_SPEED_CASES: ReplayCase[] = [
  {
    id: "nov16-pr6-card-from-typed-name-two-calls",
    title: "PR 6 item 1: \"ca for remy calder …\": propose_form with employee_name looks Remy Calder up itself and makes the card with no find_staff step: 2 model calls (card, reply) instead of 3, the roster's person on the card",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      setUp(t);
      const model = loopStandIn((view): LoopDecision => (lastResult(view, "propose_form")
        ? { text: "Here's the Corrective Action Form for **Remy Calder**." }
        : { tool: "propose_form", input: { template_key: "dpoa", employee_name: "remy calder", person_evidence: evidenceFrom(view, "ca for remy calder"), what_happened: "Remy Calder was 20 minutes late on 11/12.", incident_date: "2026-11-12" } }));
      t.loopModel!(model);
      const reply = await t.thread().say("ca for remy calder, she was 20 minutes late on 11/12");
      expect(reply.formProposal?.employeeName, reply.content).toBe("Remy Calder");
      const trace = loopTraceOf(t)!;
      expect(trace.steps.map((step) => step.tool), "find_staff ran").toEqual(["propose_form"]);
      expect(trace.model_calls, "more than 2 model calls for the card").toBe(2);
      expect(firstResult(model.views, "propose_form")?.looked_up_by).toBe("propose_form");
    },
  },
  {
    id: "nov16-pr6-propose-lookup-not-on-roster",
    title: "PR 6 item 1 (QA: one case each): a one-word name nobody on the roster has, through propose_form: find_staff's not_on_roster and \"reply **use <name>**\" question, unchanged, and no card",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      setUp(t);
      await expectSameAsFindStaff(t, "an exit for wrenna, she quit", "wrenna", "an exit for wrenna", (staff) => {
        expect(staff.reason_code, JSON.stringify(staff)).toBe("not_on_roster");
        expect(String(staff.note)).toMatch(/use wrenna/i);
      });
    },
  },
  {
    id: "nov16-pr6-propose-lookup-ambiguous-person",
    title: "PR 6 item 1 (QA: one case each): two Sky Ardents on the roster, through propose_form: find_staff's ambiguous_person, both matches and \"ask which one\", unchanged, and no card",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      setUp(t, SKY);
      await expectSameAsFindStaff(t, "ca for sky ardent, she was late on 11/12", "sky ardent", "ca for sky ardent", (staff) => {
        expect(staff.reason_code, JSON.stringify(staff)).toBe("ambiguous_person");
        expect((staff.matches as unknown[]).length).toBe(2);
      });
    },
  },
  {
    id: "nov16-pr6-propose-lookup-did-you-mean-keep-as-typed",
    title: "PR 6 item 1 (QA: one case each; Pau's ruling A): \"remi calder\" through propose_form: find_staff's did_you_mean (Remy Calder) with the keep-as-typed offer, unchanged, never auto-picked, and no card",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      setUp(t);
      await expectSameAsFindStaff(t, "ca for remi calder, she was late on 11/12", "remi calder", "ca for remi calder", (staff) => {
        expect((staff.did_you_mean as { name: string }[] | undefined)?.map((row) => row.name), JSON.stringify(staff)).toEqual(["Remy Calder"]);
        expect(String(staff.note)).toMatch(/keep \*\*remi calder\*\* as you typed it/i);
      });
    },
  },
  {
    id: "nov16-pr6-propose-lookup-retry-guard-per-person",
    title: "PR 6 item 1 with the retry guard (#1054; QA: the per-person count through propose_form's own lookup): \"Odalis\", nobody on the roster, proposed twice with no find_staff step: not_on_roster with the use-Odalis question, then stop_retrying with it; a third call is not run; and find_staff + propose_form for that name count together",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      setUp(t);
      const USE_ODALIS = "I can't find **Odalis** on your staff list. Reply **use Odalis** to put the name on the form as you typed it, or give me the full name.";
      type Out = { reason_code?: string; ask_exactly?: string; stop_retrying?: { reason_code: string; ask_exactly?: string } };
      const all = (views: readonly LoopView[]) => views.reduce<{ tool: string; output: Record<string, unknown> }[]>((most, view) => (view.results.length > most.length ? [...view.results] : most), []);
      const propose = (view: LoopView) => ({ tool: "propose_form", input: { template_key: "dpoa", employee_name: "Odalis", person_evidence: evidenceFrom(view, "ca for odalis"), what_happened: "She was late on 11/12.", incident_date: "2026-11-12" } });

      // propose_form alone, three times: refused, stopped, not run.
      const only = loopStandIn((view): LoopDecision => {
        const latest = view.results.at(-1)?.output as Out | undefined;
        if (view.results.length >= 3) return { text: `Odalis isn't on your staff list yet. ${(latest?.stop_retrying?.ask_exactly ?? latest?.ask_exactly) ?? ""}`.trim() };
        return propose(view);
      });
      t.loopModel!(only);
      const reply = await t.thread().say("ca for odalis, late on 11/12");
      const outs = all(only.views).map((result) => result.output as Out);
      expect(outs[0]!.reason_code, JSON.stringify(outs)).toBe("not_on_roster");
      expect(outs[0]!.ask_exactly).toBe(USE_ODALIS);
      expect(outs[1]!.stop_retrying, JSON.stringify(outs[1])).toEqual({ reason_code: "not_on_roster", ask_exactly: USE_ODALIS });
      expect(outs[2]!.reason_code, "the third call ran").toBe("stop_retrying");
      expect(reply.content).toContain(USE_ODALIS);
      expect(reply.formProposal ?? null).toBeNull();

      // find_staff, then propose_form's own lookup, for the same name: one count, stopped by the second refusal.
      const mixed = loopStandIn((view): LoopDecision => {
        const latest = view.results.at(-1)?.output as Out | undefined;
        if (latest?.stop_retrying) return { text: `Odalis isn't on your staff list yet. ${latest.stop_retrying.ask_exactly ?? ""}`.trim() };
        if (view.results.length === 0) return { tool: "find_staff", input: { name: "Odalis", person_evidence: evidenceFrom(view, "ca for odalis") } };
        if (view.results.length >= 3) return { text: "Who is this for?" };
        return propose(view);
      });
      t.loopModel!(mixed);
      await t.thread().say("ca for odalis, late on 11/12");
      const mixedOuts = all(mixed.views).map((result) => [result.tool, (result.output as Out).reason_code, Boolean((result.output as Out).stop_retrying)]);
      expect(mixedOuts.slice(0, 2), JSON.stringify(mixedOuts)).toEqual([["find_staff", "not_on_roster", false], ["propose_form", "not_on_roster", true]]);
    },
  },
  {
    id: "nov16-pr6-propose-lookup-answer-bridge",
    title: "PR 6 item 1 with the retry guard's answer bridge (#1054; QA): propose_form's own lookup asks \"Reply **use Odalis**\"; the manager's \"use Odalis\" then makes the card with the name as typed, in one call, never a third question",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      setUp(t);
      const thread = t.thread();
      t.loopModel!(loopStandIn((view): LoopDecision => {
        const card = lastResult(view, "propose_form") as { ask_exactly?: string } | null;
        if (card) return { text: card.ask_exactly ?? "Who is this for?" };
        return { tool: "propose_form", input: { template_key: "dpoa", employee_name: "Odalis", person_evidence: evidenceFrom(view, "ca for odalis"), what_happened: "She was late on 11/12.", incident_date: "2026-11-12" } };
      }));
      const asked = await thread.say("ca for odalis, late on 11/12");
      expect(asked.content).toContain("Reply **use Odalis**");
      expect(asked.formProposal ?? null).toBeNull();
      const answer = loopStandIn((view): LoopDecision => (lastResult(view, "propose_form")
        ? { text: "Here's the Corrective Action Form for **Odalis** (not on your staff list; the name as you typed it)." }
        : { tool: "propose_form", input: { template_key: "dpoa", employee_name: "Odalis", person_evidence: evidenceFrom(view, "use Odalis"), what_happened: "She was late on 11/12.", incident_date: "2026-11-12" } }));
      t.loopModel!(answer);
      const carded = await thread.say("use Odalis");
      expect(carded.formProposal?.employeeName, carded.content).toBe("Odalis");
      expect(answer.views.flatMap((view) => view.results).filter((result) => result.tool === "propose_form").length, "more than one call for the card").toBe(1);
    },
  },
  {
    id: "nov16-pr6-one-call-coaching-keeps-its-policy",
    title: "PR 6 (the Runner's live comparison, 16 Nov 2026): a Coaching card made in one propose_form call (no find_staff, no read_policy), \"did not greet guests at the front desk\": with the policy passed, the card cites Standards of Conduct with its page; a call that leaves the policy out gets policy_not_given, and the card made after it cites the policy",
    report: `${REPORT}; the live comparison: #1059 gave this coaching card no policy line in both rounds`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      setUp(t);
      const message = "coaching form for marnie holloway, she did not greet guests at the front desk today";
      const card = (view: LoopView, policy?: string) => ({ tool: "propose_form", input: { template_key: "coaching", employee_name: "marnie holloway", person_evidence: evidenceFrom(view, "coaching form for marnie holloway"), what_happened: "She did not greet guests at the front desk.", ...(policy ? { policy } : {}) } });
      const policyOf = (reply: { formProposal?: unknown }) => String((reply.formProposal as { policyLine?: string } | undefined)?.policyLine ?? "");

      // The shape the live model takes: one call, the policy in it.
      t.loopModel!(loopStandIn((view): LoopDecision => (lastResult(view, "propose_form") ? { text: "Here's the Coaching Form for **Marnie Holloway**." } : card(view, "Standards of Conduct"))));
      const withPolicy = await t.thread().say(message);
      expect(policyOf(withPolicy), JSON.stringify(withPolicy.formProposal)).toMatch(/Standards of Conduct/);
      expect(policyOf(withPolicy)).toMatch(/p\.\s?\d+/);

      // A call that leaves the policy out is told so (a fact, no policy picked by code); the model's next call has it.
      const model = loopStandIn((view): LoopDecision => {
        const results = view.results.filter((result) => result.tool === "propose_form");
        if (results.length === 0) return card(view);
        if (results.length === 1 && factsOf(results[0]!.output).policy_not_given) return card(view, "Standards of Conduct");
        return { text: "Here's the Coaching Form for **Marnie Holloway**." };
      });
      t.loopModel!(model);
      const fixed = await t.thread().say(message);
      const first = model.views.flatMap((view) => view.results).find((result) => result.tool === "propose_form")!.output;
      expect(factsOf(first).policy_not_given, JSON.stringify(first)).toBeTruthy();
      expect(policyOf(fixed), JSON.stringify(fixed.formProposal)).toMatch(/Standards of Conduct/);
    },
  },
  {
    id: "nov16-pr6-one-call-exit-keeps-the-whole-account",
    title: "PR 6 (the Runner's live comparison, 16 Nov 2026): an exit card made in one propose_form call, \"<P> resigned by text, last day 11/13\": the full account is on the card; an account that drops the last day gets account_words_missing [11/13], an empty one gets account_not_given, and the card made after either keeps \"resigned by text\" and 11/13",
    report: `${REPORT}; the live comparison: #1059's exit account was empty in round 1 and lost the last day in round 2`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      setUp(t);
      const message = "exit form for rowan kestrel, she resigned by text, last day 11/13";
      const FULL = "Rowan Kestrel resigned by text; her last day was 11/13.";
      const exitCard = (view: LoopView, account?: string) => ({ tool: "propose_form", input: { template_key: "stc-exit", employee_name: "rowan kestrel", person_evidence: evidenceFrom(view, "exit form for rowan kestrel"), exit_type: "resignation", exit_evidence: { ...evidenceFrom(view, "exit form for rowan kestrel"), kind: "asks_for_exit_form" }, ...(account !== undefined ? { what_happened: account } : {}) } });

      t.loopModel!(loopStandIn((view): LoopDecision => (lastResult(view, "propose_form") ? { text: "Here's the Employee Exit Form for **Rowan Kestrel**." } : exitCard(view, FULL))));
      const whole = await t.thread().say(message);
      expect(whole.formProposal?.issue ?? "", JSON.stringify(whole.formProposal)).toMatch(/resigned by text/);
      expect(whole.formProposal?.issue ?? "").toMatch(/11\/13/);

      for (const [label, first, fact] of [["the last day dropped", "Rowan Kestrel resigned by text.", "account_words_missing"], ["no account", undefined, "account_not_given"]] as const) {
        const model = loopStandIn((view): LoopDecision => {
          const results = view.results.filter((result) => result.tool === "propose_form");
          if (results.length === 0) return exitCard(view, first);
          if (results.length === 1 && factsOf(results[0]!.output)[fact]) return exitCard(view, FULL);
          return { text: "Here's the Employee Exit Form for **Rowan Kestrel**." };
        });
        t.loopModel!(model);
        const reply = await t.thread().say(message);
        const out = model.views.flatMap((view) => view.results).find((result) => result.tool === "propose_form")!.output;
        expect(factsOf(out)[fact], `${label}: no ${fact} fact: ${JSON.stringify(out)}`).toBeTruthy();
        if (fact === "account_words_missing") expect(factsOf(out)[fact]).toEqual(expect.arrayContaining(["11/13"]));
        expect(reply.formProposal?.issue ?? "", `${label}: ${JSON.stringify(reply.formProposal)}`).toMatch(/resigned by text/);
        expect(reply.formProposal?.issue ?? "").toMatch(/11\/13/);
      }
    },
  },
  {
    id: "nov16-pr6-find-staff-more-matches",
    title: "PR 6 item 4: \"sam\" with 12 Sams on the roster: find_staff lists 10 and says more_matches (total 12), so a cut list is never read as everyone; propose_form hands the same back",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      setUp(t, SAMS);
      await expectSameAsFindStaff(t, "coaching for sam, late again", "sam", "coaching for sam", (staff) => {
        expect((staff.matches as unknown[]).length).toBe(10);
        expect(staff.more_matches, JSON.stringify(staff)).toBe(true);
        expect(staff.total_matches).toBe(12);
        expect(staff.reason_code).toBe("ambiguous_person");
      });
    },
  },
  {
    id: "nov16-pr6-manual-read-once-per-turn",
    title: "PR 6 item 2: the policy manual's sections are read once per turn (the system prompt, read_policy and propose_form share it); the next turn checks the manual's version and reuses the sections only when nothing changed; a new version (a sync) is read on the very next turn, never kept until the server restarts",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      setUp(t);
      const model = loopStandIn((view): LoopDecision => {
        if (!lastResult(view, "read_policy")) return { tool: "read_policy", input: { heading: "Attendance" } };
        if (!lastResult(view, "propose_form")) return { tool: "propose_form", input: { template_key: "dpoa", employee_name: "remy calder", person_evidence: evidenceFrom(view, "ca for remy calder"), policy: "Attendance", what_happened: "Remy Calder was 20 minutes late on 11/12.", incident_date: "2026-11-12" } };
        return { text: "Here's the Corrective Action Form for **Remy Calder**." };
      });
      t.loopModel!(model);
      const thread = t.thread();
      const reads = t.manualReads!();
      const checks = t.manualVersionChecks!();
      await thread.say("ca for remy calder, she was 20 minutes late on 11/12");
      expect(t.manualReads!() - reads, "the manual's sections were read more than once in one turn").toBe(1);
      expect(t.manualVersionChecks!() - checks, "the manual's version was not checked once this turn").toBe(1);

      // The next turn, nothing changed: one version check, the sections reused.
      const askPolicy = (heading: string) => loopStandIn((view): LoopDecision => (lastResult(view, "read_policy") ? { text: "Read." } : { tool: "read_policy", input: { heading } }));
      t.loopModel!(askPolicy("Attendance"));
      await thread.say("what page is the attendance policy on?");
      expect(t.manualReads!() - reads, "an unchanged manual was read again").toBe(1);
      expect(t.manualVersionChecks!() - checks).toBe(2);

      // A sync writes a new version with a new section: the very next turn reads it.
      t.manualAlsoHas!([{ chunkIndex: 900, chunkId: "jba-900", locator: "Page 70 — Fragrance Free Workplace", page: 71, content: "Fragrance Free Workplace\nTeam members do not wear strong scents on shift.", section: "Fragrance Free Workplace", printedPage: 70, sections: [] }]);
      const fresh = askPolicy("Fragrance Free Workplace");
      t.loopModel!(fresh);
      await thread.say("what does the fragrance free workplace policy say?");
      expect(t.manualReads!() - reads, "a new version of the manual was not read").toBe(2);
      const read = firstResult(fresh.views, "read_policy") as { error?: string; heading?: string } | null;
      expect(read?.error, `the new section was not found: ${JSON.stringify(read)}`).toBeUndefined();
    },
  },
  {
    id: "nov16-pr6-step-budget-keeps-the-reply",
    title: "PR 6 item 3: at the default limit (6), 3 edits in a row where the third needs the reviser: the reviser is refused with step_budget (its 2 model calls and the reply would pass 6), and the turn ends with the model's own reply naming the 2 saved changes and the one not made, never the step-limit reply",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      vi.stubEnv("AGENT_LOOP_MAX_STEPS", "6");
      try {
        setUp(t);
        t.loopModel!(loopStandIn((view): LoopDecision => {
          if (!lastResult(view, "find_staff")) return { tool: "find_staff", input: { name: "remy calder" } };
          if (!lastResult(view, "propose_form")) return { tool: "propose_form", input: { template_key: "dpoa", employee_id: "e-2", what_happened: "Remy Calder was 20 minutes late on 11/12.", incident_date: "2026-11-12" } };
          return { text: "Here's the Corrective Action Form for **Remy Calder**." };
        }));
        const thread = t.thread();
        await thread.say("ca for remy calder, she was 20 minutes late on 11/12");
        const id = await thread.create();
        const observation = t.values(id).observation ?? "";
        const edits = [
          (view: LoopView) => ({ instance_id: id, values: { warning_type: "written" }, level_evidence: evidenceFrom(view, "make it a written") }),
          () => ({ instance_id: id, values: { form_date: "11/13" } }),
          () => ({ instance_id: id }),
        ];
        const model = loopStandIn((view): LoopDecision => {
          if (!lastResult(view, "read_form")) return { tool: "read_form", input: { instance_id: id } };
          const done = view.results.filter((result) => result.tool === "edit_form");
          if (done.length < edits.length) return { tool: "edit_form", input: edits[done.length]!(view) };
          const saved = done.flatMap((result) => (result.output.saved ?? []) as { field: string }[]).map((change) => change.field);
          const refused = done.filter((result) => result.output.reason_code === "step_budget").length;
          return { text: `Saved: ${saved.join(", ")}.${refused ? " I didn't add her account this time; please send it again." : ""}` };
        });
        t.loopModel!(model);
        const reply = await thread.say("make it a written, change the date to 11/13, and add that she said her car broke down");
        const trace = loopTraceOf(t)!;
        const third = model.views.at(-1)!.results.filter((result) => result.tool === "edit_form")[2]!.output;
        expect(third.reason_code, JSON.stringify(third)).toBe("step_budget");
        expect(third.step_budget).toBeTruthy();
        expect(trace.stopped, JSON.stringify(trace)).toBe("reply");
        expect(trace.steps_used).toBeLessThanOrEqual(trace.step_limit);
        expect(reply.content).not.toBe(STEP_LIMIT_REPLY);
        expect(reply.content).toMatch(/warning_type/);
        expect(reply.content).toMatch(/form_date/);
        expect(t.values(id).observation ?? "", "the refused reviser wrote").toBe(observation);
        expect(t.checked(id).warning_type).toEqual(["written"]);
      } finally {
        vi.unstubAllEnvs();
      }
    },
  },
];
