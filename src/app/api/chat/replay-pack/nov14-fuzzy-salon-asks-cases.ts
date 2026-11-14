import { expect, vi } from "vitest";

import { STAFF, type ReplayCase, type ReplayContext } from "./cases";

/**
 * ============================================================================
 * FUZZY_SALON_ASKS — A SALON THE WORDS ONLY RESEMBLE IS ASKED, NOT FILED (QA's Sunny 38h live check, 14 Nov 2026)
 * ============================================================================
 *
 * Live, Admin covering every salon, a person not on the roster (QA's control run: the same with PLACE_STRIP off, so
 * pre-existing):
 *   "create a ca for <A> at omaha west, she was late" → card Salon NE Omaha Pacific (loc-0410), resolved, no question.
 *   "create a ca for <A>, she was late because she was at lincoln high" → NE Lincoln Pine Lake (loc-0312), resolved.
 * And both replies said "Your account covers every salon, so this form won't name one." against their own card.
 * With FUZZY_SALON_ASKS_ENABLED a salon only a resemblance reader supplied is asked ("I read … as … — is that the
 * salon?"), and the reply's salon line agrees with the card. The sibling app's #881, ported as a mechanism.
 * Invented person.
 */
const FLAG = "FUZZY_SALON_ASKS_ENABLED";
const REPORT = "QA's Sunny 38h live check, 14 Nov 2026 (Admin, all areas, off-roster person); invented person";
const EVERY_SALON = { level: "global", primaryAreaId: null, alsoCoversAreaIds: [] };
const OMAHA_PACIFIC = "loc-0410";
const LINCOLN_PINE_LAKE = "loc-0312";
const KEARNEY = "loc-0309";

interface Card {
  readonly locationId?: string | null;
  readonly locationResolution?: string;
  readonly payrollDeduct?: string | null;
}

async function say(t: ReplayContext, turns: readonly string[]) {
  vi.setSystemTime(new Date("2026-11-14T15:00:00Z"));
  t.directory([...STAFF]);
  t.as("admin", EVERY_SALON);
  const thread = t.thread();
  let reply = "";
  for (const turn of turns) reply = (await thread.say(turn)).content;
  const card = (thread.proposal as Card | null) ?? {};
  return { reply, locationId: card.locationId ?? null, resolution: card.locationResolution ?? null, payroll: card.payrollDeduct ?? null };
}

/** The card's Salon and the reply's salon line agree. */
function expectSalonLineAgrees(reply: string, locationId: string | null) {
  if (locationId) expect(reply, `the card names ${locationId}, the reply says it won't name one:\n${reply}`).not.toMatch(/won't name one/i);
}

export const NOV14_FUZZY_SALON_ASKS_CASES: ReplayCase[] = [
  {
    id: "nov14-fuzzy-salon-asks-omaha-west",
    title: `Admin: "create a ca for tavia quellan at omaha west, she was late" — asks whether NE Omaha Pacific is the salon`,
    report: REPORT,
    status: { open: "\"omaha west\" is filed as NE Omaha Pacific, unasked" },
    fixFlags: [FLAG],
    async run(t: ReplayContext) {
      const { reply, locationId } = await say(t, ["create a ca for tavia quellan at omaha west, she was late"]);
      expect(locationId, `"omaha west" was filed without asking:\n${reply}`).not.toBe(OMAHA_PACIFIC);
      expect(reply).toMatch(/I read \*\*omaha west\*\* as \*\*NE Omaha Pacific\*\* — is that the salon\?/);
      expectSalonLineAgrees(reply, locationId);
    },
  },
  {
    id: "nov14-fuzzy-salon-asks-lincoln-high",
    title: `Admin: "create a ca for tavia quellan, she was late because she was at lincoln high" — not filed at Lincoln Pine Lake unasked`,
    report: REPORT,
    status: { open: "\"lincoln\" alone is filed as NE Lincoln Pine Lake, unasked" },
    fixFlags: [FLAG],
    async run(t: ReplayContext) {
      const { reply, locationId } = await say(t, ["create a ca for tavia quellan, she was late because she was at lincoln high"]);
      expect(locationId, `"lincoln high" was filed without asking:\n${reply}`).not.toBe(LINCOLN_PINE_LAKE);
      expectSalonLineAgrees(reply, locationId);
      expect(reply, `the account lost the words:\n${reply}`).toMatch(/because she was at lincoln high/i);
    },
  },
  {
    id: "nov14-fuzzy-salon-asks-yes-files-it",
    title: `Admin: "… at omaha west, she was late", then "yes" — filed at NE Omaha Pacific, and the reply agrees`,
    report: REPORT,
    // A guard: in production the card is already at NE Omaha Pacific (unasked); with the flag, "yes" to the question files it.
    status: "fixed",
    fixFlags: [FLAG],
    async run(t: ReplayContext) {
      const { reply, locationId, resolution } = await say(t, ["create a ca for tavia quellan at omaha west, she was late", "yes"]);
      expect(locationId, `"yes" did not file the salon asked about:\n${reply}`).toBe(OMAHA_PACIFIC);
      expect(resolution).toBe("resolved");
      expectSalonLineAgrees(reply, locationId);
    },
  },
  // QA's further 38h live cases: a single-salon city inside a longer place is filed as that salon, unasked.
  ...([
    { key: "kearney-high", turn: "create a ca for tavia quellan at kearney high, she was late", typed: "kearney high" },
    { key: "kearney-mall", turn: "create a ca for tavia quellan at the kearney mall, she was late", typed: "the kearney mall" },
    { key: "because-kearney-high", turn: "create a ca for tavia quellan, she was late because she was at kearney high of all places", typed: "kearney high" },
  ] as const).map(({ key, turn, typed }): ReplayCase => ({
    id: `nov14-fuzzy-salon-asks-${key}`,
    title: `Admin: "${turn}" — asks whether NE Kearney is the salon`,
    report: REPORT,
    status: { open: "the city inside a longer place is filed as NE Kearney, unasked" },
    fixFlags: [FLAG],
    async run(t: ReplayContext) {
      const { reply, locationId } = await say(t, [turn]);
      expect(locationId, `"${typed}" was filed without asking:\n${reply}`).not.toBe(KEARNEY);
      expect(reply).toContain(`I read **${typed}** as **NE Kearney** — is that the salon?`);
      expectSalonLineAgrees(reply, locationId);
    },
  })),
  // QA's ruling (14 Nov 2026): a bare "yes" never answers two questions, least of all payroll deduct. The salon
  // confirm is the only question in its reply; payroll waits and is asked next.
  {
    id: "nov14-fuzzy-salon-asks-yes-is-not-payroll",
    title: `Admin: "… at omaha west, she was late", then "yes" — the salon is filed, payroll deduct is still unanswered and asked`,
    report: `${REPORT}; QA's one-question ruling`,
    status: { open: "the salon question shares its reply with the payroll question, and \"yes\" answers payroll" },
    fixFlags: [FLAG],
    async run(t: ReplayContext) {
      const first = await say(t, ["create a ca for tavia quellan at omaha west, she was late"]);
      expect(first.reply, `the salon question is not the only question:\n${first.reply}`).not.toMatch(/payroll deduct applicable\?/i);
      const { reply, locationId, payroll } = await say(t, ["create a ca for tavia quellan at omaha west, she was late", "yes"]);
      expect(locationId, `"yes" did not file the salon asked about:\n${reply}`).toBe(OMAHA_PACIFIC);
      expect(payroll, `"yes" answered payroll deduct:\n${reply}`).toBeNull();
      expect(reply, `payroll deduct was not asked next:\n${reply}`).toMatch(/payroll deduct applicable\?/i);
    },
  },
];

/** Guards, flag off and on: a salon the manager named — whole, short, or a letter off — is filed with no question. */
const NAMED: readonly { key: string; turn: string; salon: string }[] = [
  { key: "omaha-pacific", turn: "create a ca for tavia quellan at omaha pacific, she was late", salon: OMAHA_PACIFIC },
  { key: "omaha-pacfic", turn: "create a ca for tavia quellan at omaha pacfic, she was late", salon: OMAHA_PACIFIC },
  { key: "lincoln-pine-lake", turn: "create a ca for tavia quellan at lincoln pine lake, she was late", salon: LINCOLN_PINE_LAKE },
  { key: "kearney", turn: "create a ca for tavia quellan at kearney, she was late", salon: KEARNEY },
  { key: "the-kearney-salon", turn: "create a ca for tavia quellan at the kearney salon, she was late", salon: KEARNEY },
];

export const NOV14_FUZZY_SALON_ASKS_GUARDS: ReplayCase[] = NAMED.map((wording) => ({
  id: `nov14-fuzzy-salon-asks-guard-${wording.key}`,
  title: `Admin: "${wording.turn}" — filed at the salon named, not asked`,
  report: REPORT,
  status: "fixed",
  fixFlags: [FLAG],
  async run(t: ReplayContext) {
    const { reply, locationId } = await say(t, [wording.turn]);
    expect(locationId, `the salon named was not filed:\n${reply}`).toBe(wording.salon);
    expect(reply).not.toMatch(/is that the salon\?/);
  },
}));
