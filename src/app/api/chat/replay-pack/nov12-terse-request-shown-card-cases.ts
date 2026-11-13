import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";

/**
 * ============================================================================
 * A TERSE REQUEST'S ACCOUNT, AND NO "PRESS CREATE DRAFT" WITHOUT THE BUTTON (QA's #745 follow-ups, ported from the
 * sibling app's #842, 12 Nov 2026)
 * ============================================================================
 *
 * QA's October triage (U4's terse typo wording; the employee is the pack's invented Rowan Kestrel): "writen ca rowan
 * kestrel not atending monthly meeting 12-20-26" — here the card's Observation was the whole request line and it cited
 * no policy (TERSE_REQUEST_ACCOUNT_ENABLED). And "write ca" / "…needs CA", then "create it": the reply said "press
 * **Create draft** on the card" while the card only asked who the form is for, with no button
 * (CREATE_POINTS_TO_SHOWN_CARD_ENABLED). Both default off.
 */
const REPORT = "QA's #745 follow-ups (12 Nov 2026), ported from the sibling app's #842";
const TERSE = "writen ca rowan kestrel not atending monthly meeting 12-20-26";

function start(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-10-25T15:00:00Z"));
  t.directory([...STAFF]);
  t.as("salon_director", KEARNEY);
  return t.thread();
}

const casings = (text: string) => [["lower", text], ["sentence", text[0]!.toUpperCase() + text.slice(1)]] as const;

export const NOV12_TERSE_REQUEST_ACCOUNT_CASES: ReplayCase[] = casings(TERSE).map(([casing, text]) => ({
  id: `nov12-terse-request-account-${casing}`,
  title: `"${text}" — the Observation is the account after the name, and the card cites Attendance`,
  report: `${REPORT}; ${casing}`,
  status: { open: "the Observation is the whole request line and no policy is cited" },
  fixFlags: ["TERSE_REQUEST_ACCOUNT_ENABLED"],
  async run(t: ReplayContext) {
    const thread = start(t);
    const reply = await thread.say(text);
    expect(thread.proposal, `no Corrective Action card for Rowan Kestrel:\n${reply.content}`).toMatchObject({ templateKey: "dpoa", employeeName: "Rowan Kestrel" });
    const observation = /\*\*Observation of Offense:\*\*\s*([^\n]*)/.exec(reply.content)?.[1] ?? "";
    expect(observation, `the Observation is the request line:\n${reply.content}`).not.toMatch(/writen ca/i);
    expect(observation, `the account is not the Observation:\n${reply.content}`).toMatch(/^not atending monthly meeting/i);
    expect(reply.content, `the card cites no Attendance policy:\n${reply.content}`).toMatch(/\*\*Policy:\*\*[^\n]*\*\*Attendance\*\*/);
    // QA's #910 follow-up: the Policy line quotes the manager's own words, never the app's paraphrase.
    expect(reply.content, `the Policy line quotes words the manager did not write:\n${reply.content}`).not.toMatch(/"missed the monthly meeting"/);
    expect(reply.content, `the Policy line does not quote the manager's words:\n${reply.content}`).toMatch(/\*\*Policy:\*\*[^\n]*"not atending monthly meeting"/);
  },
}));

export const NOV12_CREATE_POINTS_TO_SHOWN_CARD_CASES: ReplayCase[] = [
  { key: "write-ca", text: "write ca" },
  { key: "needs-ca", text: "an employee opened the salon 15 min late and needs CA" },
].flatMap((turn) =>
  casings(turn.text).map(([casing, text]) => ({
    id: `nov12-create-points-to-shown-card-${turn.key}-${casing}`,
    title: `"${text}", then "create it" — no "press Create draft" while the card asks who it is for`,
    report: `${REPORT}; ${turn.key}, ${casing}`,
    status: { open: "\"press **Create draft** on the card\" with no button on the card" },
    fixFlags: ["CREATE_POINTS_TO_SHOWN_CARD_ENABLED"],
    async run(t: ReplayContext) {
      const thread = start(t);
      await thread.say(text);
      expect(thread.proposal, "no Corrective Action card").toMatchObject({ templateKey: "dpoa", employeeName: null });
      const again = await thread.say("create it");
      expect(again.content, `points to a Create button that isn't there:\n${again.content}`).not.toMatch(/press \*\*Create draft\*\*/i);
      expect(again.content, `the employee is not asked for:\n${again.content}`).toMatch(/who is this[^\n]*for\?/i);
    },
  })),
);
