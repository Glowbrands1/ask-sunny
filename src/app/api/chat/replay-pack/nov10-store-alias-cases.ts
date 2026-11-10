import { expect, vi } from "vitest";

import { STAFF, type ReplayCase, type ReplayContext } from "./cases";

/**
 * ============================================================================
 * A SALON NAMED THE MANAGERS' WAY ("o st") IS READ AS ITS ROSTER NAME (October rebuild 5, #254, 10 Nov 2026)
 * ============================================================================
 *
 * conv_mvoehonm2pfrkng (25 Oct 2026; #254, never merged): "test testy, location o st, today's date, on 9-20-26 test
 * was 10 minutes late clocking in, this is a verbal, test is a tc" — "o st" was not NE Lincoln O Street. QA's October
 * triage (docs/parity-log/oct-pr-triage.md, 10 Nov 2026), with production's flags: no salon is read from it. The
 * manager's words ("test testy" is the manager's own placeholder).
 */
const FLAG = "STORE_ALIAS_ENABLED";
const REPORTED = "test testy, location o st, today's date, on 9-20-26 test was 10 minutes late clocking in, this is a verbal, test is a tc";
const REPORT = "conv_mvoehonm2pfrkng (25 Oct 2026, #254; the October triage, 10 Nov 2026)";

function start(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-10-25T15:00:00Z"));
  t.directory([...STAFF]);
  t.as("admin", { level: "global", primaryAreaId: null, alsoCoversAreaIds: [] });
  return t.thread();
}

const card = (thread: { proposal: unknown }) => thread.proposal as { locationId?: string | null } | null;
const O_STREET = "loc-0311";

const FIRST = "create a ca for kira dunmore, she was late today";

export const NOV10_STORE_ALIAS_CASES: ReplayCase[] = [
  ...([
    ["lower", REPORTED],
    ["sentence", REPORTED[0]!.toUpperCase() + REPORTED.slice(1)],
  ] as const).map(([casing, text]) => ({
    id: `nov10-store-alias-location-o-st-${casing}`,
    title: `"${text}" after a CA request — the card's salon is NE Lincoln O Street`,
    report: `${REPORT}; ${casing}`,
    // Holds with production's flags on main ccfbe214 (10 Nov 2026): the card resolves O Street here. A guard.
    status: "fixed" as const,
    async run(t: ReplayContext) {
      const thread = start(t);
      await thread.say("create a corrective action form");
      const reply = await thread.say(text);
      expect(card(thread)?.locationId ?? null, `the card's salon:\n${reply.content}`).toBe(O_STREET);
    },
  })),
  /*
   * QA, 26 Oct 2026 (#254's end-to-end test): a bare "o st" typed after the request names no salon. On main ccfbe214
   * "132nd and maple", "the location is o st", "st joe", "kearney, ne" and "lawrence ks" already set it; "o st" does not.
   */
  ...(["o st", "O st", "O ST"] as const).map((bare) => ({
    id: `nov10-store-alias-bare-${bare.replace(/\s+/g, "-")}`,
    title: `"${FIRST}" then "${bare}" — the card's salon is NE Lincoln O Street, and "${bare}" is never the account`,
    report: `QA, 26 Oct 2026 (#254): a bare "${bare}" after the request`,
    status: { open: `a bare "${bare}" names no salon` },
    fixFlags: [FLAG],
    // The read step is wired in server-ask.ts (coding 2): it holds with the fix flag, so the fixStatus goes.
    async run(t: ReplayContext) {
      const thread = start(t);
      await thread.say(FIRST);
      const reply = await thread.say(bare);
      expect(card(thread)?.locationId ?? null, `the card's salon:\n${reply.content}`).toBe(O_STREET);
      expect(reply.content, "the salon reply was read as the account").not.toMatch(/\*\*Observation of Offense:\*\*\s*o st\b/i);
    },
  })),
];
