import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase } from "./cases";

/**
 * ============================================================================
 * OCTOBER TRIAGE #1 — "WRITE UP <NAME>" IS READ IN ANY CASE (the sibling app's #202)
 * ============================================================================
 *
 * "write up <name> for opening the store late today" and the same turn in capitals got "Who is this **Corrective
 * Action Form** for?" with no employee; sentence case got a card. The wording is the triage table's (store → salon);
 * the person is invented and off the roster, where the gap is (on the roster every casing already reads).
 */

const SAID = "write up marisol pennick for opening the salon late today";
const CASINGS: { label: string; turn: string; open: boolean }[] = [
  { label: "lower case", turn: SAID, open: true },
  { label: "capitals", turn: SAID.toUpperCase(), open: true },
  { label: "sentence case", turn: "Write up Marisol Pennick for opening the salon late today", open: false },
];

export const WRITE_UP_NAME_ANY_CASE_FIX = "WRITE_UP_NAME_ANY_CASE_ENABLED";

export const NOV10_WRITE_UP_NAME_ANY_CASE_CASES: ReplayCase[] = CASINGS.map(({ label, turn, open }) => ({
  id: `nov10-write-up-name-any-case-${label.replace(/\s+/g, "-")}`,
  title: `#1: "${turn}" (${label}, off the roster) → a Corrective Action card for Marisol Pennick`,
  report: `October triage #1 (the sibling app's #202): "write up <name> for opening the store late today" and the same turn in capitals → "Who is this **Corrective Action Form** for?" with no employee`,
  ...(open
    ? { status: { open: "Who is this **Corrective Action Form** for?" }, fixFlags: [WRITE_UP_NAME_ANY_CASE_FIX] }
    : // Sentence case already holds with production's flags; kept as the guard that the flag changes nothing there.
      { status: "fixed" as const, fixFlags: [WRITE_UP_NAME_ANY_CASE_FIX] }),
  async run(t) {
    vi.setSystemTime(new Date("2026-10-26T15:00:00Z"));
    t.directory([...STAFF]);
    t.as("salon_director", KEARNEY);
    const thread = t.thread();
    const reply = await thread.say(turn);
    expect(reply.content).not.toMatch(/Who is this \*\*Corrective Action Form\*\* for\?/);
    expect(thread.proposal?.templateKey, reply.content).toBe("dpoa");
    expect(thread.proposal?.employeeName ?? null, reply.content).toBe("Marisol Pennick");
  },
}));
