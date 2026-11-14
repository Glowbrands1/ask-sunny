import { expect, vi } from "vitest";

import { STAFF, TWO_SALONS, type DirectoryRow, type ReplayCase } from "./cases";
import { lastResult, loopStandIn, type LoopDecision, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * THE EMPLOYEE'S SALON, AND NO WORD-FOR-WORD REPEAT (QA's tester run on Pau's account, 14 Nov 2026)
 * ============================================================================
 *
 * L3/L4: a manager on two salons; the card stayed needs_location and the loop asked "which salon" on every turn (L4:
 * five turns, then took the name "erin" as no answer). Woven already lists the employee's salon. L5: "Yes" to "Using
 * <X> from your staff list" was answered with the first reply's "What happened?" word for word.
 *
 * The fix is a fact (propose_form's employee_salon, from the roster row's primary salon in the manager's scope) and
 * rules-book lines (file it there and say so in one line; ask once at most; never repeat a question word for word).
 * The careful stand-ins follow the rules, so these hold offline; live, the real model takes their place and only the
 * outcome is checked. Every person here is invented.
 */

const FLAG = "AGENT_LOOP_ENABLED";
const REPORT = "QA's tester run on Pau's account (14 Nov 2026), L3/L4 and L5";

/** Works at both of the manager's salons; Woven lists Kearney (loc-0309) as her salon. */
const ORIEL: DirectoryRow & { primarySalonId: string } = { id: "e-oriel-fenwick", firstName: "Oriel", lastName: "Fenwick", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0307", "loc-0309"], positionName: "Tanning Consultant", primarySalonId: "loc-0309" };

const latest = (view: LoopView) => [...view.turns].reverse().find((turn) => turn.role === "user")?.text ?? "";
const allSaid = (view: LoopView) => view.turns.filter((turn) => turn.role === "user").map((turn) => turn.text).join("\n");
const facts = (view: LoopView) => (lastResult(view, "propose_form")?.facts ?? {}) as { employee_salon?: string };

/** A careful model: proposes, files the card at the employee's salon when Woven lists one, and says so in one line. */
function carefulSalon(): ReturnType<typeof loopStandIn> {
  return loopStandIn((view): LoopDecision => {
    const said = allSaid(view);
    const tries = view.results.filter((result) => result.tool === "propose_form").length;
    const input = {
      template_key: "dpoa",
      employee_id: ORIEL.id,
      what_happened: /20 minutes/.test(said) ? "Oriel Fenwick was 20 minutes late on 11/12." : "Oriel Fenwick was late on 11/12.",
      ...(/written/.test(said) ? { warning_level: "written" } : {}),
      ...(/no payroll/.test(said) ? { payroll_deduct: "no" } : {}),
    };
    if (!lastResult(view, "find_staff")) return { tool: "find_staff", input: { name: "oriel fenwick" } };
    if (tries === 0) return { tool: "propose_form", input: { ...input, salon: "kearney" } };
    if (tries === 1 && facts(view).employee_salon) return { tool: "propose_form", input: { ...input, salon: facts(view).employee_salon } };
    return { text: `Got it, Oriel.\n\nHere's the Corrective Action Form for **Oriel Fenwick**, filed at **NE Kearney**, where Woven lists Oriel; say if it's another salon.\n\n**Observation of Offense:** ${input.what_happened}` };
  });
}

export const NOV14_LIVE_R5_CASES: ReplayCase[] = [
  {
    id: "nov14-live-r5-salon-from-woven-not-asked",
    title: "QA L3/L4: a manager on two salons, an employee Woven lists at the second; the request names no salon: the card is filed there and the reply never asks which salon",
    report: `${REPORT}: "the card stays needs_location and the loop asks which salon on every turn"`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      vi.setSystemTime(new Date("2026-11-13T22:40:00Z"));
      t.directory([...STAFF, ORIEL]);
      t.as("salon_director", TWO_SALONS);
      // The first proposal names no salon: the stand-in only adds one from the fact.
      t.loopModel!(loopStandIn((view): LoopDecision => {
        const tries = view.results.filter((result) => result.tool === "propose_form").length;
        const input = { template_key: "dpoa", employee_id: ORIEL.id, what_happened: "Oriel Fenwick was late on 11/12." };
        if (!lastResult(view, "find_staff")) return { tool: "find_staff", input: { name: "oriel fenwick" } };
        if (tries === 0) return { tool: "propose_form", input };
        if (tries === 1 && facts(view).employee_salon) return { tool: "propose_form", input: { ...input, salon: facts(view).employee_salon } };
        return { text: "Here's the Corrective Action Form for **Oriel Fenwick**, filed at **NE Kearney**, where Woven lists Oriel; say if it's another salon.\n\n**Observation of Offense:** Late on 11/12." };
      }));
      const thread = t.thread();
      const reply = await thread.say("ca for oriel fenwick, she was late on 11/12");
      expect(thread.proposal?.locationId, `the card is not at Woven's salon:\n${reply.content}`).toBe("loc-0309");
      expect(thread.proposal?.status).toBe("ready");
      expect(reply.content, "asked which salon although Woven lists it").not.toMatch(/which salon/i);
    },
  },
  {
    id: "nov14-live-r5-l4-salon-asked-at-most-once",
    title: "QA L4's shape (five turns: the request, the account, the level, payroll, a first name): the salon is asked at most once, a first name is never taken as the salon answer, and the card ends at Woven's salon",
    report: `${REPORT}: L4 asked for the salon five turns in a row; t5 "erin" got "I need the salon, not the name"`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      vi.setSystemTime(new Date("2026-11-13T22:40:00Z"));
      t.directory([...STAFF, ORIEL]);
      t.as("salon_director", TWO_SALONS);
      t.loopModel!(carefulSalon());
      const thread = t.thread();
      const replies: string[] = [];
      for (const turn of ["ca for oriel fenwick", "she was 20 minutes late on 11/12", "make it a written", "no payroll deduct", "oriel"]) {
        replies.push((await thread.say(turn)).content);
      }
      const asks = replies.filter((reply) => /which salon/i.test(reply)).length;
      expect(asks, `the salon was asked ${asks} times:\n${replies.join("\n---\n")}`).toBeLessThanOrEqual(1);
      expect(replies.at(-1) ?? "", "a first name was taken as no salon answer").not.toMatch(/need the salon|not the name/i);
      expect(thread.proposal?.locationId, "the card is not at a salon").toBe("loc-0309");
    },
  },
  {
    id: "nov14-live-r5-yes-never-repeats-the-question",
    title: "QA L5: \"Yes\" to \"Using <X> from your staff list\": the reply acknowledges it and never repeats the previous question word for word",
    report: `${REPORT}: L5, "Yes" got the first reply's "What happened?" again, word for word`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      vi.setSystemTime(new Date("2026-11-13T22:40:00Z"));
      t.directory([...STAFF, ORIEL]);
      t.as("salon_director", TWO_SALONS);
      t.loopModel!(loopStandIn((view): LoopDecision => {
        if (!lastResult(view, "find_staff")) return { tool: "find_staff", input: { name: "oriel fenwik" } };
        if (!lastResult(view, "propose_form")) return { tool: "propose_form", input: { template_key: "dpoa", employee_id: ORIEL.id, salon: "kearney" } };
        return { text: /^\s*yes\b/i.test(latest(view)) ? "Got it, Oriel. What did she do? I'll put it on the form in your words." : "Using **Oriel Fenwick** from your staff list.\n\nWhat happened?" };
      }));
      const thread = t.thread();
      const first = await thread.say("ca for oriel fenwik");
      const yes = await thread.say("Yes");
      const lastQuestion = (text: string) => text.split(/\n+/).filter((line) => /\?\s*$/.test(line)).at(-1)?.trim() ?? "";
      expect(lastQuestion(yes.content), `the question was repeated word for word:\n${yes.content}`).not.toBe(lastQuestion(first.content) || "\u0000");
    },
  },
];
