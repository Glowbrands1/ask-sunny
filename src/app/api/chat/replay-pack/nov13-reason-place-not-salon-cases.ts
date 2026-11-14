import { expect, vi } from "vitest";

import { STAFF, type ReplayCase, type ReplayContext } from "./cases";

/**
 * ============================================================================
 * REASON_PLACE_NOT_SALON — WHERE SHE WAS IS WHY SHE WAS LATE, NOT THE SALON (ported from the sibling app, 13 Nov 2026)
 * ============================================================================
 *
 * The sibling app's Gate-Bubbles-3 (#869 probes, 13 Nov 2026): "ca for <A>, she was late on 11/1/26 because she was at
 * <place>" filed the form at the place she was. The same here (Sunny main 0f6b802f): "create a ca for marnie holloway,
 * she was late because she was at grand island" is filed at the Grand Island salon. A place in a "because she was at
 * …" reason is why she was late, not where the form is filed: with REASON_PLACE_NOT_SALON_ENABLED it is not read as a
 * salon. The account keeps the words. Invented people.
 */
const FLAG = "REASON_PLACE_NOT_SALON_ENABLED";
const REPORT = "Ported from the sibling app (Gate-Bubbles-3's #869 probes, 13 Nov 2026); invented people";
const EVERY_SALON = { level: "global", primaryAreaId: null, alsoCoversAreaIds: [] };
const GRAND_ISLAND = "loc-0307";
const LINCOLN_PINE_LAKE = "loc-0312";
const KEARNEY = "loc-0309";

async function cardFor(t: ReplayContext, turn: string) {
  vi.setSystemTime(new Date("2026-11-13T15:00:00Z"));
  t.directory([...STAFF]);
  t.as("admin", EVERY_SALON);
  const thread = t.thread();
  const reply = (await thread.say(turn)).content;
  return { reply, locationId: (thread.proposal as { locationId?: string | null } | null)?.locationId ?? null };
}

/** QA's Sunny 38h live check: a card that names a salon is never next to "this form won't name one". */
function expectSalonLineAgrees(reply: string, locationId: string | null) {
  if (locationId) expect(reply, `the card names ${locationId}, the reply says it won't name one:\n${reply}`).not.toMatch(/won't name one/i);
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
  // QA's Sunny 38h live check (Admin, all areas, a person not on the roster): "lincoln" in the reason was read as
  // NE Lincoln Pine Lake (loc-0312), resolved, by the card's partial-name fallback, with no question, while the reply
  // said "Your account covers every salon, so this form won't name one." Invented person.
  {
    id: "nov14-reason-place-not-salon-lincoln-high",
    title: `Admin: "create a ca for tavia quellan, she was late because she was at lincoln high" — not filed at Lincoln Pine Lake`,
    report: "QA's Sunny 38h live check, 14 Nov 2026; invented person",
    status: { open: "\"lincoln\" in the reason is read as NE Lincoln Pine Lake" },
    fixFlags: [FLAG],
    async run(t: ReplayContext) {
      const { reply, locationId } = await cardFor(t, "create a ca for tavia quellan, she was late because she was at lincoln high");
      expect(locationId, `a salon was read from the reason:\n${reply}`).not.toBe(LINCOLN_PINE_LAKE);
      expectSalonLineAgrees(reply, locationId);
      expect(reply, `the account lost the words:\n${reply}`).toMatch(/because she was at lincoln high/i);
    },
  },
  // QA's further Sunny 38h live cases (PLACE_STRIP on, Admin all areas, off-roster person): a city inside the reason's
  // longer place ("kearney high", "the kearney mall") was filed as that city's salon, unasked. Invented person.
  ...([
    { key: "kearney-high", place: "kearney high of all places", salon: KEARNEY },
    { key: "kearney-mall", place: "the kearney mall of all places", salon: KEARNEY },
    { key: "lincoln-high-of-all-places", place: "lincoln high of all places", salon: LINCOLN_PINE_LAKE },
  ] as const).map(({ key, place, salon }): ReplayCase => ({
    id: `nov14-reason-place-not-salon-${key}`,
    title: `Admin: "create a ca for tavia quellan, she was late because she was at ${place}" — no salon read from the reason`,
    report: "QA's Sunny 38h live check, 14 Nov 2026; invented person",
    status: { open: "the city in the reason's place is read as its salon" },
    fixFlags: [FLAG],
    async run(t: ReplayContext) {
      const { reply, locationId } = await cardFor(t, `create a ca for tavia quellan, she was late because she was at ${place}`);
      expect(locationId, `a salon was read from the reason:\n${reply}`).not.toBe(salon);
      expectSalonLineAgrees(reply, locationId);
    },
  })),
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

/** Guards, flag off and on: the whole salon name said as the salon is still read through the same fallback. */
const MUST_READ_LINCOLN: readonly { key: string; turn: string }[] = [
  { key: "at-lincoln-pine-lake", turn: "create a ca for tavia quellan at lincoln pine lake, she was late" },
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

export const NOV14_REASON_PLACE_LINCOLN_GUARDS: ReplayCase[] = MUST_READ_LINCOLN.map((wording) => ({
  id: `nov14-reason-place-not-salon-guard-${wording.key}`,
  title: `Admin: "${wording.turn}" — the salon is still read`,
  report: "QA's Sunny 38h live check, 14 Nov 2026; invented person",
  status: "fixed",
  fixFlags: [FLAG],
  async run(t: ReplayContext) {
    const { reply, locationId } = await cardFor(t, wording.turn);
    expect(locationId, `the salon was not read:\n${reply}`).toBe(LINCOLN_PINE_LAKE);
  },
}));
