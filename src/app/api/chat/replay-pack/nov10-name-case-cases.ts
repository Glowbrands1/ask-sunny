import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";

/**
 * ============================================================================
 * A NAME IS READ THE SAME HOWEVER IT IS TYPED (October rebuild 3, #270, 10 Nov 2026)
 * ============================================================================
 *
 * #270 (NAME_CASE_INSENSITIVE, never merged; the sibling's #202). QA's October triage (docs/parity-log/oct-pr-triage.md, 10 Nov 2026),
 * with production's flags, a name not in the directory: "write up devon harlan for opening the salon late today" and
 * the same turn in capitals get "Who is this Corrective Action Form for?" with no employee, while sentence case reads
 * "Devon Harlan"; "create a ca for devon harlan, late today" puts "devon harlan" (lowercase) on the card.
 *
 * The triage's words; "Devon Harlan" is invented and on no directory.
 */
const FLAG = "NAME_CASE_INSENSITIVE_ENABLED";
const REPORT = "#270 / the sibling's #202 (QA's October triage, 10 Nov 2026, a name not in the directory)";

function start(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-10-26T15:00:00Z"));
  t.directory([...STAFF]);
  t.as("salon_director", KEARNEY);
  return t.thread();
}

const WRITE_UP = "write up devon harlan for opening the salon late today";

export const NOV10_NAME_CASE_CASES: ReplayCase[] = [
  ...([
    ["lower", WRITE_UP],
    ["caps", WRITE_UP.toUpperCase()],
  ] as const).map(([casing, text]) => ({
    id: `nov10-name-case-write-up-${casing}`,
    title: `"${text}" — read like "Write up Devon Harlan …": the card is for Devon Harlan, never "Who is this … for?"`,
    report: `${REPORT}: "${text}" got "Who is this Corrective Action Form for?" with no employee`,
    status: { open: "a lowercase or capitals name is not read: \"Who is this Corrective Action Form for?\" and no employee" },
    fixFlags: [FLAG],
    // The read and card steps are wired in server-ask.ts (coding 2): they hold with the fix flag, so the fixStatus goes.
    async run(t: ReplayContext) {
      const thread = start(t);
      const sentence = await thread.say("Write up Devon Harlan for opening the salon late today");
      const read = thread.proposal?.employeeName ?? null;
      expect(read, `sentence case reads no name:\n${sentence.content}`).toBe("Devon Harlan");
      const other = start(t);
      const reply = await other.say(text);
      expect(other.proposal?.employeeName ?? null, `"${text}" is read differently from sentence case:\n${reply.content}`).toBe(read);
    },
  })),
  {
    id: "nov10-name-case-lowercase-on-card",
    title: "\"create a ca for devon harlan, late today\" — the name is \"Devon Harlan\" on the card or in the off-roster question, never \"devon harlan\"",
    report: `${REPORT}: "create a ca for devon harlan, late today" put "devon harlan" (lowercase) on the card`,
    // Holds with production's flags on main ccfbe214 (10 Nov 2026): the name is shown
    // "Devon Harlan" in the off-roster question here. A guard.
    status: "fixed",
    async run(t: ReplayContext) {
      const thread = start(t);
      const reply = await thread.say("create a ca for devon harlan, late today");
      // Off the directory this app may ask first (OFF_ROSTER_ASK_BEFORE_CARD); either way the name is "Devon Harlan".
      expect(thread.proposal?.employeeName ?? "Devon Harlan", `the card's employee:\n${reply.content}`).toBe("Devon Harlan");
      expect(reply.content, `the name is shown as typed, in lowercase:\n${reply.content}`).not.toMatch(/\*\*devon harlan\*\*/);
      expect(reply.content, "the name is not shown at all").toMatch(/Devon Harlan/);
    },
  },
];
