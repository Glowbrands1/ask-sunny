import { appendFileSync } from "node:fs";

import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayAnswer, type ReplayCase, type ReplayContext } from "./cases";
import { firstMatch, headingWith, lastResult, loopStandIn, type LoopDecision, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * THE TOOL LOOP (AGENT_LOOP_ENABLED; QA, 14 Nov 2026) ON THE REPORTED CHATS
 * ============================================================================
 *
 * Each case runs twice: with production's flags (the loop off: today's path, the
 * invariant must hold or the case says it is open) and with AGENT_LOOP_ENABLED
 * on, where the model is a stand-in (`loop-stand-in.ts`) that decides each step
 * from what it was shown. With the loop on, a case checks the CODE's side: what
 * the tools return (roster spellings, several same-named people, no salon as a
 * person, the manual's headings), what reaches the card, and that the next
 * turn's history holds the model's own reply. The live model's judgement is
 * QA's to measure on the test user. Every person is invented.
 */

const policyLine = (content: string) => content.split("\n").find((line) => /^\*\*Policy:?\*\*/.test(line)) ?? "";
const latest = (view: LoopView) => [...view.turns].reverse().find((turn) => turn.role === "user")?.text ?? "";
const managerTurns = (view: LoopView) => view.turns.filter((turn) => turn.role === "user").map((turn) => turn.text);

/**
 * AGENT_LOOP_MEASURE (dev, opt-in; nothing changes when unset): a JSON-lines file each case appends the model calls it
 * made to, loop off and on, for the pull request's calls-per-turn table. Counts only.
 */
const startCalls = new WeakMap<ReplayContext, ReturnType<ReplayContext["calls"]>>();
function measureFrom(t: ReplayContext) {
  startCalls.set(t, t.calls());
}
function measure(t: ReplayContext, id: string, turns: number, loopCalls: number) {
  if (!process.env.AGENT_LOOP_MEASURE) return;
  const before = startCalls.get(t) ?? { chat: 0, draft: 0, revision: 0, tool: 0, patch: 0 };
  const now = t.calls();
  const calls = Object.fromEntries(Object.entries(now).map(([key, value]) => [key, value - before[key as keyof typeof before]]));
  // The loop's own tokens, from this case's chat_traces rows (each model call's usage, `slots.agent_loop.model_steps`).
  const tokens = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
  for (const row of t.rows?.("chat_traces") ?? []) {
    const steps = ((row.slots as { agent_loop?: { model_steps?: Record<string, number>[] } } | undefined)?.agent_loop?.model_steps ?? []);
    for (const step of steps) for (const key of Object.keys(tokens) as (keyof typeof tokens)[]) tokens[key] += step[key] ?? 0;
  }
  appendFileSync(process.env.AGENT_LOOP_MEASURE, `${JSON.stringify({ id, loop: t.loopOn?.() === true, turns, calls, loopCalls, tokens })}\n`);
}

/** After every turn: the history the next turn is given holds the previous reply exactly as the model wrote it. */
function historyIsTheModelsOwn(views: readonly LoopView[], replies: readonly ReplayAnswer[]) {
  for (const [index, reply] of replies.slice(0, -1).entries()) {
    const next = views.find((view) => view.step === 0 && view.turns.filter((turn) => turn.role === "user").length === index + 2);
    if (!next) continue;
    // Changed on purpose (the earlier-card note, `run.ts` CARD_NOTE): a card's reply is given as written, plus the app's note after it.
    const given = next.turns.filter((turn) => turn.role === "assistant").map((turn) => turn.text.replace("\n\n[app note: this reply showed a card built with propose_form]", ""));
    expect(given, `turn ${index + 2} was not given reply ${index + 1} as written`).toContain(reply.content);
  }
}

/* --------------------------------------------- (a) the dress-code chat --- */

const BRIONY: DirectoryRow = { id: "e-briony-calloway", firstName: "Briony", lastName: "Calloway", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0309"], positionName: "Tanning Consultant" };
const A1 = "Please create a CA written warning for Briony Calloway for being out of dresscode on 11/13. Briony Calloway wore her coat during Briony Calloways shift after previosly being asked to take it off multiple times.";
const A2 = "Write me a CA form for Briony Calloway having a black crewneck on during her shift, not a zip up jacket on 11/13 and 11/6";
const A4 = "CA for Briony Calloway  not being in dresscode on 11/13 and 11/6";

/** The stand-in for a CA request: look the person up, check the forms on file, then the card with the heading that fits what was said. */
function caStandIn(view: LoopView): LoopDecision {
  const said = latest(view);
  const name = /Briony Calloway/i.test(said) ? "Briony Calloway" : null;
  if (!name) return { text: "Who is this form for?" };
  if (!lastResult(view, "find_staff")) return { tool: "find_staff", input: { name } };
  if (!lastResult(view, "find_past_forms")) return { tool: "find_past_forms", input: { employee_name: name } };
  if (!lastResult(view, "propose_form")) {
    const person = firstMatch(view);
    const policy = /dress ?code|coat|crewneck|jacket/i.test(said) ? headingWith(view, /dress/i) : headingWith(view, /late open/i);
    const date = /11\/13/.test(said) ? "2026-11-13" : "2026-10-26";
    return {
      tool: "propose_form",
      input: { template_key: "dpoa", employee_id: person?.employee_id, policy, what_happened: said, incident_date: date, warning_level: /written/i.test(said) ? "written" : "verbal" },
    };
  }
  const policy = String((lastResult(view, "propose_form")?.card as { policy?: string } | undefined)?.policy ?? "");
  return { text: `Here is the Corrective Action Form for Briony Calloway to review.\n\n**Policy:** ${policy}` };
}

/** The manual's dress-code section, which the fixture leaves out: its heading and page as the manual prints them, the wording invented. */
const DRESS_CODE_CHUNK = {
  chunkIndex: 60,
  chunkId: "jba-60",
  locator: "Page 16 — Dress Code for The Company",
  page: 17,
  content: "Dress Code for The Company\nEmployees wear the company uniform top during every shift. Coats and outside jackets are not worn on the floor.",
  section: "Dress Code for The Company",
  printedPage: 16,
  sections: [{ page: 16, heading: "Dress Code for The Company" }],
};

async function dressCodeChat(t: ReplayContext): Promise<{ replies: ReplayAnswer[]; views: LoopView[] }> {
  vi.setSystemTime(new Date("2026-11-13T22:40:00Z"));
  t.directory([...STAFF, BRIONY]);
  t.as("salon_director", KEARNEY);
  t.manualAlsoHas?.([DRESS_CODE_CHUNK]);
  const standIn = loopStandIn(caStandIn);
  if (t.loopOn?.()) t.loopModel!(standIn);
  // A finalized Late Opening CA on file for her, as in production.
  const first = t.thread();
  await first.say("create a verbal ca for Briony Calloway for late opening on 10/26/26, she opened the salon 20 minutes late");
  t.draftWrites({ observation: "Observed:\nBriony Calloway opened the salon 20 minutes late on 10/26/26." }, { warning_type: ["verbal"], offense_type: ["tardiness"] });
  const id = await first.create();
  Object.assign(t.forms().find((row) => row.id === id)!, { status: "finalized", form_date: "2026-10-26" });

  const thread = t.thread();
  const replies: ReplayAnswer[] = [];
  for (const turn of [A1, A2, A2, A4]) replies.push(await thread.say(turn));
  return { replies, views: standIn.views };
}

/* ------------------------------------ (b) what happened is in turn one --- */

const MARNIE_QUILL: DirectoryRow = { id: "e-marnie-quill", firstName: "Marnie", lastName: "Quill", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0309"], positionName: "Tanning Consultant" };
const B_TURNS = [
  "I want to create a correct of action form for one of my employees. She left out an open container of laundry with nothing covering the top and no label.",
  "her name is Marnie Quill. We had all employees sign a coaching form that stated nothing shall be left out without proper communication.",
  "i want it as a corrective action",
  "verbal warning.",
];
const NOT_TOLD = /(?:haven'?t|have not|didn'?t|did not) (?:yet )?(?:told|tell|said|say|described|mentioned)[^.?\n]*(?:what happened|incident)|what happened\?/i;

function laundryStandIn(view: LoopView): LoopDecision {
  const all = managerTurns(view).join("\n");
  const named = /Marnie Quill/i.test(all);
  if (!named) return { text: "Who is the employee?" };
  if (!lastResult(view, "find_staff")) return { tool: "find_staff", input: { name: "Marnie Quill" } };
  if (!/corrective action/i.test(all)) return { text: "Should this be a coaching form or a corrective action?" };
  if (!/\b(?:verbal|written)\b/i.test(all)) return { text: "Is this a verbal or a written warning?" };
  if (!lastResult(view, "propose_form")) {
    return {
      tool: "propose_form",
      input: { template_key: "dpoa", employee_id: firstMatch(view)?.employee_id, what_happened: managerTurns(view)[0], incident_date: "2026-11-14", warning_level: "verbal" },
    };
  }
  return { text: "Here is a verbal Corrective Action Form for Marnie Quill about the open, unlabeled laundry container." };
}

/* ------------------------------------------------ (c) sf-s29 and s29 --- */

const JOVELLE: DirectoryRow = { id: "e-jovelle", firstName: "Jovelle", lastName: "Kerrigan", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0309"], positionName: "Tanning Consultant" };
const SF_S29 = "are there any coaching and ca's for Jovelle Kerrigan";

function pastFormsStandIn(view: LoopView): LoopDecision {
  if (!lastResult(view, "find_past_forms")) return { tool: "find_past_forms", input: { employee_name: "Jovelle Kerrigan" } };
  const forms = (lastResult(view, "find_past_forms")?.forms ?? []) as unknown[];
  return { text: forms.length === 0 ? "There are no coaching or corrective action forms on file for Jovelle Kerrigan." : `Jovelle Kerrigan has ${forms.length} form(s) on file.` };
}

/* ------------------------------------------ (d) two people, one name --- */

const SECOND_MARNIE: DirectoryRow = { id: "e-90", firstName: "Marnie", lastName: "Holloway", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0309"], positionName: "Assistant Salon Director" };
const D1 = "verbal CA for marnie holloway, she was late on 11/1/26";

function sameNameStandIn(view: LoopView): LoopDecision {
  if (!lastResult(view, "find_staff")) return { tool: "find_staff", input: { name: "marnie holloway" } };
  const matches = (lastResult(view, "find_staff")?.matches ?? []) as { name: string }[];
  if (matches.length > 1) return { text: `I found ${matches.length} people named ${matches[0]!.name}. Which one did you mean?` };
  return { tool: "propose_form", input: { template_key: "dpoa", employee_id: firstMatch(view)?.employee_id, warning_level: "verbal" } };
}

/* ----------------------------------- (e) a salon's name is not a person --- */

const E_TURNS = ["i need to issue a ca for someone being late", "rowan kestrel was late on 10/20 and the salon was opened late", "she was issued a verbal ca on 10.1 for this same thing", "yes payrol ldeduct", "i dont know the amount", "kearney"];

function salonWordStandIn(view: LoopView): LoopDecision {
  const said = latest(view).trim();
  const all = managerTurns(view).join("\n");
  if (/^kearney$/i.test(said) && !lastResult(view, "find_staff")) return { tool: "find_staff", input: { name: "kearney" } };
  if (!/rowan kestrel/i.test(all)) return { text: "Who is this form for?" };
  if (!lastResult(view, "find_staff")) return { tool: "find_staff", input: { name: "rowan kestrel" } };
  const rowan = (lastResult(view, "find_staff")?.matches ?? []) as { employee_id: string; name: string }[];
  if (rowan.length === 0) return { tool: "find_staff", input: { name: "rowan kestrel" } };
  if (!lastResult(view, "propose_form")) return { tool: "propose_form", input: { template_key: "dpoa", employee_id: rowan[0]!.employee_id, policy: headingWith(view, /late open/i), incident_date: "2026-10-20", warning_level: "verbal" } };
  return { text: "Here is the Corrective Action Form for Rowan Kestrel." };
}

const FLAG = "AGENT_LOOP_ENABLED";
const REPORT = "QA, 14 Nov 2026: the HR chat's tool loop (AGENT_LOOP_ENABLED), on the reported chats";

export const NOV14_AGENT_LOOP_CASES: ReplayCase[] = [
  {
    id: "nov14-agent-loop-dress-code-every-time",
    title: "(a) Pau's dress-code chat, the 3rd turn word for word the 2nd, a Late Opening CA on file: every card cites Dress Code, never Late Opening",
    report: `${REPORT}; Sunny production conversation 2ad14839, from Pau's morning scan (13 Nov 2026)`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      measureFrom(t);
      const { replies, views } = await dressCodeChat(t);
      measure(t, "a-dress-code", replies.length + 1, views.length);
      for (const [index, reply] of replies.entries()) {
        expect(policyLine(reply.content), `turn ${index + 1} cites Late Opening:\n${reply.content}`).not.toMatch(/Late Opening/i);
      }
      if (!t.loopOn?.()) return;
      for (const [index, reply] of replies.entries()) {
        expect(reply.formProposal?.employeeName, `turn ${index + 1}: no card for her`).toBe("Briony Calloway");
        expect(policyLine(reply.content), `turn ${index + 1}: not Dress Code`).toMatch(/Dress Code/i);
      }
      // The resent request is carded exactly as the first time.
      expect(policyLine(replies[2]!.content)).toBe(policyLine(replies[1]!.content));
      // Where the model looked up the forms on file, it saw the Late Opening CA as a record; never an app-written "On file" line.
      const onFile = views.flatMap((view) => view.results.filter((result) => result.tool === "find_past_forms"));
      // Changed on purpose (14 Nov 2026, Pau's privacy rule via QA): forms on file are looked at only when the manager asks; nobody asked here.
      for (const result of onFile) expect(JSON.stringify(result.output)).toMatch(/not asked about forms on file/);
      expect(views.every((view) => !/On file in Form Monitoring/.test(view.system))).toBe(true);
      historyIsTheModelsOwn(views, replies);
    },
  },
  {
    id: "nov14-agent-loop-what-happened-in-turn-one",
    title: '(b) the account is in turn 1 ("left out an open container of laundry…"): never "You haven\'t told me what happened yet", and the verbal CA card for the person named',
    report: `${REPORT}; rebuilt from the sibling app's report, in this app's words, the employee invented`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      measureFrom(t);
      vi.setSystemTime(new Date("2026-11-14T16:00:00Z"));
      t.directory([...STAFF, MARNIE_QUILL]);
      t.as("salon_director", KEARNEY);
      const standIn = loopStandIn(laundryStandIn);
      if (t.loopOn?.()) t.loopModel!(standIn);
      const thread = t.thread();
      const replies: ReplayAnswer[] = [];
      for (const turn of B_TURNS) replies.push(await thread.say(turn));
      measure(t, "b-what-happened", replies.length, standIn.calls);
      if (process.env.AGENT_LOOP_LIVE_DUMP) appendFileSync(process.env.AGENT_LOOP_LIVE_DUMP, `${JSON.stringify({ replies: replies.map((r) => r.content), tools: standIn.views.map((v) => v.results.map((x) => ({ tool: x.tool, out: JSON.stringify(x.output).slice(0, 300) }))) }, null, 1)}\n`);
      for (const [index, reply] of replies.entries()) {
        expect(reply.content, `turn ${index + 1} says the manager has not said what happened:\n${reply.content}`).not.toMatch(NOT_TOLD);
      }
      if (!t.loopOn?.()) return;
      const card = replies.at(-1)!.formProposal;
      expect(card?.templateKey).toBe("dpoa");
      expect(card?.employeeName).toBe("Marnie Quill");
      expect(card?.warningLevel).toBe("verbal");
      expect(card?.issue ?? "").toMatch(/open container of laundry/);
      historyIsTheModelsOwn(standIn.views, replies);
    },
  },
  {
    id: "nov14-agent-loop-sf-s29-forms-on-file",
    title: `(c) sf-s29 "${SF_S29}": answered from the forms on file, no card`,
    report: `${REPORT}; Pau, 5 Nov 2026 (overnight scan sf-s29)`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      measureFrom(t);
      vi.setSystemTime(new Date("2026-11-05T15:30:00Z"));
      t.directory([...STAFF, JOVELLE]);
      t.as("salon_director", KEARNEY);
      const standIn = loopStandIn(pastFormsStandIn);
      if (t.loopOn?.()) t.loopModel!(standIn);
      const thread = t.thread();
      const reply = await thread.say(SF_S29);
      measure(t, "c-sf-s29", 1, standIn.calls);
      expect(thread.proposal, `a form card for a question about forms on file:\n${reply.content}`).toBeNull();
      expect(reply.content).not.toMatch(/I can create it here|is filed under|^Yes\. \*\*/);
      if (!t.loopOn?.()) return;
      expect(standIn.views.flatMap((view) => view.results.map((result) => result.tool))).toContain("find_past_forms");
    },
  },
  {
    id: "nov14-agent-loop-same-name-asks-which",
    title: `(d) "${D1}" with two Marnie Holloways: find_staff returns both, and no card is made for either without asking`,
    report: `${REPORT}; QA, 12 Nov 2026 (SAME_NAME_ASKS_WHICH)`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      measureFrom(t);
      vi.setSystemTime(new Date("2026-11-03T15:00:00Z"));
      t.directory([...STAFF, SECOND_MARNIE]);
      t.as("salon_director", KEARNEY);
      const standIn = loopStandIn(sameNameStandIn);
      if (t.loopOn?.()) t.loopModel!(standIn);
      const thread = t.thread();
      const reply = await thread.say(D1);
      measure(t, "d-same-name", 1, standIn.calls);
      expect(reply.content, `nothing asked which Marnie Holloway:\n${reply.content}`).toMatch(/Which|Did you mean/i);
      if (!t.loopOn?.()) return;
      expect(reply.formProposal, "a card for one of them without asking").toBeUndefined();
      const found = (lastResult(standIn.views.at(-1)!, "find_staff")?.matches ?? []) as { employee_id: string }[];
      expect(found.map((row) => row.employee_id).sort()).toEqual(["e-1", "e-90"]);
    },
  },
  {
    id: "nov14-agent-loop-salon-name-not-a-person",
    title: '(e) a reply that is only the salon\'s name ("kearney") is never the employee: find_staff finds nobody, and the card stays Rowan Kestrel\'s',
    report: `${REPORT}; QA's round-6 flag audit (8 Nov 2026), the sibling's STORE_WORD_NOT_A_NAME chain`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      measureFrom(t);
      vi.setSystemTime(new Date("2026-11-05T15:30:00Z"));
      t.directory([...STAFF]);
      t.as("salon_director", KEARNEY);
      const standIn = loopStandIn(salonWordStandIn);
      if (t.loopOn?.()) t.loopModel!(standIn);
      const thread = t.thread();
      for (const turn of E_TURNS) await thread.say(turn);
      measure(t, "e-salon-word", E_TURNS.length, standIn.calls);
      expect(thread.proposal?.employeeName ?? null, "the salon's name became the employee").toBe("Rowan Kestrel");
      if (!t.loopOn?.()) return;
      const kearney = standIn.views.flatMap((view) => view.results).find((result) => result.tool === "find_staff" && Array.isArray(result.output.matches) && (result.output.matches as unknown[]).length === 0);
      expect(kearney, "find_staff offered somebody for the salon's name").toBeTruthy();
      expect(String(kearney!.output.note)).toMatch(/salon/);
    },
  },
  {
    id: "nov14-agent-loop-roster-outage-is-said",
    title: "find_staff with the roster down says so (an explicit error), never an empty list, and no card is made",
    report: `${REPORT}: loadScopedRoster swallowed failures into []`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      vi.setSystemTime(new Date("2026-11-03T15:00:00Z"));
      t.directory([...STAFF]);
      t.as("salon_director", KEARNEY);
      const standIn = loopStandIn((view) =>
        lastResult(view, "find_staff") ? { text: "I couldn't load the staff roster just now, so I can't look her up. Please try again in a moment." } : { tool: "find_staff", input: { name: "rowan kestrel" } },
      );
      t.loopModel!(standIn);
      t.rosterFails!();
      const reply = await t.thread().say("verbal CA for rowan kestrel, she was late on 11/1/26");
      const result = lastResult(standIn.views.at(-1)!, "find_staff")!;
      expect(result.error, "the roster outage was not said").toMatch(/could not be loaded/);
      expect(result.matches).toBeUndefined();
      expect(reply.formProposal).toBeUndefined();
    },
  },
  {
    id: "nov14-agent-loop-step-limit-says-so",
    title: "a model that never stops asking for tools ends at the step limit (6) with a clear reply, never an empty one",
    report: `${REPORT}: the step limit`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      vi.setSystemTime(new Date("2026-11-03T15:00:00Z"));
      t.directory([...STAFF]);
      t.as("salon_director", KEARNEY);
      const standIn = loopStandIn(() => ({ tool: "find_staff", input: { name: "rowan" } }));
      t.loopModel!(standIn);
      const reply = await t.thread().say("verbal CA for rowan kestrel, she was late on 11/1/26");
      expect(standIn.calls).toBe(6);
      expect(reply.content).toMatch(/steps/);
      expect(reply.content.trim()).not.toBe("");
    },
  },
  {
    id: "nov14-agent-loop-edit-form-drafts-only",
    title: "edit_form changes a draft through the one writer; a finalized form is never written: the change goes on a new draft revising it",
    report: `${REPORT}: finalized forms can never be edited (Pau, 14 Nov 2026: a change to one opens the Edit button's revision draft)`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      vi.setSystemTime(new Date("2026-11-13T22:40:00Z"));
      t.directory([...STAFF, BRIONY]);
      t.as("salon_director", KEARNEY);
      t.manualAlsoHas?.([DRESS_CODE_CHUNK]);
      t.loopModel!(loopStandIn(caStandIn));
      const thread = t.thread();
      await thread.say(A1);
      t.draftWrites({ observation: "Observed:\nBriony Calloway wore her coat during her shift on 11/13." }, { warning_type: ["written"] });
      const id = await thread.create();
      const edited = "Observed:\nBriony Calloway wore her coat during her shift on 11/13 after being asked to take it off.";
      let target = id;
      let wanted = edited;
      const standIn = loopStandIn((view) =>
        lastResult(view, "edit_form") ? { text: JSON.stringify(lastResult(view, "edit_form")) } : { tool: "edit_form", input: { instance_id: target, values: { observation: wanted } } },
      );
      t.loopModel!(standIn);
      const draftReply = await thread.say("add that she was asked to take it off");
      expect(draftReply.formUpdate?.updated).toEqual(["observation"]);
      expect(t.values(id).observation).toBe(edited);

      Object.assign(t.forms().find((row) => row.id === id)!, { status: "finalized" });
      target = id;
      wanted = "Observed:\nBriony Calloway wore her jacket during her shift on 11/13 after being asked to take it off.";
      const before = JSON.stringify(t.values(id));
      const finalReply = await thread.say("change the observation to say it was a jacket");
      // Changed on purpose (14 Nov 2026, Pau via QA): was a refusal; now a new draft revising the finalized form, the original byte-identical.
      expect(JSON.stringify(t.values(id)), "the finalized form was written").toBe(before);
      expect(finalReply.formOpened?.revisesInstanceId, finalReply.content).toBe(id);
      // The harness renumbers a form it opens (fake-N → a UUID), so the revision is found by what it revises.
      const revision = (t.forms() as { id: string; status: string; revises_instance_id?: string | null }[]).find((row) => row.revises_instance_id === id);
      expect(revision?.status, "no draft revising the finalized form").toBe("draft");
      expect(t.values(revision!.id).observation, finalReply.content).toBe(wanted);
      expect(finalReply.formUpdate?.updated).toEqual(["observation"]);
    },
  },
  {
    id: "nov14-agent-loop-listed-users-only",
    title: "AGENT_LOOP_USERS empty or unset, or listing another user: this manager stays on today's path (the loop's model is never asked)",
    report: `${REPORT}: enabled for listed users only`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      vi.setSystemTime(new Date("2026-11-03T15:00:00Z"));
      t.directory([...STAFF]);
      t.as("salon_director", KEARNEY);
      const standIn = loopStandIn(() => ({ text: "from the loop" }));
      t.loopModel!(standIn);
      const saved = process.env.AGENT_LOOP_USERS;
      try {
        // On, with the list empty or unset: nobody (Pau via QA, 14 Nov 2026).
        for (const empty of ["", " , "]) {
          process.env.AGENT_LOOP_USERS = empty;
          await t.thread().say("what is the late opening policy?");
        }
        delete process.env.AGENT_LOOP_USERS;
        await t.thread().say("what is the late opening policy?");
        expect(standIn.calls, "the loop ran with no one listed").toBe(0);
        process.env.AGENT_LOOP_USERS = "pilot.manager@example.test, Another.Pilot@Example.test";
        const off = await t.thread().say("what is the late opening policy?");
        expect(standIn.calls).toBe(0);
        expect(off.content).not.toBe("from the loop");
        // Listed (any case, spaces ignored): the loop answers.
        process.env.AGENT_LOOP_USERS = " QA-Manager@Example.test ,pilot.manager@example.test";
        const on = await t.thread().say("what is the late opening policy?");
        expect(standIn.calls).toBe(1);
        expect(on.content).toBe("from the loop");
      } finally {
        if (saved === undefined) delete process.env.AGENT_LOOP_USERS;
        else process.env.AGENT_LOOP_USERS = saved;
      }
    },
  },
  {
    id: "nov14-agent-loop-trace-steps-no-values",
    title: "every loop step is on the chat trace (tool, ms, result size), with the model and its tokens, and no names or text",
    report: `${REPORT}: log every loop step to the chat trace`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      vi.setSystemTime(new Date("2026-11-13T22:40:00Z"));
      t.directory([...STAFF, BRIONY]);
      t.as("salon_director", KEARNEY);
      t.manualAlsoHas?.([DRESS_CODE_CHUNK]);
      t.loopModel!(loopStandIn(caStandIn));
      await t.thread().say(A1);
      const rows = t.rows?.("chat_traces") ?? [];
      const row = [...rows].reverse().find((entry) => (entry.slots as { agent_loop?: unknown } | undefined)?.agent_loop);
      expect(row, "no chat trace with the loop's steps").toBeTruthy();
      const looped = (row!.slots as { agent_loop: { steps: { tool: string; ms: number; resultChars: number }[]; model_calls: number; stopped: string } }).agent_loop;
      expect(looped.steps.map((step) => step.tool)).toEqual(["find_staff", "find_past_forms", "propose_form"]);
      expect(looped.model_calls).toBe(4);
      // Per model call: its tokens (the stand-in reports 200 in, 60 out, 1,000 cached) and ms.
      const modelSteps = (row!.slots as { agent_loop: { model_steps: { step: number; input_tokens: number; output_tokens: number; cache_read_input_tokens: number; ms: number }[] } }).agent_loop.model_steps;
      expect(modelSteps.map((step) => step.step)).toEqual([1, 2, 3, 4]);
      expect(modelSteps.every((step) => step.input_tokens === 200 && step.output_tokens === 60 && step.cache_read_input_tokens === 1000 && step.ms >= 0)).toBe(true);
      expect(looped.stopped).toBe("reply");
      expect(looped.steps.every((step) => step.resultChars > 0 && step.ms >= 0)).toBe(true);
      expect(JSON.stringify(looped)).not.toMatch(/Briony|Calloway|coat/i);
      // The model and the turn's tokens are on the row, so the monthly budget and the daily cap count it.
      expect(row!.model).toBeTruthy();
      expect(Number(row!.output_tokens)).toBe(4 * 60);
    },
  },
  {
    id: "nov14-agent-loop-stalled-model-times-out",
    title: "a loop step whose model never sends a token ends at the first-token limit with Part 1's message (504), never an empty reply",
    report: `${REPORT}: each call has the Part 1 time limits`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      vi.setSystemTime(new Date("2026-11-03T15:00:00Z"));
      t.directory([...STAFF]);
      t.as("salon_director", KEARNEY);
      t.loopModel!(loopStandIn(() => ({ stall: true })));
      const saved = process.env.AI_MAIN_TIMEOUT_MS;
      process.env.AI_MAIN_TIMEOUT_MS = "5000";
      const started = performance.now();
      try {
        const failure = await t.thread().say("verbal CA for rowan kestrel, she was late on 11/1/26").then(
          () => null,
          (error: unknown) => String((error as Error).message),
        );
        expect(failure, "the stalled loop answered 200").not.toBeNull();
        expect(failure).toMatch(/took too long to answer/);
        expect(failure).toMatch(/504/);
        expect(performance.now() - started).toBeLessThan(15_000);
      } finally {
        if (saved === undefined) delete process.env.AI_MAIN_TIMEOUT_MS;
        else process.env.AI_MAIN_TIMEOUT_MS = saved;
      }
    },
  },
  {
    id: "nov14-agent-loop-same-name-no-create-before-choice",
    title: "QA's bar, loop on: two Marnie Holloways — a card is never offered (let alone Create) until the manager picks one; then that person's card",
    report: `${REPORT}: QA, 14 Nov 2026 (bar on Gate-Sunny's case 4)`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      vi.setSystemTime(new Date("2026-11-03T15:00:00Z"));
      t.directory([...STAFF, SECOND_MARNIE]);
      t.as("salon_director", KEARNEY);
      const standIn = loopStandIn((view) => {
        const said = latest(view);
        if (!lastResult(view, "find_staff")) return { tool: "find_staff", input: { name: "marnie holloway" } };
        const matches = (lastResult(view, "find_staff")?.matches ?? []) as { employee_id: string; salons: string[] }[];
        // A careless model proposes before asking: the card needs an employee_id, so it is refused.
        if (/^verbal CA/.test(said) && !lastResult(view, "propose_form")) return { tool: "propose_form", input: { template_key: "dpoa", warning_level: "verbal" } };
        if (/^verbal CA/.test(said)) return { text: `Which Marnie Holloway did you mean? I found ${matches.length}.` };
        if (!lastResult(view, "propose_form")) return { tool: "propose_form", input: { template_key: "dpoa", employee_id: "e-90", warning_level: "verbal", incident_date: "2026-11-01", what_happened: "she was late on 11/1/26" } };
        return { text: "Here is the Corrective Action Form for Marnie Holloway." };
      });
      t.loopModel!(standIn);
      const thread = t.thread();
      const asked = await thread.say(D1);
      expect(t.loopActive?.()).toBe(true);
      expect(asked.formProposal, "a card before the person was chosen").toBeUndefined();
      const refused = standIn.views.flatMap((view) => view.results).find((result) => result.tool === "propose_form");
      expect(String(refused?.output.error ?? ""), "propose_form took no employee").toMatch(/employee_id/);
      const chosen = await thread.say("the assistant salon director one");
      expect(chosen.formProposal?.employeeName).toBe("Marnie Holloway");
      expect((chosen.formProposal as { supportsInlineDraft?: boolean } | undefined)?.supportsInlineDraft).toBe(true);
    },
  },
  {
    id: "nov14-agent-loop-off-roster-no-card-without-employee",
    title: "QA's bar, loop on: an admin's off-roster name and then a salon (\"KS Manhattan\"): the admin's card has the typed name at once with the not-on-Woven line (production's TYPED_NAME_PROCEEDS), and a salon is never the employee, so never a Create with no employee",
    report: `${REPORT}: QA, 14 Nov 2026 (bar on Gate-Sunny's case 5)`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      vi.setSystemTime(new Date("2026-11-12T15:00:00Z"));
      t.directory([...STAFF]);
      t.as("admin", { level: "global", primaryAreaId: null, alsoCoversAreaIds: [] });
      const standIn = loopStandIn((view) => {
        const said = latest(view);
        const name = /brisa talmadge/i.test(said) ? "Brisa Talmadge" : said.trim();
        if (!lastResult(view, "find_staff")) return { tool: "find_staff", input: { name } };
        // A careless model tries the typed name anyway: the roster can be read, so it is refused.
        if (!lastResult(view, "propose_form")) return { tool: "propose_form", input: { template_key: "dpoa", employee_name: name } };
        return { text: `I couldn't find ${name} on the roster. Who is this form for?` };
      });
      t.loopModel!(standIn);
      const thread = t.thread();
      // Changed on purpose (QA ruling 14 Nov 14:40Z): follows production's TYPED_NAME_PROCEEDS for district/region/all-salon logins.
      const first = await thread.say("CA for Brisa Talmadge, do not terminate yet, she was late");
      expect(first.formProposal?.employeeName, `no card for the typed name:\n${first.content}`).toBe("Brisa Talmadge");
      expect(first.content).toContain("**Brisa Talmadge** isn't on the Woven staff list, so I've used the name as you typed it. Check the spelling before you press Create.");
      const before = standIn.views.flatMap((view) => view.results).length;
      const salon = await thread.say("KS Manhattan");
      expect(salon.formProposal?.employeeName ?? null, "a salon became the employee").not.toBe("KS Manhattan");
      const later = standIn.views.flatMap((view) => view.results).slice(before);
      expect(later.filter((result) => result.tool === "find_staff").every((result) => (result.output.matches as unknown[]).length === 0)).toBe(true);
      expect(later.filter((result) => result.tool === "propose_form").every((result) => /employee_id|ask who/i.test(String(result.output.error)))).toBe(true);
    },
  },
  {
    id: "nov14-agent-loop-account-name-never-the-employee",
    title: "QA's L4 bar (live baseline, 14 Nov 2026): a CA for a Salon Director whose account names a new hire — the form stays the Salon Director's every turn, the Observation keeps both names, the policy stays Standards of Conduct (never the new hire's Late Opening on file)",
    report: `${REPORT}: QA via Pau, a production 1★ chat (L4) in invented names; today's app switched the CA to the new hire named in the account and carried her Late Opening`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      vi.setSystemTime(new Date("2026-11-14T16:00:00Z"));
      const director: DirectoryRow = { id: "e-linnea-brightwater", firstName: "Linnea", lastName: "Brightwater", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0309"], positionName: "Salon Director" };
      const hire: DirectoryRow = { id: "e-saoirse-pennick", firstName: "Saoirse", lastName: "Pennick", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0309"], positionName: "Tanning Consultant" };
      t.directory([...STAFF, director, hire]);
      t.as("admin", { level: "global", primaryAreaId: null, alsoCoversAreaIds: [] });
      // The new hire has a finalized Late Opening CA on file, as in production.
      const prior = t.thread();
      await prior.say("create a verbal ca for Saoirse Pennick for late opening on 10/26/26, she opened the salon 20 minutes late");
      t.draftWrites({ observation: "Observed:\nSaoirse Pennick opened the salon 20 minutes late on 10/26/26." }, { warning_type: ["verbal"] });
      const priorId = await prior.create();
      Object.assign(t.forms().find((row) => row.id === priorId)!, { status: "finalized", form_date: "2026-10-26" });

      const ACCOUNT = "Linnea completed onboarding with new hire Saoirse Pennick on 9-28-26. As of 10-16-26 Saoirse had not acknowledged onboarding policies in Woven that should have been completed during onboarding.";
      const TURNS = [
        "create a CA for salon director, linnea brightwater for violating the standards of conduct",
        "Linnea Brightwater, Salon Director",
        `change observation of offense to: ${ACCOUNT}`,
        "create the ca",
        `create ca for linnea brightwater, salon director. the offense is: change observation of offense to: ${ACCOUNT} the policy violated is standards of conduct.`,
        `create ca for linnea brightwater, salon director. the offense is: change observation of offense to: ${ACCOUNT} the policy violated is standards of conduct.`,
        "linnea",
      ];
      /* The stand-in is a careful model (live, AGENT_LOOP_LIVE=1, the real one decides): the form's person is the one the request is about. */
      const standIn = loopStandIn((view) => {
        const said = latest(view);
        const all = managerTurns(view).join("\n");
        if (!lastResult(view, "find_staff")) return { tool: "find_staff", input: { name: "linnea brightwater" } };
        if (!/onboarding/i.test(all)) return { text: "What did Linnea do? I'll put it on the form in your words." };
        if (!lastResult(view, "propose_form")) {
          const account = /change observation of offense to:\s*([\s\S]*?)(?:\s*the policy violated|$)/i.exec(all)?.[1]?.trim() ?? said;
          return { tool: "propose_form", input: { template_key: "dpoa", employee_id: firstMatch(view)?.employee_id, policy: "Standards of Conduct", what_happened: account, incident_date: "2026-10-16" } };
        }
        return { text: "The Corrective Action Form for Linnea Brightwater is ready to review." };
      });
      t.loopModel!(standIn);
      const thread = t.thread();
      const replies: ReplayAnswer[] = [];
      for (const turn of TURNS) replies.push(await thread.say(turn));
      for (const [index, reply] of replies.entries()) {
        const card = reply.formProposal;
        // A person named inside the account never replaces the form's employee.
        if (card) expect(card.employeeName, `turn ${index + 1}: the card moved to someone else:\n${reply.content}`).toBe("Linnea Brightwater");
        expect(policyLine(reply.content), `turn ${index + 1}: the new hire's Late Opening:\n${reply.content}`).not.toMatch(/late opening/i);
        if (card) expect(policyLine(reply.content), `turn ${index + 1}: not Standards of Conduct:\n${reply.content}`).toMatch(/standards of conduct/i);
      }
      const last = replies.at(-1)!.formProposal;
      expect(last?.employeeName, "no card for the Salon Director at the end").toBe("Linnea Brightwater");
      // The Observation edit keeps every name as written.
      expect(last?.issue ?? "", "the account lost a name").toMatch(/Linnea[\s\S]*Saoirse Pennick/);
      // The finalized CA on file is untouched.
      expect(t.forms().find((row) => row.id === priorId)?.status).toBe("finalized");
    },
  },
];
