import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";
import { evidenceFrom, lastResult, loopStandIn, type LoopDecision, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * KEEP-AS-TYPED, LIVE SHAPE ON MAIN (QA's launch blocker, 16 Nov 2026; production 269ac0d9)
 * ============================================================================
 *
 * "coaching for <B>x on greeting guests" asked Did you mean <B>; "no" and "use <B>x" were then asked again on every turn
 * (0 cards in 4 turns), where #1064's d2710ad held 6/6 and 12/12. The live model looks the typed name up again with
 * person_evidence, and proposes by name. Invented names: Remy Calder (roster), "Remi Calder" (nobody).
 */

const FLAG = "AGENT_LOOP_ENABLED";
const NEAR_MISS = "NEAR_MISS_NEVER_SEATED_ENABLED";
const REPORT = "QA's launch blocker (16 Nov 2026, production 269ac0d9): \"no\" / \"use <B>x\" after Did you mean <B> was asked again every turn, 0 cards";

function start(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-11-15T22:40:00Z"));
  t.directory([...STAFF]);
  t.as("salon_director", KEARNEY);
}
const userTurns = (view: LoopView) => view.turns.filter((turn) => turn.role === "user");
type Out = { note?: string; ask_exactly?: string; reason_code?: string; matches?: { employee_id: string }[]; kept_as_typed?: string; card?: unknown } | null;

/** The live model: every turn it looks the typed name up (quoting the first message), then proposes the coaching card by name. */
function liveModel() {
  return loopStandIn((view): LoopDecision => {
    const staff = lastResult(view, "find_staff") as Out;
    const card = lastResult(view, "propose_form") as Out;
    if (!staff) return { tool: "find_staff", input: { name: "Remi Calder", person_evidence: evidenceFrom(view, "Remi Calder", userTurns(view).length - 1) } };
    if (staff.ask_exactly || /Ask the manager, in these words/.test(staff.note ?? "")) return { text: staff.ask_exactly ?? /Ask the manager, in these words: ([\s\S]+)$/.exec(staff.note ?? "")?.[1] ?? "" };
    if (!card) return { tool: "propose_form", input: { template_key: "coaching", employee_name: "Remi Calder", what_happened: "Not greeting guests at the front desk.", incident_date: "2026-11-14", person_evidence: evidenceFrom(view, "Remi Calder", userTurns(view).length - 1) } };
    return { text: card.ask_exactly ?? card.reason_code ?? "Here's the Coaching Form for **Remi**." };
  });
}

export const NOV16_AGENT_LOOP_KEEP_AS_TYPED_LIVE_CASES: ReplayCase[] = (["no", "use Remi Calder"] as const).map((answer): ReplayCase => ({
  id: `nov16-keep-as-typed-live-shape-${answer === "no" ? "no" : "use-typed"}-coaching`,
  title: `Keep-as-typed, live shape on main: "coaching for Remi Calder on greeting guests" asks Did you mean **Remy Calder**; "${answer}" (the model looks "Remi Calder" up again with person_evidence, then proposes by name) makes the coaching card for "Remi Calder", and a later edit keeps it, never the Did-you-mean again`,
  report: REPORT,
  status: "fixed",
  fixFlags: [FLAG, NEAR_MISS],
  async run(t) {
    if (!t.loopOn?.()) return;
    start(t);
    t.loopModel!(liveModel());
    const thread = t.thread();
    const ask = await thread.say("coaching for Remi Calder on greeting guests");
    expect(ask.content, "T1 did not ask the Did-you-mean").toMatch(/Did you mean \*\*Remy Calder\*\*/);
    t.loopModel!(liveModel());
    const reply = await thread.say(answer);
    expect(reply.content, `"${answer}" was asked again:\n${reply.content}`).not.toMatch(/Did you mean/);
    expect(thread.proposal?.employeeName, `"${answer}" made no card for the typed name:\n${reply.content}`).toBe("Remi Calder");
    t.loopModel!(liveModel());
    const later = await thread.say("also add that it was on Friday");
    expect(later.content, `the settled name was asked again:\n${later.content}`).not.toMatch(/Did you mean/);
  },
}));

/*
 * QA's production traces (16 Nov 2026): every turn's record was written, yet "no" / "use <B>x" was asked again on every
 * turn: the records were never found, because the history the next turn carried did not have the trace's message ids.
 * These cases send the history with ids renumbered, as production did, and propose_form goes by name through its
 * lookup (looked_up_by), as the live model did.
 */
const renumbered = (thread: { conversation?: readonly { id: string; role: string; content: string }[] }) =>
  (thread.conversation ?? []).map((message) => ({ id: `prod-${message.id}`, role: message.role, content: message.content }));

function lookupModel() {
  return loopStandIn((view): LoopDecision => {
    const card = lastResult(view, "propose_form") as Out;
    if (!card) return { tool: "propose_form", input: { template_key: "coaching", employee_name: "Remi Calder", what_happened: "Not greeting guests at the front desk.", incident_date: "2026-11-14", person_evidence: evidenceFrom(view, "Remi Calder", userTurns(view).length - 1) } };
    if (card.ask_exactly && !card.card) return { text: card.ask_exactly };
    return { text: card.ask_exactly ?? (card.reason_code && !card.card ? card.reason_code : "Here's the Coaching Form for **Remi**.") };
  });
}

for (const answer of ["no", "use Remi Calder"] as const) {
  NOV16_AGENT_LOOP_KEEP_AS_TYPED_LIVE_CASES.push({
    id: `nov16-keep-as-typed-production-ids-${answer === "no" ? "no" : "use-typed"}`,
    title: `Keep-as-typed on production (QA's traces): the history's message ids differ from the trace's; "coaching for Remi Calder on greeting guests" asks, "${answer}" makes the card for "Remi Calder" through propose_form's lookup, and a later edit is never asked again`,
    report: `${REPORT}; QA's production traces: each turn's name_question written, never found again`,
    status: "fixed",
    fixFlags: [FLAG, NEAR_MISS],
    async run(t) {
      if (!t.loopOn?.()) return;
      start(t);
      t.loopModel!(lookupModel());
      const thread = t.thread();
      const ask = await thread.say("coaching for Remi Calder on greeting guests");
      expect(ask.content, "T1 did not ask the Did-you-mean").toMatch(/Did you mean \*\*Remy Calder\*\*/);
      t.loopModel!(lookupModel());
      const reply = await thread.say(answer, {}, { history: renumbered(thread) });
      expect(reply.content, `"${answer}" was asked again:\n${reply.content}`).not.toMatch(/Did you mean/);
      expect(thread.proposal?.employeeName, `"${answer}" made no card for the typed name:\n${reply.content}`).toBe("Remi Calder");
      t.loopModel!(lookupModel());
      const later = await thread.say("also add that it was on Friday", {}, { history: renumbered(thread) });
      expect(later.content, `the settled name was asked again:\n${later.content}`).not.toMatch(/Did you mean/);
    },
  });
}

/*
 * QA's production chat_traces (16 Nov 2026): the FIRST message of a new chat was traced with conversation_id NULL (the
 * inline ask sent none), while the ids matched. The records were read by conversation only, so turn 1's records were
 * never fetched. These cases send T1 without a conversationId and later turns with it, as production did.
 */
const firstWithoutConversation = { conversationId: null };
for (const answer of ["no", "use Remi Calder"] as const) {
  NOV16_AGENT_LOOP_KEEP_AS_TYPED_LIVE_CASES.push({
    id: `nov16-keep-as-typed-first-turn-without-conversation-${answer === "no" ? "no" : "use-typed"}`,
    title: `Production shape: T1 "coaching for Remi Calder on greeting guests" sent with no conversationId (its trace's conversation_id is null), "${answer}" with it: the answer to T1's Did-you-mean is found and makes the card for "Remi Calder"; a later edit is never asked again`,
    report: `${REPORT}; QA's production chat_traces: T1's conversation_id NULL, T2's conv_…`,
    status: "fixed",
    fixFlags: [FLAG, NEAR_MISS],
    async run(t) {
      if (!t.loopOn?.()) return;
      start(t);
      t.loopModel!(lookupModel());
      const thread = t.thread();
      const ask = await thread.say("coaching for Remi Calder on greeting guests", {}, firstWithoutConversation);
      expect(ask.content).toMatch(/Did you mean \*\*Remy Calder\*\*/);
      t.loopModel!(lookupModel());
      const reply = await thread.say(answer);
      expect(reply.content, `"${answer}" was asked again:\n${reply.content}`).not.toMatch(/Did you mean/);
      expect(thread.proposal?.employeeName).toBe("Remi Calder");
      t.loopModel!(lookupModel());
      const later = await thread.say("also add that it was on Friday");
      expect(later.content, `the settled name was asked again:\n${later.content}`).not.toMatch(/Did you mean/);
    },
  });
}

NOV16_AGENT_LOOP_KEEP_AS_TYPED_LIVE_CASES.push(
  {
    id: "nov16-first-turn-without-conversation-who-is-it-for",
    title: "Production shape: T1 \"I need a written CA for being late on 11/14\" (no conversationId) asks who it is for (person_asked recorded); T2 \"Remy Calder\" answers it and makes the written CA card",
    report: `${REPORT}; QA: the which-person question asked on turn 1 of a new chat`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      start(t);
      const model = () => loopStandIn((view): LoopDecision => {
        const said = userTurns(view).at(-1)?.text ?? "";
        const card = lastResult(view, "propose_form") as Out;
        const staff = lastResult(view, "find_staff") as Out;
        if (/^I need/.test(said)) return card ? { text: card.ask_exactly ?? "Who is this Corrective Action Form for?" } : { tool: "propose_form", input: { template_key: "dpoa", what_happened: "Late on 11/14.", incident_date: "2026-11-14", warning_level: "written", level_evidence: evidenceFrom(view, "written CA") } };
        if (!staff) return { tool: "find_staff", input: { name: "Remy Calder", person_evidence: evidenceFrom(view, "Remy Calder") } };
        if (!card) return { tool: "propose_form", input: { template_key: "dpoa", employee_id: staff.matches?.[0]?.employee_id, what_happened: "Late on 11/14.", incident_date: "2026-11-14", warning_level: "written", level_evidence: evidenceFrom(view, "written CA", 1), request_evidence: [evidenceFrom(view, "late on 11/14", 1)] } };
        return { text: card.ask_exactly ?? "Here's the Corrective Action Form for **Remy**." };
      });
      t.loopModel!(model());
      const thread = t.thread();
      const who = await thread.say("I need a written CA for being late on 11/14", {}, firstWithoutConversation);
      expect(who.content).toMatch(/who is this/i);
      t.loopModel!(model());
      const answered = await thread.say("Remy Calder");
      expect(thread.proposal?.employeeName, `the answer to turn 1's question made no card:\n${answered.content}`).toBe("Remy Calder");
      expect((thread.proposal as { warningLevel?: string | null } | null)?.warningLevel ?? null, "the level stated on turn 1 was lost").toBe("written");
    },
  },
);

