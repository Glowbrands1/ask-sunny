import { expect, vi } from "vitest";

import { STAFF, KEARNEY, type DirectoryRow, type ReplayCase, type ReplayContext } from "./cases";

/**
 * ============================================================================
 * "LASTNAME, FIRSTNAME" WHEN THE AI READER GIVES NO EMPLOYEE (audit of #352, 6 Nov 2026; ported from Ask Bubbles)
 * ============================================================================
 *
 * This app's #352 read "Calder, Remy" as Remy Calder without a model (`ai/reader/last-first.ts`,
 * LAST_FIRST_NAME_READ_ENABLED, on in production). It runs only when AI_READS_CODE_CHECKS_ENABLED is off — and
 * that flag is ON in production, so when the AI reader returns no employee, times out or errors, nothing reads
 * "<Last>, <First>": the card is for "Calder". QA's audit wording, with production's flags, fails in both apps.
 * LAST_FIRST_AI_FALLBACK_ENABLED (default off, same name in both apps) applies the same last-first reading when
 * the AI reader's result has no employee or falls back (`ai/reader/last-first-fallback.ts`, called from `ai/intent-extraction.ts`).
 *
 * People invented (Remy Calder is the pack's; Odile Calder is new).
 */

type T = ReplayContext;

const FIX = ["LAST_FIRST_AI_FALLBACK_ENABLED"];
const AUDIT = "QA's old-PR audit (6 Nov 2026, misc #352): a replay case with the stand-in AI reader gives a card for <Last> only";
const WORDING = "My employee Calder, Remy was late on the 2nd at Kearney. Please create a CA form";

/** A second Calder: the AI reader's lone "Calder" fits two people, so it is no employee. */
const ODILE: DirectoryRow = {
  id: "e-odile-calder",
  firstName: "Odile",
  lastName: "Calder",
  preferredFirstName: null,
  employmentStatus: "active",
  salonIds: ["loc-0309"],
  positionName: "Tanning Consultant",
};

function start(t: T, extra: readonly DirectoryRow[] = []) {
  vi.setSystemTime(new Date("2026-10-26T15:30:00Z"));
  t.directory([...STAFF, ...extra]);
  t.as("salon_director", KEARNEY);
  return t.thread();
}

export const NOV6_LAST_FIRST_AI_FALLBACK_CASES: ReplayCase[] = [
  {
    id: "nov6-last-first-ai-fallback-audit",
    title: `"${WORDING}": the AI reader reads no employee; the card is Remy Calder's`,
    report: `${AUDIT}: "${WORDING}"`,
    status: { open: 'the AI reader is on and reads no employee, so the last-first reading never runs: the card is for "Calder"' },
    fixFlags: FIX,
    async run(t) {
      const thread = start(t);
      const reply = await thread.say(WORDING);
      expect(thread.proposal, `not Remy Calder's card:\n${reply.content}`).toMatchObject({ templateKey: "dpoa", employeeName: "Remy Calder" });
      expect(reply.content).not.toMatch(/couldn'?t find/i);
    },
  },
  {
    id: "nov6-last-first-ai-fallback-last-only",
    title: `"${WORDING}" with two Calders, the AI reader reading only "Calder": the card is Remy Calder's`,
    report: `${AUDIT}; the reader returned only the "<Last>" word of the "<Last>, <First>" the manager typed`,
    status: { open: 'the AI reader\'s "Calder" fits two people, so it is no employee and the last-first reading never runs' },
    fixFlags: FIX,
    async run(t) {
      const thread = start(t, [ODILE]);
      const reply = await thread.say(WORDING, { employeeName: "Calder" });
      expect(thread.proposal?.employeeName, `not Remy Calder's card:\n${reply.content}`).toBe("Remy Calder");
    },
  },
  {
    id: "nov6-last-first-ai-fallback-comma-not-a-name",
    title: '"Remy Calder, my opener, was late, again …": the card stays Remy Calder\'s (a comma that is not a name)',
    report: `${AUDIT}; never-break guard`,
    status: "fixed",
    fixFlags: FIX,
    async run(t) {
      const thread = start(t, [ODILE]);
      const reply = await thread.say("Remy Calder, my opener, was late, again on the 2nd at Kearney. Please create a CA form");
      expect(thread.proposal?.employeeName, `not Remy Calder's card:\n${reply.content}`).toBe("Remy Calder");
    },
  },
];
