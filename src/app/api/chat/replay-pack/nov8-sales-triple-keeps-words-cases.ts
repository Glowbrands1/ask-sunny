import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayAnswer, type ReplayCase, type ReplayContext } from "./cases";

/**
 * ============================================================================
 * THE SALES TRIPLE KEEPS THE MANAGER'S WORDS (QA's Sunny round-4 gate, 8 Nov 2026)
 * ============================================================================
 *
 * SALES_SHORTFALL_OBJECT + SALES_OBSERVATION_ACCOUNT (+ CA_PERFORMANCE_REASON) cut the reason and a payroll answer
 * wherever they stood in the Observation: "This is for Under Performance on PPTA, …" became "This is on PPTA, …" and
 * "which will be payroll deducted from <name>'s check" became "which will be from <name>'s check". Only the request
 * clause may be cut (`forms/ca-policy.ts` observationAccount). Production's wording, the people the pack's invented
 * Remy Calder and Marnie Holloway.
 */
const TRIPLE = ["SALES_SHORTFALL_OBJECT_ENABLED", "SALES_OBSERVATION_ACCOUNT_ENABLED", "CA_PERFORMANCE_REASON_ENABLED"];
const REPORT = "QA's Sunny round-4 gate, 8 Nov 2026: the sales triple cut the manager's words from the Observation";

function observationLine(reply: ReplayAnswer): string {
  return /\*\*Observation of Offense:\*\*[^\n]*/.exec(reply.content)?.[0] ?? "";
}

function start(t: ReplayContext, at = "2026-11-07T18:56:00Z") {
  vi.setSystemTime(new Date(at));
  t.directory(STAFF);
  t.as("salon_director", KEARNEY);
  return t.thread();
}

export const NOV8_SALES_TRIPLE_KEEPS_WORDS_CASES: ReplayCase[] = [
  {
    id: "nov8-sales-triple-under-performance-on-ppta",
    title: "\"I need a CA for Under Performance on PPTA, …\": with the sales triple the Observation keeps \"Under Performance on PPTA\"",
    report: `${REPORT} (nov6-form-name-keeps-under-performance)`,
    status: "fixed",
    fixFlags: TRIPLE,
    async run(t) {
      const reply = await start(t).say("I need a CA for Under Performance on PPTA, LPSVA, Club Average, Club Close %, and Spa %.");
      const line = observationLine(reply);
      expect(line, `no Observation:\n${reply.content}`).not.toBe("");
      expect(line, `the Observation drops the manager's words:\n${reply.content}`).toMatch(/Under Performance on PPTA, LPSVA, Club Average, Club Close %, and Spa %/);
    },
  },
  {
    id: "nov8-sales-triple-this-is-for-under-performance",
    title: "\"… This is for Under Performance on PPTA, …\": the Observation is never \"This is on PPTA\"",
    report: `${REPORT} (about 20 production chats, 5–7 Nov 2026)`,
    status: "fixed",
    fixFlags: TRIPLE,
    async run(t) {
      const reply = await start(t).say(
        "I need a corrective action verbal for Remy Calder. This is for Under Performance on PPTA, LPSVA, Club Average, Club Close %, and Spa %.",
      );
      const line = observationLine(reply);
      expect(line, `no Observation:\n${reply.content}`).not.toBe("");
      expect(line, `the Observation drops the manager's words:\n${reply.content}`).not.toMatch(/This is on PPTA/i);
      expect(line, `the Observation drops the manager's words:\n${reply.content}`).toMatch(/Under Performance on PPTA/);
    },
  },
  {
    id: "nov8-sales-triple-payroll-deducted-from-check",
    title: "\"… which will be payroll deducted from Marnie's check\": the Observation keeps \"payroll deducted\"",
    report: `${REPORT} (nov6-payroll-amount-same-message)`,
    status: "fixed",
    fixFlags: TRIPLE,
    async run(t) {
      const reply = await start(t, "2026-11-05T15:49:00Z").say(
        "create a verbal ca for marnie holloway. on 11-1-26 the register was off $20. which will be payroll deducted from Marnie's check. previous coaching was jba policy manual on 8-1-26. payroll deduct applies",
      );
      const line = observationLine(reply);
      expect(line, `no Observation:\n${reply.content}`).not.toBe("");
      expect(line, `the Observation cuts "payroll deducted":\n${reply.content}`).not.toMatch(/which will be from/i);
    },
  },
  {
    id: "nov8-sales-triple-payroll-deduct-applies",
    title: "\"… payroll deduct applies and $3.25 will be deducted from check\": the Observation keeps \"payroll deduct\"",
    report: `${REPORT} (nov3-stepb-payroll-as-given)`,
    status: "fixed",
    fixFlags: TRIPLE,
    async run(t) {
      const reply = await start(t, "2026-11-03T15:00:00Z").say(
        "create ca form for remy calder for a register shortage on 10-20-26. payroll deduct applies and $3.25 will be deducted from check.",
      );
      const line = observationLine(reply);
      expect(line, `the Observation cuts "payroll deduct":\n${reply.content}`).toContain("payroll deduct applies and $3.25 will be deducted from check");
    },
  },
];
