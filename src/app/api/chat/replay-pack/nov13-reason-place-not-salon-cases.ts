import { expect, vi } from "vitest";

import { STAFF, type ReplayCase, type ReplayContext } from "./cases";

/**
 * ============================================================================
 * REASON_PLACE_NOT_STORE — WHERE SHE WAS IS WHY SHE WAS LATE, NOT THE SALON (ported from the sibling app, 13 Nov 2026)
 * ============================================================================
 *
 * The sibling app's Gate-Bubbles-3 (#869 probes, 13 Nov 2026): "ca for <A>, she was late on 11/1/26 because she was at
 * <place>" filed the form at the place she was. The same here (Sunny main 0f6b802f): "create a ca for marnie holloway,
 * she was late because she was at grand island" is filed at the Grand Island salon. A place in a "because she was at
 * …" reason is why she was late, not where the form is filed: with REASON_PLACE_NOT_STORE_ENABLED it is not read as a
 * salon. The account keeps the words. Invented people.
 */
const FLAG = "REASON_PLACE_NOT_STORE_ENABLED";
const REPORT = "Ported from the sibling app (Gate-Bubbles-3's #869 probes, 13 Nov 2026); invented people";
const EVERY_SALON = { level: "global", primaryAreaId: null, alsoCoversAreaIds: [] };
const GRAND_ISLAND = "loc-0307";

async function cardFor(t: ReplayContext, turn: string) {
  vi.setSystemTime(new Date("2026-11-13T15:00:00Z"));
  t.directory([...STAFF]);
  t.as("admin", EVERY_SALON);
  const thread = t.thread();
  const reply = (await thread.say(turn)).content;
  return { reply, locationId: (thread.proposal as { locationId?: string | null } | null)?.locationId ?? null };
}

export const NOV13_REASON_PLACE_NOT_SALON_CASES: ReplayCase[] = [
  {
    id: "nov13-reason-place-not-salon-grand-island",
    title: `Admin: "create a ca for marnie holloway, she was late because she was at grand island" — not filed at Grand Island`,
    report: REPORT,
    status: { open: "the reason's place is read as the Grand Island salon" },
    fixFlags: [FLAG],
    async run(t: ReplayContext) {
      const { reply, locationId } = await cardFor(t, "create a ca for marnie holloway, she was late because she was at grand island");
      expect(locationId, `a salon was read from the reason:\n${reply}`).not.toBe(GRAND_ISLAND);
      expect(reply, `the account lost the words:\n${reply}`).toMatch(/because she was at grand island/i);
    },
  },
  // The sibling gate's probes: the same reason said "bc" or "since".
  ...(["bc", "since"] as const).map((why): ReplayCase => ({
    id: `nov13-reason-place-not-salon-grand-island-${why}`,
    title: `Admin: "create a ca for marnie holloway, she was late ${why} she was at grand island" — not filed at Grand Island`,
    report: `${REPORT}; the sibling gate's #879 probes`,
    status: { open: "the reason's place is read as the Grand Island salon" },
    fixFlags: [FLAG],
    async run(t: ReplayContext) {
      const { reply, locationId } = await cardFor(t, `create a ca for marnie holloway, she was late ${why} she was at grand island`);
      expect(locationId, `a salon was read from the reason:\n${reply}`).not.toBe(GRAND_ISLAND);
    },
  })),
];

/** Guards, flag off and on: a salon said as the salon is still read. */
const MUST_READ: readonly { key: string; turn: string }[] = [
  { key: "at-grand-island-comma", turn: "create a ca for marnie holloway at grand island, she was late" },
  { key: "late-at-grand-island", turn: "create a ca for marnie holloway, she was late at grand island on 11/1/26" },
];

export const NOV13_REASON_PLACE_NOT_SALON_GUARDS: ReplayCase[] = MUST_READ.map((wording) => ({
  id: `nov13-reason-place-not-salon-guard-${wording.key}`,
  title: `Admin: "${wording.turn}" — the salon is still read`,
  report: REPORT,
  status: "fixed",
  fixFlags: [FLAG],
  async run(t: ReplayContext) {
    const { reply, locationId } = await cardFor(t, wording.turn);
    expect(locationId, `the salon was not read:\n${reply}`).toBe(GRAND_ISLAND);
  },
}));
