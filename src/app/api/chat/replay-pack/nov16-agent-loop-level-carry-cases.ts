import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext, type ReplayThread } from "./cases";
import { evidenceFrom, lastResult, loopStandIn, type LoopDecision, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * A WARNING LEVEL STATED FOR THIS REQUEST STAYS ON THE CARD (QA, 16 Nov 2026; Pau's "every answer is used")
 * ============================================================================
 *
 * The general rule: a warning level the manager stated for THIS request stays on the card for the whole request.
 * Found by QA's 266-chat re-run:
 * - c158: "I need to create a verbal corrective action form" (no person yet), then the name, then the account: the card
 *   came with no level ("Warning level isn't set") and stayed unset (the level evidence had to be this message).
 * - c208: a card with verbal, then "redo the outline": the card was rebuilt with no level and stayed unset.
 * By records and evidence, never by reading the words: (1) the card record keeps the level the card held, and a rebuild of
 * the same card keeps it; (2) level_evidence may cite an earlier turn of THIS request (this person's request turns, from
 * the turn the app answered with this form's card or its "who is it for?"). Guards: an earlier remark, another person's
 * card and a new request's boundary never give a level. Invented names (Remy Calder, Juno Paxton).
 */

const FLAG = "AGENT_LOOP_ENABLED";
const REPORT = "QA's 266-chat re-run (16 Nov 2026), c158 and c208: a stated warning level was lost from the card";
const offline = process.env.AGENT_LOOP_LIVE !== "1";

function start(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-11-14T22:40:00Z"));
  t.directory([...STAFF]);
  t.as("salon_director", KEARNEY);
}

const said = (view: LoopView) => view.turns.filter((turn) => turn.role === "user").at(-1)?.text ?? "";
const levelOf = (thread: ReplayThread) => (thread.proposal as { warningLevel?: string } | null)?.warningLevel ?? null;
const proposeOutputs = (views: readonly LoopView[]) => views.flatMap((view) => view.results.filter((result) => result.tool === "propose_form")).map((result) => result.output);

/** c158's first turns: the form and its level with no person (the app asks who), then the name. */
async function c158Card(t: ReplayContext, third?: (view: LoopView) => LoopDecision) {
  start(t);
  const evidence = { cited: "" };
  const standIn = loopStandIn((view): LoopDecision => {
    const text = said(view);
    if (/^i need to create/i.test(text)) return lastResult(view, "propose_form") ? { text: String((lastResult(view, "propose_form") as { ask_exactly?: string }).ask_exactly ?? "Who is it for?") } : { tool: "propose_form", input: { template_key: "dpoa" } };
    if (/^remy calder$/i.test(text)) {
      if (!lastResult(view, "find_staff")) return { tool: "find_staff", input: { name: "remy calder" } };
      if (!lastResult(view, "propose_form")) {
        const level = evidenceFrom(view, "verbal corrective action form", 1);
        evidence.cited = level.message_id;
        return { tool: "propose_form", input: { template_key: "dpoa", employee_id: "e-2", warning_level: "verbal", level_evidence: level } };
      }
      return { text: "Here's the Corrective Action Form for **Remy Calder**. What happened?" };
    }
    return third ? third(view) : { text: "Okay." };
  });
  t.loopModel!(standIn);
  const thread = t.thread();
  await thread.say("I need to create a verbal corrective action form");
  await thread.say("remy calder");
  return { thread, standIn, evidence };
}

export const NOV16_LEVEL_CARRY_CASES: ReplayCase[] = [
  {
    id: "nov16-level-carry-c158-level-from-the-request-turn",
    title: "c158 shape: \"I need to create a verbal corrective action form\", the app asks who, \"remy calder\": the card has Verbal (level_evidence cites the request's first turn, which the app answered with \"who is it for?\")",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.() || !offline) return;
      const { thread, standIn, evidence } = await c158Card(t);
      const out = proposeOutputs(standIn.views).at(-1)!;
      expect(out.reason_code ?? null, JSON.stringify(out)).toBeNull();
      expect(levelOf(thread), "the level stated with the request was lost").toBe("verbal");
      // QA: the bound INCLUDES the manager turn the "who is it for?" answered. The person_asked record is on T1, and T1 is
      // the very turn the level evidence quotes ("I need to create a verbal corrective action form").
      const askedOn = (t.rows?.("chat_traces") ?? []).filter((row) => (row.slots as { agent_loop?: { person_asked?: unknown } } | undefined)?.agent_loop?.person_asked).map((row) => row.message_id);
      expect(askedOn, "no person_asked record for T1").toHaveLength(1);
      expect(evidence.cited, "the level evidence does not cite the turn the who-question answered").toBe(askedOn[0]);
    },
  },
  {
    id: "nov16-level-carry-c158-level-stays-when-the-account-comes",
    title: "c158 shape, T3: the account (\"she was late to her shift on 11/14\") rebuilds Remy's card with no warning_level from the model: the card keeps Verbal",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.() || !offline) return;
      const { thread } = await c158Card(t, (view) =>
        lastResult(view, "propose_form") ? { text: "Updated the card." } : { tool: "propose_form", input: { template_key: "dpoa", employee_id: "e-2", what_happened: "She was late to her shift on 11/14.", incident_date: "2026-11-14" } },
      );
      await thread.say("she was late to her shift on 11/14");
      expect(thread.proposal?.employeeName).toBe("Remy Calder");
      expect(levelOf(thread), "the rebuilt card lost the level stated for this request").toBe("verbal");
    },
  },
  {
    id: "nov16-level-carry-c208-rebuild-keeps-the-level",
    title: "c208 shape: a card with Verbal, then \"redo the outline\" and \"make it shorter\" rebuild the same card with no warning_level from the model: it keeps Verbal each time; \"make it a written\" (evidence) changes it; a level claimed with no evidence does not",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.() || !offline) return;
      start(t);
      const standIn = loopStandIn((view): LoopDecision => {
        const text = said(view);
        if (/^create a ca/i.test(text)) {
          if (!lastResult(view, "find_staff")) return { tool: "find_staff", input: { name: "remy calder" } };
          if (!lastResult(view, "propose_form")) return { tool: "propose_form", input: { template_key: "dpoa", employee_id: "e-2", what_happened: "She was late to her shift on 11/14.", incident_date: "2026-11-14", warning_level: "verbal", level_evidence: evidenceFrom(view, "verbal") } };
          return { text: "Here's the card." };
        }
        if (/^make it a written/i.test(text)) return lastResult(view, "propose_form") ? { text: "Made it a written." } : { tool: "propose_form", input: { template_key: "dpoa", employee_id: "e-2", what_happened: "Late to her shift on 11/14.", incident_date: "2026-11-14", warning_level: "written", level_evidence: evidenceFrom(view, "make it a written") } };
        if (/^tidy/i.test(text)) return lastResult(view, "propose_form") ? { text: "Tidied." } : { tool: "propose_form", input: { template_key: "dpoa", employee_id: "e-2", what_happened: "Late to her shift on 11/14.", incident_date: "2026-11-14", warning_level: "verbal" } };
        return lastResult(view, "propose_form") ? { text: "Rebuilt the card." } : { tool: "propose_form", input: { template_key: "dpoa", employee_id: "e-2", what_happened: "Late to her shift on 11/14.", incident_date: "2026-11-14" } };
      });
      t.loopModel!(standIn);
      const thread = t.thread();
      await thread.say("create a ca for remy calder - verbal, she was late to her shift on 11/14");
      expect(levelOf(thread)).toBe("verbal");
      await thread.say("redo the outline");
      expect(levelOf(thread), "the rebuilt card lost the stated level").toBe("verbal");
      await thread.say("make it shorter");
      expect(levelOf(thread), "the second rebuild lost the stated level").toBe("verbal");
      // A level the manager states now replaces the carried one; a level the model claims with no evidence never does.
      await thread.say("make it a written");
      expect(levelOf(thread), "a stated change of level was not taken").toBe("written");
      await thread.say("tidy the wording");
      expect(levelOf(thread), "a level with no evidence replaced the carried one").toBe("written");
      expect(proposeOutputs(standIn.views).at(-1)!.not_on_card, "the unsupported level was not reported").toContainEqual({ field: "warning_level", reason_code: "level_not_stated" });
    },
  },
  {
    id: "nov16-level-carry-guard-written-up-before-coaching",
    title: "Guard: \"she was written up before, now make a coaching for remy calder\" gives no level (a coaching card has none, whatever the model claims)",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.() || !offline) return;
      start(t);
      t.loopModel!(loopStandIn((view): LoopDecision => {
        if (!lastResult(view, "find_staff")) return { tool: "find_staff", input: { name: "remy calder" } };
        if (!lastResult(view, "propose_form")) return { tool: "propose_form", input: { template_key: "coaching", employee_id: "e-2", what_happened: "Coaching.", warning_level: "written", level_evidence: evidenceFrom(view, "she was written up before") } };
        return { text: "Here's the card." };
      }));
      const thread = t.thread();
      await thread.say("she was written up before, now make a coaching for remy calder");
      expect(thread.proposal?.templateKey).toBe("coaching");
      expect(levelOf(thread), "a remark about an earlier write-up gave a level").toBeNull();
    },
  },
  {
    id: "nov16-level-carry-guard-another-persons-card",
    title: "Guard: Verbal said for Juno Paxton's card never carries to Remy Calder's next card (level_evidence quoting Juno's request is refused; no carry across people)",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.() || !offline) return;
      start(t);
      const standIn = loopStandIn((view): LoopDecision => {
        const text = said(view);
        if (/juno/i.test(text)) {
          if (!lastResult(view, "find_staff")) return { tool: "find_staff", input: { name: "juno paxton" } };
          if (!lastResult(view, "propose_form")) return { tool: "propose_form", input: { template_key: "dpoa", employee_id: "e-3", what_happened: "She was late to her shift on 11/13.", incident_date: "2026-11-13", warning_level: "verbal", level_evidence: evidenceFrom(view, "verbal ca for juno paxton") } };
          return { text: "Here's Juno's card." };
        }
        if (!lastResult(view, "find_staff")) return { tool: "find_staff", input: { name: "remy calder" } };
        if (!lastResult(view, "propose_form")) return { tool: "propose_form", input: { template_key: "dpoa", employee_id: "e-2", what_happened: "She was rude to a guest on 11/14.", incident_date: "2026-11-14", warning_level: "verbal", level_evidence: evidenceFrom(view, "verbal ca for juno paxton", 1) } };
        return { text: "Here's Remy's card." };
      });
      t.loopModel!(standIn);
      const thread = t.thread();
      await thread.say("verbal ca for juno paxton, she was late to her shift on 11/13");
      expect(levelOf(thread)).toBe("verbal");
      await thread.say("now a ca for remy calder, she was rude to a guest on 11/14");
      expect(thread.proposal?.employeeName).toBe("Remy Calder");
      expect(levelOf(thread), "Juno's level went on Remy's card").toBeNull();
      expect(proposeOutputs(standIn.views).at(-1)!.reason_code).toBe("level_not_stated");
    },
  },
  {
    id: "nov16-level-carry-guard-new-request-boundary",
    title: "Guard: after a new request for the same person (new_form_evidence: \"make a new ca for remy calder\"), the earlier card's Verbal neither carries nor counts as level_evidence",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.() || !offline) return;
      start(t);
      const standIn = loopStandIn((view): LoopDecision => {
        const text = said(view);
        if (!/new ca/i.test(text)) {
          if (!lastResult(view, "find_staff")) return { tool: "find_staff", input: { name: "remy calder" } };
          if (!lastResult(view, "propose_form")) return { tool: "propose_form", input: { template_key: "dpoa", employee_id: "e-2", what_happened: "She was late to her shift on 11/13.", incident_date: "2026-11-13", warning_level: "verbal", level_evidence: evidenceFrom(view, "verbal ca for remy calder") } };
          return { text: "Here's the card." };
        }
        if (!lastResult(view, "propose_form")) return { tool: "propose_form", input: { template_key: "dpoa", employee_id: "e-2", what_happened: "She was rude to a guest on 11/14.", incident_date: "2026-11-14", new_form_evidence: evidenceFrom(view, "make a new ca for remy calder"), warning_level: "verbal", level_evidence: evidenceFrom(view, "verbal ca for remy calder", 1) } };
        return { text: "Here's the new card." };
      });
      t.loopModel!(standIn);
      const thread = t.thread();
      await thread.say("verbal ca for remy calder, she was late to her shift on 11/13");
      expect(levelOf(thread)).toBe("verbal");
      await thread.say("make a new ca for remy calder, she was rude to a guest on 11/14");
      expect(levelOf(thread), "the earlier request's level crossed a new request").toBeNull();
      expect(proposeOutputs(standIn.views).at(-1)!.reason_code).toBe("level_not_stated");
    },
  },
  ...([
    ["no-level-from-the-model", false],
    ["level-evidence-from-t2", true],
  ] as const).map(([what, cites]): ReplayCase => ({
    id: `nov16-level-carry-c019-form-switched-back-${what}`,
    title: `c019 shape: Verbal stated at T2 for Remy Calder's Corrective Action; \"Create a Coaching Form from this conversation\", then \"Create a Corrective Action Form from this conversation\" (same person, same incident): the CA card has Verbal again (${cites ? "the model cites T2" : "the model gives no level: the record carries it"})`,
    report: "QA's 266-chat re-run (16 Nov 2026), c019: switching the form away and back lost the stated level",
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.() || !offline) return;
      start(t);
      const standIn = loopStandIn((view): LoopDecision => {
        const text = said(view);
        const ca = { template_key: "dpoa", employee_id: "e-2", what_happened: "She was late to her shift on 11/14.", incident_date: "2026-11-14" };
        if (/^ca for remy/i.test(text)) {
          if (!lastResult(view, "find_staff")) return { tool: "find_staff", input: { name: "remy calder" } };
          return lastResult(view, "propose_form") ? { text: "Here's the card. Warning level isn't set; tell me if it applies." } : { tool: "propose_form", input: ca };
        }
        if (/^verbal$/i.test(text)) return lastResult(view, "propose_form") ? { text: "Verbal it is." } : { tool: "propose_form", input: { ...ca, warning_level: "verbal", level_evidence: evidenceFrom(view, "verbal") } };
        if (/coaching form/i.test(text)) return lastResult(view, "propose_form") ? { text: "Here's the Coaching Form." } : { tool: "propose_form", input: { template_key: "coaching", employee_id: "e-2", what_happened: "She was late to her shift on 11/14." } };
        if (/corrective action form/i.test(text)) return lastResult(view, "propose_form") ? { text: "Here's the Corrective Action Form." } : { tool: "propose_form", input: { ...ca, ...(cites ? { warning_level: "verbal", level_evidence: evidenceFrom(view, "verbal", 3) } : {}) } };
        return { text: "Okay." };
      });
      t.loopModel!(standIn);
      const thread = t.thread();
      await thread.say("ca for remy calder, she was late to her shift on 11/14");
      await thread.say("verbal");
      expect(levelOf(thread)).toBe("verbal");
      await thread.say("actually what would a coaching look like");
      await thread.say("Create a Coaching Form from this conversation");
      expect(thread.proposal?.templateKey).toBe("coaching");
      await thread.say("Create a Corrective Action Form from this conversation");
      expect(thread.proposal?.templateKey).toBe("dpoa");
      expect(levelOf(thread), "switching the form away and back lost the level stated for this request").toBe("verbal");
    },
  })),
  {
    id: "nov16-level-carry-c019-guard-new-incident-starts-fresh",
    title: "c019 guard: Verbal for Remy Calder's CA, a Coaching Form from this conversation, then \"make a new ca for remy calder, she was rude to a guest on 11/15\" (new_form_evidence, a new incident): the new CA card has no level",
    report: "QA's 266-chat re-run (16 Nov 2026), c019: a genuinely new incident still starts fresh",
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.() || !offline) return;
      start(t);
      t.loopModel!(loopStandIn((view): LoopDecision => {
        const text = said(view);
        const late = { template_key: "dpoa", employee_id: "e-2", what_happened: "She was late to her shift on 11/14.", incident_date: "2026-11-14" };
        if (/^ca for remy/i.test(text)) {
          if (!lastResult(view, "find_staff")) return { tool: "find_staff", input: { name: "remy calder" } };
          return lastResult(view, "propose_form") ? { text: "Here's the card." } : { tool: "propose_form", input: late };
        }
        if (/^verbal$/i.test(text)) return lastResult(view, "propose_form") ? { text: "Verbal it is." } : { tool: "propose_form", input: { ...late, warning_level: "verbal", level_evidence: evidenceFrom(view, "verbal") } };
        if (/coaching form/i.test(text)) return lastResult(view, "propose_form") ? { text: "Here's the Coaching Form." } : { tool: "propose_form", input: { template_key: "coaching", employee_id: "e-2", what_happened: "She was late to her shift on 11/14." } };
        return lastResult(view, "propose_form") ? { text: "Here's the new card." } : { tool: "propose_form", input: { template_key: "dpoa", employee_id: "e-2", what_happened: "She was rude to a guest on 11/15.", incident_date: "2026-11-15", new_form_evidence: evidenceFrom(view, "make a new ca for remy calder") } };
      }));
      const thread = t.thread();
      await thread.say("ca for remy calder, she was late to her shift on 11/14");
      await thread.say("verbal");
      await thread.say("Create a Coaching Form from this conversation");
      await thread.say("make a new ca for remy calder, she was rude to a guest on 11/15");
      expect(thread.proposal?.templateKey).toBe("dpoa");
      expect(levelOf(thread), "the earlier incident's level went on a new incident's card").toBeNull();
    },
  },
];
