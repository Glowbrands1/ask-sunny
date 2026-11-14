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
    // Open until 38j; REASON_PLACE_NOT_SALON (#975) is on in production since then, so a reason's place is never the
    // salon there: a guard now, flag off and on.
    status: "fixed",
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
  // The same in a "because" reason: since 38j (REASON_PLACE_NOT_SALON, #975, on in production) a reason's place is never
  // the salon, so nothing is filed and nothing is asked (QA's ruling). A guard: not filed at NE Kearney, the reply agrees.
  {
    id: "nov14-fuzzy-salon-asks-because-kearney-high",
    title: `Admin: "create a ca for tavia quellan, she was late because she was at kearney high of all places" — not filed at NE Kearney`,
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t: ReplayContext) {
      const { reply, locationId } = await say(t, ["create a ca for tavia quellan, she was late because she was at kearney high of all places"]);
      expect(locationId, `"kearney high" in the reason was filed:\n${reply}`).not.toBe(KEARNEY);
      expectSalonLineAgrees(reply, locationId);
    },
  },
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
  // Gate-Sunny's #977 probes (14 Nov 2026): a resemblance match outside the manager's assignment is never offered. The
  // gate's case, as given.
  {
    id: "nov14-fuzzy-salon-asks-not-off-assignment",
    title: `Single-salon SD: "create a ca for marnie holloway at omaha west, she was late" — never asks "is that the salon?" about a salon off the assignment`,
    report: "Gate-Sunny's #977 probes, 14 Nov 2026; invented person",
    // A guard, not an open case: with the flag off nothing asks (main's honest "isn't a salon on your assignment" line);
    // it was this PR's first head that asked.
    status: "fixed",
    fixFlags: [FLAG],
    async run(t: ReplayContext) {
      vi.setSystemTime(new Date("2026-11-14T15:00:00Z"));
      t.directory([...STAFF]);
      t.as("salon_director", { level: "salon", primaryAreaId: "loc-0313", alsoCoversAreaIds: [] });
      const thread = t.thread();
      const first = (await thread.say("create a ca for marnie holloway at omaha west, she was late")).content;
      expect(first, `offered a salon off the assignment:\n${first}`).not.toMatch(/is that the salon\?/i);
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

/**
 * A salon named in answer to the salon question is filed, not asked again (Gate-Sunny, #977 gate, 14 Nov 2026): the
 * priority replay's g7 ("Dodge") on production salons. Gate-Sunny's case; invented person, off-roster.
 */
const ANSWERS = [
  { key: "27th-street", answer: "27th street", salon: "loc-0310" },
  { key: "o-street", answer: "o street", salon: "loc-0311" },
  { key: "pine-lake", answer: "pine lake", salon: "loc-0312" }, // guard: already fine
];
export const NOV14_FUZZY_SALON_ASKS_ANSWER_CASES: ReplayCase[] = ANSWERS.map((w) => ({
  id: `nov14-fuzzy-salon-asks-answer-${w.key}`,
  title: `DM: "create a coaching form for kira dunmore", then "${w.answer}" — filed, not asked again`,
  report: "Gate-Sunny's #977 gate (14 Nov 2026), priority-replay g7 on production salons; invented person",
  // Guards, not open cases: with the flag off the answer is filed (production today); with the flag on it was asked
  // again before this fix (Gate-Sunny's probe: 27th street and o street failed, pine lake passed).
  status: "fixed",
  fixFlags: ["FUZZY_SALON_ASKS_ENABLED"],
  async run(t: ReplayContext) {
    vi.setSystemTime(new Date("2026-11-14T15:00:00Z"));
    t.directory([...STAFF]);
    t.as("district_manager", { level: "global", primaryAreaId: null, alsoCoversAreaIds: [] });
    const thread = t.thread();
    await thread.say("create a coaching form for kira dunmore");
    const { content } = await thread.say(w.answer);
    const p = thread.proposal as { locationId?: string | null } | null;
    expect(p?.locationId ?? null, `the salon answer was not filed:\n${content}`).toBe(w.salon);
    expect(content, `the salon was asked again:\n${content}`).not.toMatch(/is that the salon\?/);
  },
}));

/**
 * The priority replay's s5 with the flag on (Gate-Sunny, #977 gate): "works at lawrence as a tanning consultant. use
 * todays date" was read as the longer place "lawrence as a tanning consultant" (and "lawrence. use todays date"), and
 * the salon was asked about. A full stop and "as" end the place. Invented person, off-roster.
 */
const LAWRENCE_REQUEST = "create coaching form for kira dunmore, works at lawrence as a tanning consultant. use todays date";
export const NOV14_FUZZY_SALON_ASKS_PLACE_ENDS: ReplayCase[] = [
  [LAWRENCE_REQUEST],
  // s5's next turn, said after the request.
  [LAWRENCE_REQUEST, "kira dunmore, tanning consultant at lawrence. use todays date"],
].map((turns, index) => ({
  id: `nov14-fuzzy-salon-asks-place-ends-${index + 1}`,
  title: `DM: ${turns.map((turn) => `"${turn}"`).join(", then ")} — filed at KS Lawrence, not asked`,
  report: "Gate-Sunny's #977 gate (14 Nov 2026), priority-replay s5 with the flag on; invented person",
  status: "fixed",
  fixFlags: ["FUZZY_SALON_ASKS_ENABLED"],
  async run(t: ReplayContext) {
    vi.setSystemTime(new Date("2026-11-14T15:00:00Z"));
    t.directory([...STAFF]);
    t.as("district_manager", { level: "global", primaryAreaId: null, alsoCoversAreaIds: [] });
    const thread = t.thread();
    let content = "";
    for (const turn of turns) content = (await thread.say(turn)).content;
    const p = thread.proposal as { locationId?: string | null } | null;
    expect(p?.locationId ?? null, `the salon was not filed:\n${content}`).toBe("loc-0468");
    expect(content, `the salon was asked about:\n${content}`).not.toMatch(/is that the salon\?/);
  },
}));
