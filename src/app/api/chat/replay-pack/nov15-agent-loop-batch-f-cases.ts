import { expect, vi } from "vitest";

import { LOOP_FAILED_REPLY, STEP_LIMIT_REPLY } from "@/lib/ai/agent-loop/replies";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";
import { lastResult, loopStandIn, type LoopDecision, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * BATCH F: THE LOOP'S ROBUSTNESS ITEMS (QA, 15 Nov 2026, from Pau's review list)
 * ============================================================================
 *
 * One case per item, through the real chat route with the loop on for this case's manager (`t.loopModel`).
 * F1 an error or timeout after a save says what was saved; F2 the step limit names the card that is ready; F3 a refused
 * edit to a finalized form leaves no empty revision; F4 one step budget for the turn; F5 turns carrying what the loop
 * does not take yet go to today's path. Remy Calder is STAFF's invented person.
 */
const REPORT = "QA, batch F (15 Nov 2026): the agent loop's robustness items from Pau's review list";
const FLAG = "AGENT_LOOP_ENABLED";
const SAID = "verbal CA for remy calder, she was 20 minutes late on 11/9/26";
const CARD = { tool: "propose_form", input: { template_key: "dpoa", employee_id: "e-2", policy: "Attendance", what_happened: "Remy Calder arrived 20 minutes late for her shift on 11/9/26." } } as const;

function start(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-11-11T16:00:00Z"));
  t.directory(STAFF);
  t.as("salon_director", KEARNEY);
  return t.thread();
}

/** The card first, then `after` for every later model call this turn. */
function cardThen(after: (view: LoopView) => LoopDecision) {
  return loopStandIn((view) => (lastResult(view, "propose_form") ? after(view) : CARD));
}

export const NOV15_AGENT_LOOP_BATCH_F_CASES: ReplayCase[] = [
  {
    id: "nov15-batch-f1-error-after-card-says-what-was-made",
    title: "F1: the model fails after the card was made: the reply shows the card and says the rest didn't finish, never \"Nothing was saved\"",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      const thread = start(t);
      t.loopModel!(cardThen(() => ({ fail: true })));
      const reply = await thread.say(SAID);
      expect(reply.content, "an error after the card said nothing was saved").not.toMatch(/Nothing was saved/);
      expect(reply.content).toMatch(/Here is the \*\*.+\*\* for \*\*Remy Calder\*\* for you to review\./);
      expect(reply.content).toMatch(/Something went wrong before I could finish the rest/);
      expect(reply.formProposal?.employeeName, "the screen did not get the card").toBe("Remy Calder");
    },
  },
  {
    id: "nov15-batch-f1-timeout-after-card-says-what-was-made",
    title: "F1: the model stalls after the card was made: the reply shows the card and says time ran out, never a bare 504",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      const thread = start(t);
      t.loopModel!(cardThen(() => ({ stall: true })));
      const saved = process.env.AI_MAIN_TIMEOUT_MS;
      process.env.AI_MAIN_TIMEOUT_MS = "5000";
      try {
        const reply = await thread.say(SAID);
        expect(reply.content).toMatch(/for \*\*Remy Calder\*\* for you to review\./);
        expect(reply.content).toMatch(/I ran out of time before finishing the rest/);
        expect(reply.formProposal?.employeeName).toBe("Remy Calder");
      } finally {
        if (saved === undefined) delete process.env.AI_MAIN_TIMEOUT_MS;
        else process.env.AI_MAIN_TIMEOUT_MS = saved;
      }
    },
  },
  {
    id: "nov15-batch-f1-error-with-nothing-done-still-says-nothing-saved",
    title: "F1 guard: the model fails before doing anything: \"Nothing was saved\" stays, as before",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      const thread = start(t);
      t.loopModel!(loopStandIn(() => ({ fail: true })));
      const failure = await thread.say(SAID).then(() => null, (error: unknown) => String((error as Error).message));
      expect(failure, "a turn that did nothing answered 200").not.toBeNull();
      expect(failure).toContain(LOOP_FAILED_REPLY);
    },
  },
  {
    id: "nov15-batch-f2-step-limit-names-the-card",
    title: "F2: the step limit with a card made: the reply names the card ready to review and asks for the one thing left",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      const thread = start(t);
      t.loopModel!(cardThen(() => ({ tool: "find_staff", input: { name: "remy calder" } })));
      const reply = await thread.say(SAID);
      expect(reply.content, "the step limit said it couldn't finish over a ready card").not.toBe(STEP_LIMIT_REPLY);
      expect(reply.content).toMatch(/Here is the \*\*.+\*\* for \*\*Remy Calder\*\* for you to review\./);
      expect(reply.content).toMatch(/What's the one thing still left\?/);
      expect(reply.formProposal?.employeeName).toBe("Remy Calder");
    },
  },
  {
    id: "nov15-batch-f3-refused-edit-on-finalized-form-opens-nothing",
    title: "F3: an edit to a finalized form that is refused (an unknown field) leaves no new revision draft and opens nothing",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      const thread = start(t);
      let finalizedId = "";
      t.loopModel!(loopStandIn((view) => {
        const said = view.turns.filter((turn) => turn.role === "user").at(-1)?.text ?? "";
        if (/\bchange\b/i.test(said)) {
          return lastResult(view, "edit_form") ? { text: "That field isn't on the form." } : { tool: "edit_form", input: { instance_id: finalizedId, values: { not_a_field_on_this_form: "anything" } } };
        }
        return lastResult(view, "propose_form") ? { text: "Here is the card." } : CARD;
      }));
      await thread.say(SAID);
      t.draftWrites({ observation: "Observed:\nRemy Calder arrived 20 minutes late for her shift on 11/9/26." });
      finalizedId = await thread.create();
      Object.assign(t.forms().find((row) => row.id === finalizedId)!, { status: "finalized" });
      const before = t.forms().length;
      const reply = await thread.say("change the not a field on this form on remy calder's ca");
      expect(t.forms().filter((row) => row.revises_instance_id === finalizedId), "a refused edit left a revision draft").toHaveLength(0);
      expect(t.forms().length, "a form was added by a refused edit").toBe(before);
      expect(reply.formOpened, "a refused edit opened a draft on screen").toBeUndefined();
    },
  },
  {
    id: "nov15-batch-f7-forms-on-file-name-the-salon",
    title: "F7: \"what forms does <A> have on file\": find_past_forms gives each form's salon by name, never its id",
    report: `${REPORT}; the live test with a form open: entries showed "(loc-0468)" and "(loc-0394)"`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      const thread = start(t);
      const model = loopStandIn((view) => {
        const said = view.turns.filter((turn) => turn.role === "user").at(-1)?.text ?? "";
        if (/on file/i.test(said)) return lastResult(view, "find_past_forms") ? { text: "Here is what is on file." } : { tool: "find_past_forms", input: { employee_name: "remy calder" } };
        return lastResult(view, "propose_form") ? { text: "Here is the card." } : CARD;
      });
      t.loopModel!(model);
      await thread.say(SAID);
      t.draftWrites({ observation: "Observed:\nRemy Calder arrived 20 minutes late for her shift on 11/9/26." });
      await thread.create();
      await thread.say("what forms does remy calder have on file");
      const listed = model.views.flatMap((view) => view.results).filter((result) => result.tool === "find_past_forms").at(-1)?.output as { forms?: { salon?: string | null }[] } | undefined;
      expect(listed?.forms?.length, "the form on file was not listed").toBeGreaterThan(0);
      for (const form of listed?.forms ?? []) expect(form.salon, "a salon id reached the model").not.toMatch(/^loc-/);
      expect(listed?.forms?.[0]?.salon).toBe("NE Kearney");
    },
  },
  {
    id: "nov15-batch-f8-value-edit-moves-updated-at",
    title: "F8: a chat edit that changes only a value (the Observation) on a draft moves the form's updated_at",
    report: `${REPORT}; the first live test with a form open: three value edits (events 4 → 7) left updated_at unchanged`,
    // Changed on purpose (15 Nov 2026): fixed in production by FORM_EDIT_TOUCHES_UPDATED_AT (QA turns it on with #1002). Was OPEN.
    status: "fixed",
    fixFlags: [FLAG, "FORM_EDIT_TOUCHES_UPDATED_AT_ENABLED"],
    async run(t) {
      if (!t.loopOn?.()) return;
      const thread = start(t);
      let draftId = "";
      t.loopModel!(loopStandIn((view) => {
        const said = view.turns.filter((turn) => turn.role === "user").at(-1)?.text ?? "";
        if (/\badd\b/i.test(said)) {
          return lastResult(view, "edit_form") ? { text: "I added that to the Observation." } : { tool: "edit_form", input: { instance_id: draftId, values: { observation: "Remy Calder arrived 20 minutes late for her shift on 11/9/26. She did not call ahead." } } };
        }
        return lastResult(view, "propose_form") ? { text: "Here is the card." } : CARD;
      }));
      await thread.say(SAID);
      t.draftWrites({ observation: "Observed:\nRemy Calder arrived 20 minutes late for her shift on 11/9/26." });
      draftId = await thread.create();
      const row = t.forms().find((form) => form.id === draftId)!;
      Object.assign(row, { updated_at: "2026-11-11T16:00:00.000Z" });
      vi.setSystemTime(new Date("2026-11-11T17:30:00Z"));
      await thread.say("add that she did not call ahead");
      expect(t.values(draftId).observation ?? "", "the edit was not written").toMatch(/did not call ahead/);
      expect(String(t.forms().find((form) => form.id === draftId)!.updated_at), "a value edit left updated_at unchanged").not.toBe("2026-11-11T16:00:00.000Z");
    },
  },
  {
    id: "nov15-batch-f4-one-step-budget",
    title: "F4: a self-check after the main loop used every step gets none of its own: the turn never passes the step cap",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      const thread = start(t);
      // The card, four lookups, then a reply claiming a level the card does not hold: the self-check would hand back.
      const model = cardThen((view) =>
        view.results.filter((result) => result.tool === "find_staff").length < 4
          ? { tool: "find_staff", input: { name: "remy calder" } }
          : { text: "Here is the card. **Type of Warning:** Written Warning." },
      );
      t.loopModel!(model);
      const reply = await thread.say(SAID);
      expect(model.calls, "the turn's model calls passed the step cap (6)").toBeLessThanOrEqual(6);
      expect(reply.content, "the unchecked claim reached the manager").not.toMatch(/\*\*Type of Warning:\*\* Written/);
    },
  },
  ...(
    [
      ["attachments", { attachedDocumentIds: ["doc-batch-f"] }],
      ["report-context", { reportContext: { family: "sales-totals" } }],
      ["pending-copy", { pendingCopyFromInstanceId: "00000000-0000-4000-8000-00000000f5f5" }],
      ["answer-mode", { mode: "quick" }],
    ] as const
  ).map(([key, extra]): ReplayCase => ({
    id: `nov15-batch-f5-${key}-goes-to-todays-path`,
    title: `F5: a turn carrying ${key.replace("-", " ")} goes to today's path, not the loop (the loop does not take it yet)`,
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      const thread = start(t);
      const model = loopStandIn(() => ({ text: "the loop answered" }));
      t.loopModel!(model);
      const reply = await thread.say("what is the attendance policy?", {}, extra);
      expect(model.calls, `the loop took a turn carrying ${key}`).toBe(0);
      expect(reply.content).not.toBe("the loop answered");
    },
  })),
  {
    id: "nov15-batch-f5-plain-turn-still-goes-to-the-loop",
    title: "F5 guard: a plain turn still goes to the loop",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      const thread = start(t);
      const model = loopStandIn(() => ({ text: "the loop answered" }));
      t.loopModel!(model);
      const reply = await thread.say("what is the attendance policy?");
      expect(model.calls).toBeGreaterThan(0);
      expect(reply.content).toBe("the loop answered");
    },
  },
];
