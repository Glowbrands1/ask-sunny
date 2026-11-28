import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";
import { evidenceFrom, lastResult, loopStandIn, type LoopDecision, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * COACHING AND CORRECTIVE-ACTION ADVICE STARTS FROM THE EMPLOYEE'S FORMS ON FILE (the owner, 28 Nov 2026)
 * ============================================================================
 *
 * The owner: "yes please both apps, same with CA". A coaching or corrective-action advice question that names an
 * employee was answered from what the manager typed and the company's documents only, as if it were the first
 * conversation, while that person's earlier Corrective Action sat in Form Monitoring. Such advice now counts as asking
 * about the person's forms on file (the owner chose this over the 14 Nov rule, for this kind of turn only): the loop
 * hands back an answer written without find_past_forms, and the older chat path reads the FORMS ON FILE block. The
 * employee and her form are invented.
 */

const LOOP = "AGENT_LOOP_ENABLED";
const REPORT = "The owner, 28 Nov 2026: coaching and corrective-action advice about a named employee looks up their past coaching and write-ups first (\"yes please both apps, same with CA\")";
const COACH = "how do I coach Odile Fenwick who keeps showing up late";
const CA = "should Odile get a written warning for being late again?";

const ODILE = { id: "e-9", firstName: "Odile", lastName: "Fenwick", preferredFirstName: null, employmentStatus: "active", salonIds: [KEARNEY.primaryAreaId], positionName: "Tanning Consultant" };
const ON_FILE_DATE = "2026-10-03";

/** Odile's Verbal Corrective Action for tardiness, finalized on 10/3, as saved. */
function onFile(t: ReplayContext): void {
  const ids = t.templateIds!("dpoa");
  (t.forms() as Record<string, unknown>[]).push({
    id: "ca-odile-oct", ...ids, variant_key: null, employee_role: null, location_id: KEARNEY.primaryAreaId, location_name: "NE Kearney",
    created_by: "another-manager", created_by_role: "salon_director", source: "ask_sunny", status: "finalized", follow_up_date: null, archived_at: null,
    revises_instance_id: null, template_key: "dpoa", template_name: "Corrective Action Form", employee_name: "Odile Fenwick", form_date: ON_FILE_DATE,
    created_at: `${ON_FILE_DATE}T15:00:00Z`, updated_at: `${ON_FILE_DATE}T15:00:00Z`,
  });
  t.typeOnForm("ca-odile-oct", { observation: "Odile clocked in 20 minutes late on 10/3/26." });
  t.checkOnForm!("ca-odile-oct", { warning_type: ["verbal"] });
}

function start(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-11-28T18:00:00Z"));
  t.directory([...STAFF, ODILE]);
  t.as("salon_director", KEARNEY);
  onFile(t);
}

/** A complete prep package that never looked at what is on file: it reads as a first conversation. */
const FIRST_TIME = [
  "1. Opening: set a calm, private tone.",
  "2. The facts and the expectation.",
  "3. Listen to Odile's side.",
  "4. Agree on next steps.",
  "5. Follow-up date: one week from today.",
  "",
  "\"I wanted to talk with you about the last few shifts, because the team counts on you and I want to help.\"",
  "",
  "Role-play: you play Odile and push back once.",
  "Action plan: on time for five shifts in a row; follow-up next week.",
].join("\n");

/** The package built on what is on file: it says so first, and the script and the plan fit a second conversation. */
const FROM_HISTORY = [
  "On file for Odile: a Verbal Corrective Action for tardiness on 10/03/2026.",
  "",
  "1. Opening: this is your second conversation about lateness.",
  "2. The facts since the verbal on 10/3, and the expectation.",
  "3. Listen to Odile's side.",
  "4. Agree on next steps.",
  "5. Follow-up date: one week from today.",
  "",
  "\"We talked about getting in on time on October 3rd, and it has happened again, so I want to be clear about what comes next.\"",
  "",
  "Role-play: you play Odile and push back once.",
  "Action plan: on time for every shift; follow-up next Friday. The next step after a verbal is yours to decide.",
].join("\n");

const handedBackFor = (views: readonly LoopView[]) => views.some((view) => /\[app check\][^\n]*without looking at [^\n]*forms on file/.test(view.turns.at(-1)?.text ?? ""));
const readsOf = (views: readonly LoopView[]) => views.flatMap((view) => view.results).filter((result) => result.tool === "find_past_forms").map((result) => JSON.stringify(result.output));

/** Searches the guide, answers without the history, then on the app's hand-back looks the person up and answers again. */
function forgetsThenLooks(person: string) {
  return loopStandIn((view: LoopView): LoopDecision => {
    if (lastResult(view, "find_past_forms")) return { text: FROM_HISTORY };
    if (handedBackFor([view])) return { tool: "find_past_forms", input: { employee_name: person, forms_on_file_evidence: evidenceFrom(view, person.split(" ")[0]) } };
    if (!lastResult(view, "search_knowledge")) return { tool: "search_knowledge", input: { query: "coaching conversation lateness" } };
    return { text: FIRST_TIME };
  });
}

const loopCase = (id: string, title: string, run: (t: ReplayContext) => Promise<void>): ReplayCase => ({
  id, title, report: REPORT, status: "fixed", fixFlags: [LOOP],
  async run(t) {
    if (!t.loopOn?.() || process.env.AGENT_LOOP_LIVE === "1") return;
    await run(t);
  },
});

export const NOV28_COACHING_HISTORY_FIRST_CASES: ReplayCase[] = [
  loopCase("nov28-coaching-history-first-coach", `"${COACH}": an answer written without her forms on file goes back, find_past_forms reads her Verbal CA of 10/3, and the answer is built on it`, async (t) => {
    start(t);
    const standIn = forgetsThenLooks("Odile Fenwick");
    t.loopModel!(standIn);
    const reply = await t.thread().say(COACH);
    expect(standIn.views[0]?.system ?? "", "the rules book does not say such advice asks about the person's forms on file").toMatch(/Coaching or corrective-action advice that names an employee[^.]*asks about that person's forms on file too/);
    expect(handedBackFor(standIn.views), "an answer written without the forms on file was kept").toBe(true);
    const reads = readsOf(standIn.views);
    expect(reads.join("\n"), "find_past_forms was refused or never read her form").not.toMatch(/privacy_not_asked|privacy_not_this_person/);
    expect(reads.join("\n"), "her Verbal CA did not reach the model").toContain("ca-odile-oct");
    expect(reply.content, reply.content).toMatch(/On file for Odile/);
    expect(reply.formProposal ?? null, "a card was made for an advice question").toBeNull();
  }),
  loopCase("nov28-coaching-history-first-ca", `"${CA}" (corrective-action advice, first name only): goes back to read her forms on file, and the answer starts from them`, async (t) => {
    start(t);
    const standIn = forgetsThenLooks("Odile Fenwick");
    t.loopModel!(standIn);
    const reply = await t.thread().say(CA);
    expect(handedBackFor(standIn.views), "corrective-action advice written without her forms on file was kept").toBe(true);
    expect(readsOf(standIn.views).join("\n"), "her Verbal CA did not reach the model").toContain("ca-odile-oct");
    expect(reply.content, reply.content).toMatch(/On file for Odile/);
    expect(reply.formProposal ?? null, "a card was made for an advice question").toBeNull();
  }),
  loopCase("nov28-coaching-history-first-lower-case", "\"tips for talking to odile fenwick about being late\" (her full name in lower case): goes back to read her forms on file", async (t) => {
    start(t);
    const standIn = forgetsThenLooks("Odile Fenwick");
    t.loopModel!(standIn);
    await t.thread().say("tips for talking to odile fenwick about being late");
    expect(handedBackFor(standIn.views), "advice about her, typed in lower case, was kept without her forms on file").toBe(true);
    expect(readsOf(standIn.views).join("\n"), "her Verbal CA did not reach the model").toContain("ca-odile-oct");
  }),
  loopCase("nov28-coaching-history-first-live-wording", "The owner's live check: the role-play line \"have her practice the call-in process\" names her (not \"Odile's practice\"), and \"(the coaching guide, [S1])\" leaves no comma behind", async (t) => {
    start(t);
    const live = [
      "On file for Odile: a Verbal Corrective Action for tardiness on 10/03/2026.",
      "",
      "Words to use (Salon Coaching Guide, [S1]): \"We talked about getting in on time on October 3rd, and it has happened again, so I want to be clear about what comes next.\"",
      "",
      "Role-play: You play Odile and give a common excuse (overslept, car trouble); have her practice the call-in process and proposing a concrete fix.",
    ].join("\n");
    const standIn = loopStandIn((view: LoopView): LoopDecision => {
      if (!lastResult(view, "search_knowledge")) return { tool: "search_knowledge", input: { query: "coaching conversation lateness" } };
      if (!lastResult(view, "find_past_forms")) return { tool: "find_past_forms", input: { employee_name: "Odile Fenwick", forms_on_file_evidence: evidenceFrom(view, "Odile Fenwick") } };
      return { text: live };
    });
    t.loopModel!(standIn);
    const reply = await t.thread().say(COACH);
    expect(reply.content, reply.content).toContain("have Odile practice the call-in process");
    expect(reply.content, reply.content).not.toMatch(/Odile's practice/);
    expect(reply.content, reply.content).toContain("Words to use (Salon Coaching Guide):");
    expect(reply.content, reply.content).not.toMatch(/,\)/);
  }),
  loopCase("nov28-coaching-history-first-looked-already", "Control: advice that looked at her forms on file first is kept as written (no hand-back)", async (t) => {
    start(t);
    const standIn = loopStandIn((view: LoopView): LoopDecision => {
      if (!lastResult(view, "search_knowledge")) return { tool: "search_knowledge", input: { query: "coaching conversation lateness" } };
      if (!lastResult(view, "find_past_forms")) return { tool: "find_past_forms", input: { employee_name: "Odile Fenwick", forms_on_file_evidence: evidenceFrom(view, "Odile Fenwick") } };
      return { text: FROM_HISTORY };
    });
    t.loopModel!(standIn);
    const reply = await t.thread().say(COACH);
    expect(handedBackFor(standIn.views), "an answer that looked first was handed back").toBe(false);
    expect(reply.content).toBe(FROM_HISTORY);
  }),
  loopCase("nov28-coaching-history-first-nobody-named", "Control: \"how do I coach someone who keeps showing up late\" names nobody: no forms on file are looked at", async (t) => {
    start(t);
    const standIn = loopStandIn((view: LoopView): LoopDecision => (lastResult(view, "search_knowledge") ? { text: FIRST_TIME } : { tool: "search_knowledge", input: { query: "coaching conversation lateness" } }));
    t.loopModel!(standIn);
    await t.thread().say("how do I coach someone who keeps showing up late");
    expect(handedBackFor(standIn.views), "advice about nobody in particular was sent to look at forms on file").toBe(false);
    expect(readsOf(standIn.views), "forms on file were read for nobody in particular").toEqual([]);
  }),
  loopCase("nov28-coaching-history-first-form-request", "Control: a form request (\"write up Odile for being late today\") is not sent to look at forms on file by this check", async (t) => {
    start(t);
    const standIn = loopStandIn((): LoopDecision => ({ text: "What happened today, and what time did she arrive?" }));
    t.loopModel!(standIn);
    await t.thread().say("write up Odile for being late today");
    expect(handedBackFor(standIn.views), "a form request was handed back to look at forms on file").toBe(false);
  }),
  {
    id: "nov28-chat-coaching-history-first",
    title: `The older chat path: "${COACH}" is answered with her forms on file attached and the rule to build on them`,
    report: REPORT,
    status: "fixed",
    async run(t) {
      start(t);
      t.modelSays(FROM_HISTORY);
      await t.thread().say(COACH);
      const system = t.lastSystem?.() ?? "";
      expect(system, "the older prompt does not say to start from the forms on file").toMatch(/that advice also asks about that person's forms on file: look at them first/);
      expect(system, "her forms on file were not attached").toMatch(/FORMS ALREADY ON FILE/);
    },
  },
];
