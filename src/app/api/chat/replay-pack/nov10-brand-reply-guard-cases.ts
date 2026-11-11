import { expect } from "vitest";

import { KEARNEY, STAFF, type ReplayCase } from "./cases";

/**
 * ============================================================================
 * A POLICY REPLY NAMES ONLY THIS COMPANY AND KEEPS ITS RULE (ported: QA's October triage of the sibling's #198)
 * ============================================================================
 *
 * The answering model scripted to the reply shapes the triage saw: the attendance reply kept "(Sun Tan City, JB &
 * Associates office)", and the availability reply was dropped whole, this company's system with it. Fixed with
 * BRAND_REPLY_GUARD_ENABLED (`ai/brand-reply-rest.ts`).
 */
const ATTENDANCE =
  "The attendance policy applies across all brands (Sun Tan City, Crunch, Buff City Soap, JB & Associates office) [p.14]. A no call no show for a scheduled shift may result in immediate termination [p.14].";
const AVAILABILITY = "Submit availability changes two weeks ahead in MyGlow for Sun Tan City, MyGlow for Buff City Soap, or Woven for Crunch Fitness [p.37].";

export const NOV10_BRAND_REPLY_GUARD_CASES: ReplayCase[] = [
  {
    id: "nov10-brand-reply-guard-attendance-list",
    title: '"what does our policy say about attendance?": the brand list goes, the office with it, and the rule stays',
    report: "QA's October triage (10 Nov 2026) of the sibling app's #198; the same shape here on main with production's flags",
    status: { open: "the office stays in the brand list; fixed with BRAND_REPLY_GUARD_ENABLED" },
    fixFlags: ["BRAND_REPLY_GUARD_ENABLED"],
    async run(t) {
      t.directory(STAFF);
      t.as("salon_director", KEARNEY);
      t.modelSays(ATTENDANCE);
      const reply = await t.thread().say("what does our policy say about attendance?");
      expect(reply.content, reply.content).not.toMatch(/jb\s*&\s*associates office|buff\s+city|crunch/i);
      expect(reply.content, reply.content).toMatch(/no call no show for a scheduled shift may result in immediate termination \[p\.14\]/i);
    },
  },
  {
    id: "nov10-brand-reply-guard-availability",
    title: '"changing availabilty": this company\'s system is kept, the others go',
    report: "QA's October triage (10 Nov 2026) of the sibling app's #198; the same shape here on main with production's flags",
    status: { open: "the availability reply is dropped whole; fixed with BRAND_REPLY_GUARD_ENABLED" },
    fixFlags: ["BRAND_REPLY_GUARD_ENABLED"],
    async run(t) {
      t.directory(STAFF);
      t.as("salon_director", KEARNEY);
      t.modelSays(AVAILABILITY);
      const reply = await t.thread().say("changing availabilty");
      expect(reply.content, reply.content).toMatch(/MyGlow for Sun Tan City \[p\.37\]/);
      expect(reply.content, reply.content).not.toMatch(/buff\s+city|crunch/i);
    },
  },
];
