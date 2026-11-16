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
 *    card: not_on_roster, ambiguous_person, did_you_mean with keep-as-typed (QA: one case each), a word that is no one.
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
 * find_staff's own; only when find_staff gave none does propose_form add person_unclear (every refusal has a code).
 */
function asFindStaff(proposed: Record<string, unknown>, staff: Record<string, unknown>): Record<string, unknown> {
  const { card, looked_up_by, error, ...rest } = proposed;
  void card;
  void looked_up_by;
  void error;
  if (!("reason_code" in staff) && rest.reason_code === "person_unclear") delete rest.reason_code;
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
