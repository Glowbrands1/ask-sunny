import { expect, vi } from "vitest";

import { STAFF, type ReplayCase, type ReplayContext } from "./cases";

/**
 * ============================================================================
 * REASON_PLACE_NEVER_SALON — "BECAUSE SHE WAS AT KEARNEY" IS NEVER THE SALON FOR THE AI READER EITHER (QA, 14 Nov 2026)
 * ============================================================================
 *
 * Ported from the sibling app's 17z live bug (QA): there the tester's "write a CA for <A>, she was late because she was
 * at kearney" was filed at that place, because the AI reader (AI_READS_CODE_CHECKS) read "kearney" as the location and
 * the merge filed it; the reason-place readers never saw that path. Here, on main af04c58c with REASON_PLACE_NOT_SALON on,
 * the same happens once the replay's reader reads the place as the live one does (`readerReads`): NE Kearney, resolved.
 * The account keeps the words here (no alias rewrite). Invented person.
 */
const FLAG = "REASON_PLACE_NEVER_SALON_ENABLED";
const REPORT = "Ported from the sibling app's 17z live bug (QA, 14 Nov 2026), the tester's wording; invented person";
const KEARNEY = "loc-0309";

async function cardFor(t: ReplayContext, turn: string) {
  vi.setSystemTime(new Date("2026-11-14T15:00:00Z"));
  t.directory([...STAFF]);
  t.as("admin", { level: "global", primaryAreaId: null, alsoCoversAreaIds: [] });
  t.readerReads({ location: "kearney" });
  const thread = t.thread();
  const reply = (await thread.say(turn)).content;
  return {
    reply,
    locationId: (thread.proposal as { locationId?: string | null } | null)?.locationId ?? null,
    issue: /^\*\*Observation of Offense:\*\* ([^\n]*)$/m.exec(reply)?.[1] ?? "",
  };
}

const TURN = "write a CA for tavia quellan, she was late because she was at kearney";

export const NOV14_REASON_PLACE_NEVER_SALON_CASES: ReplayCase[] = [
  {
    id: "nov14-reason-place-never-salon-kearney",
    title: `Admin: "${TURN}" — not filed at NE Kearney`,
    report: REPORT,
    status: { open: "the AI reader's location files the reason's place as NE Kearney" },
    fixFlags: [FLAG],
    async run(t: ReplayContext) {
      const { reply, locationId } = await cardFor(t, TURN);
      expect(locationId, `the reason's place was filed as the salon:\n${reply}`).not.toBe(KEARNEY);
    },
  },
  {
    id: "nov14-reason-place-never-salon-issue-as-typed",
    title: `Admin: "${TURN}" — the Observation keeps "because she was at kearney" as typed`,
    report: REPORT,
    // A guard here: this app never rewrote the account (the sibling app's alias pass did).
    status: "fixed",
    fixFlags: [FLAG],
    async run(t: ReplayContext) {
      const { reply, issue } = await cardFor(t, TURN);
      expect(issue, `the manager's words were rewritten:\n${reply}`).toBe("she was late because she was at kearney");
    },
  },
];

/** Guards, flag off and on: a salon said as the salon is still filed. */
export const NOV14_REASON_PLACE_NEVER_SALON_GUARDS: ReplayCase[] = [
  { key: "late-at-kearney", turn: "write a CA for tavia quellan, she was late at kearney" },
  { key: "at-the-kearney-salon", turn: "write a CA for tavia quellan at the kearney salon, she was late" },
].map((wording) => ({
  id: `nov14-reason-place-never-salon-guard-${wording.key}`,
  title: `Admin: "${wording.turn}" — filed at NE Kearney`,
  report: REPORT,
  status: "fixed",
  fixFlags: [FLAG],
  async run(t: ReplayContext) {
    const { reply, locationId } = await cardFor(t, wording.turn);
    expect(locationId, `the salon was not filed:\n${reply}`).toBe(KEARNEY);
  },
}));

/*
 * QA (14 Nov 2026): the Grand Island wording that passed live, run on the reader path too (the reader reads "grand
 * island" as the location). Open on production flags: the reader's location files the reason's place.
 */
export const NOV14_REASON_PLACE_NEVER_SALON_GRAND_ISLAND: ReplayCase[] = [
  {
    id: "nov14-reason-place-never-salon-grand-island-reader",
    title: `Admin: "create a ca for tavia quellan, she was late because she was at grand island" (the reader reads "grand island") — not filed at Grand Island`,
    report: "QA's check of the Sunny live pass on the reader path, 14 Nov 2026; invented person",
    status: { open: "the AI reader's location files the reason's place as the Grand Island salon" },
    fixFlags: [FLAG],
    async run(t: ReplayContext) {
      vi.setSystemTime(new Date("2026-11-14T15:00:00Z"));
      t.directory([...STAFF]);
      t.as("admin", { level: "global", primaryAreaId: null, alsoCoversAreaIds: [] });
      t.readerReads({ location: "grand island" });
      const thread = t.thread();
      const reply = (await thread.say("create a ca for tavia quellan, she was late because she was at grand island")).content;
      const locationId = (thread.proposal as { locationId?: string | null } | null)?.locationId ?? null;
      expect(locationId, `the reason's place was filed as the salon:\n${reply}`).not.toBe("loc-0307");
    },
  },
];
