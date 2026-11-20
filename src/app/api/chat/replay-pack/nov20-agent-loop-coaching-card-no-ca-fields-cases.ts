import { expect, vi } from "vitest";

import { TESTY } from "@/lib/ai/agent-loop/phrasing-table";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayCase } from "./cases";
import { lastResult, loopStandIn, type LoopDecision } from "./loop-stand-in";

/**
 * ============================================================================
 * A COACHING CARD NEVER MENTIONS PAYROLL DEDUCT OR A WARNING LEVEL (QA, 20 Nov 2026, board row f060)
 * ============================================================================
 *
 * The live test of #1120 (conv_mwozabzb2vm0zqi): "At Kearney, coaching Test Testy on greeting guests" made a Coaching
 * Form card, and the reply ended "Policy: Other — Greeting Guests. Payroll deduct and warning level aren't set; tell me
 * if they apply." A Coaching Form has neither. Cause: propose_form's card result carried warning_level, payroll_deduct
 * and payroll_amount on every form, null on a coaching card, and the model read the nulls as "not set". General rule:
 * the card result carries the Corrective-Action-only fields (warning level, payroll deduct, payroll amount) only on a
 * Corrective Action card. The coaching card's Policy line stays (every coaching card cites a policy, #1092); its
 * account label is #1144's (Coding-7), not changed here. Test Testy is the app's test employee.
 */

const FLAG = "AGENT_LOOP_ENABLED";
const REPORT = "QA board row f060 (20 Nov 2026, live test of #1120): a Coaching card's reply said \"Payroll deduct and warning level aren't set\"";
const offline = process.env.AGENT_LOOP_LIVE !== "1";
const SAID = "At Kearney, coaching Test Testy on greeting guests";
const TEST_TESTY: DirectoryRow = { id: TESTY.id, firstName: TESTY.firstName, lastName: TESTY.lastName, preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0309"], positionName: "Tanning Consultant" };

type CardOut = { card?: Record<string, unknown>; facts?: { unset?: string[] } };

export const NOV20_AGENT_LOOP_COACHING_CARD_NO_CA_FIELDS_CASES: ReplayCase[] = [
  {
    id: "nov20-coaching-card-no-payroll-or-level-f060",
    title: "f060: \"At Kearney, coaching Test Testy on greeting guests\": the Coaching card's result carries no warning level or payroll field, so the reply never says payroll deduct or the warning level isn't set",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.() || !offline) return;
      vi.setSystemTime(new Date("2026-11-20T15:00:00Z"));
      t.directory([...STAFF, TEST_TESTY]);
      t.as("salon_director", KEARNEY);
      const model = loopStandIn((view): LoopDecision => {
        const out = lastResult(view, "propose_form") as CardOut | null;
        if (!out) return { tool: "propose_form", input: { template_key: "coaching", employee_id: TESTY.id, topic: "greeting guests", what_happened: "Coaching on greeting guests.", policy: "Other — Greeting Guests" } };
        // The live model read the card's null fields as fields to ask about.
        const blank = ["payroll_deduct", "warning_level"].filter((field) => field in (out.card ?? {}) && out.card![field] === null);
        return { text: `Here's the Coaching Form for **Test**.\n\n**Policy:** Other — Greeting Guests.${blank.length === 2 ? " Payroll deduct and warning level aren't set; tell me if they apply." : ""}` };
      });
      t.loopModel!(model);
      const reply = await t.thread().say(SAID);
      const out = lastResult(model.views.at(-1)!, "propose_form") as CardOut;
      expect(Object.keys(out.card ?? {}), JSON.stringify(out.card)).not.toEqual(expect.arrayContaining(["warning_level"]));
      expect(Object.keys(out.card ?? {})).not.toContain("payroll_deduct");
      expect(Object.keys(out.card ?? {})).not.toContain("payroll_amount");
      expect(out.facts?.unset ?? []).toEqual([]);
      expect(reply.content, `a Coaching card's reply mentions payroll or the level:\n${reply.content}`).not.toMatch(/payroll|warning level/i);
    },
  },
  {
    id: "nov20-coaching-card-control-ca-keeps-fields",
    title: "f060 control: a Corrective Action card's result still carries warning_level, payroll_deduct and payroll_amount (null until stated)",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.() || !offline) return;
      vi.setSystemTime(new Date("2026-11-20T15:00:00Z"));
      t.directory([...STAFF, TEST_TESTY]);
      t.as("salon_director", KEARNEY);
      const model = loopStandIn((view): LoopDecision => (lastResult(view, "propose_form")
        ? { text: "Here's the card." }
        : { tool: "propose_form", input: { template_key: "dpoa", employee_id: TESTY.id, what_happened: "Test Testy was late to open on 11/19.", incident_date: "2026-11-19" } }));
      t.loopModel!(model);
      await t.thread().say("ca for test testy, late to open on 11/19");
      const out = lastResult(model.views.at(-1)!, "propose_form") as CardOut;
      expect(Object.keys(out.card ?? {})).toEqual(expect.arrayContaining(["warning_level", "payroll_deduct", "payroll_amount"]));
    },
  },
];
