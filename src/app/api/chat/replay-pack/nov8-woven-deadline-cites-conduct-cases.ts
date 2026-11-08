import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayAnswer, type ReplayCase, type ReplayContext } from "./cases";

/**
 * ============================================================================
 * A MISSED WOVEN DEADLINE OR COURSE: THE CARD CITES THE STANDARDS OF CONDUCT WITH ITS PAGE (QA, 8 Nov 2026)
 * ============================================================================
 *
 * QA's live tester replayed the managers' exact Woven wordings on production (main 144c26b5, WOVEN_TRAINING_CONDUCT
 * on), and QA reproduced it live (Sonnet 5, 2× each, the flag off and on): pre-existing.
 *   (1) "create a verbal corrective action for <A> for missing the 10-15-26 woven deadline": the card's Policy line was
 *       "this reads as **Standards of Conduct** …" with no section or page, on every turn. The card had cited
 *       "Standards of Conduct Policy, JBA Policy Manual p.12"; REPLY_MATCHES_CARD's one-policy rule read the row as the
 *       heading "this reads as Standards of Conduct" and dropped the line as another policy's.
 *   (2) "… This would be a verbal due to not completing her woven courses by the deadline": no Policy line at all; the
 *       reading took no conduct topic ("not completing" is not one of FAILED's words).
 * CONDUCT_INCIDENT_CITES_PAGE_ENABLED. The managers' words; the person is the pack's invented Marnie Holloway.
 */

const FIX = ["CONDUCT_INCIDENT_CITES_PAGE_ENABLED"];
const REPORT = "QA's live tester, 8 Nov 2026 (production, the managers' Woven wordings): no Standards of Conduct citation with a page";
const CITED = /Standards of Conduct Policy, JBA Policy Manual p\.\d+/;

function start(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-11-07T15:00:00Z"));
  t.directory(STAFF);
  t.as("salon_director", KEARNEY);
  return t.thread();
}

function citesConduct(reply: ReplayAnswer, said: string): void {
  expect(reply.content, `"${said}": no Standards of Conduct citation with its page:\n${reply.content}`).toMatch(CITED);
  expect(reply.content, `"${said}": no Policy line`).toMatch(/\*\*Policy:\*\*[^\n]*Standards of Conduct/);
}

export const NOV8_WOVEN_DEADLINE_CITES_CONDUCT_CASES: ReplayCase[] = [
  {
    id: "nov8-woven-deadline-cites-conduct",
    title: "\"… for missing the 10-15-26 woven deadline\", then the prior coaching and the payroll answer: every card cites Standards of Conduct with its page",
    report: REPORT,
    // Changed on purpose (8 Nov 2026): fixed in production by CONDUCT_INCIDENT_CITES_PAGE_ENABLED, QA round 5, 8 Nov 2026; it now holds with production's flags.
    status: "fixed",
    fixFlags: FIX,
    async run(t) {
      const thread = start(t);
      for (const said of [
        "create a verbal corrective action for marnie holloway for missing the 10-15-26 woven deadline",
        "prior coaching JBA Policy Manual 7-29-26",
        "no payroll deduct",
      ]) {
        const reply = await thread.say(said);
        expect(thread.proposal?.templateKey).toBe("dpoa");
        citesConduct(reply, said);
      }
    },
  },
  {
    id: "nov8-woven-courses-cites-conduct",
    title: "\"… a verbal due to not completing her woven courses by the deadline\": the card has a Standards of Conduct Policy line with its page",
    report: REPORT,
    // Changed on purpose (8 Nov 2026): fixed in production by CONDUCT_INCIDENT_CITES_PAGE_ENABLED, QA round 5, 8 Nov 2026; it now holds with production's flags.
    status: "fixed",
    fixFlags: FIX,
    async run(t) {
      const thread = start(t);
      const said = "Please create another corrective action from marnie holloway. This would be a verbal due to not completing her woven courses by the deadline";
      const reply = await thread.say(said);
      expect(thread.proposal?.templateKey).toBe("dpoa");
      citesConduct(reply, said);
    },
  },
  {
    id: "nov8-woven-conduct-named-policy-wins",
    title: "negative: a policy the manager named is still the one cited",
    report: `${REPORT} (the condition)`,
    status: "fixed",
    fixFlags: FIX,
    async run(t) {
      const thread = start(t);
      const reply = await thread.say("create a corrective action for marnie holloway for violating the attendance policy, she was 30 minutes late to her shift on 10/31");
      expect(reply.content, "the named policy is not cited").toMatch(/Attendance/);
      expect(reply.content, "the Standards of Conduct is cited over the named policy").not.toMatch(CITED);
    },
  },
];

/* QA: WOVEN_TRAINING_CONDUCT_ENABLED is on in production (not yet in production-flags.json): the two cases hold with it on too. */
export const NOV8_WOVEN_DEADLINE_CITES_CONDUCT_WITH_WOVEN_CASES: ReplayCase[] = NOV8_WOVEN_DEADLINE_CITES_CONDUCT_CASES.slice(0, 2).map((replay) => ({
  ...replay,
  id: `${replay.id}-woven-on`,
  title: `${replay.title} (WOVEN_TRAINING_CONDUCT on)`,
  fixFlags: [...FIX, "WOVEN_TRAINING_CONDUCT_ENABLED"],
}));
