import { expect, vi } from "vitest";

import { STAFF, type ReplayCase, type ReplayContext } from "./cases";

/**
 * ============================================================================
 * A SHARED CITY TYPED A LETTER OFF ASKS WHICH SALON; "<A> AT <PLACE>" IS NEVER THE OBSERVATION (QA, Sunny 38c, 13 Nov)
 * ============================================================================
 *
 * QA's Sunny 38c live check, item 6, as an Admin (covers every salon): "create a ca for <A> at omha, she was late" gave
 * no salon question, Salon "Not recorded — your account covers every salon", and the Observation of Offense "<A> at
 * omha, she was late". On Sunny main 5d9f1767: the exact "at omaha" keeps the Observation to "she was late", but an
 * Admin's card is filed at the employee's own salon (the directory's) instead of asking which Omaha salon; "omha" reads
 * no place at all, so no question, and "<A> at omha" stays in the Observation, as an Admin and as a salon director
 * covering two Omaha salons. Tester's wording; the person is invented.
 */
const FLAG = "SHARED_CITY_ASKS_SALON_ENABLED";
const REPORT = "QA's Sunny 38c live check, item 6 (13 Nov 2026), tester's wording, invented person";
const EVERY_SALON = { level: "global", primaryAreaId: null, alsoCoversAreaIds: [] };
const TWO_OMAHA = { level: "salon", primaryAreaId: "loc-0313", alsoCoversAreaIds: ["loc-0410"] };

type Card = { status?: string; locationId?: string | null } | null;

async function say(t: ReplayContext, role: string, scope: unknown, turn: string) {
  vi.setSystemTime(new Date("2026-11-13T15:00:00Z"));
  t.directory([...STAFF]);
  t.as(role, scope);
  const thread = t.thread();
  const reply = (await thread.say(turn)).content;
  return { reply, card: thread.proposal as Card };
}

function observation(reply: string): string {
  return /\*\*Observation of Offense:\*\*\s*([^\n]*)/i.exec(reply)?.[1]?.trim() ?? "";
}

function asksSalonAndCleanObservation(reply: string, card: Card) {
  expect(card?.locationId ?? null, `a salon was filed without asking: ${JSON.stringify(card)}\n${reply}`).toBeNull();
  expect(card?.status, `the card does not wait for the salon:\n${reply}`).toBe("needs_location");
  const said = observation(reply);
  expect(said, `the place leaked into the Observation:\n${reply}`).not.toMatch(/\bomh?aha?\b/i);
  expect(said, `the employee's name leaked into the Observation:\n${reply}`).not.toMatch(/marnie|holloway/i);
}

export const NOV13_SHARED_CITY_ASKS_SALON_CASES: ReplayCase[] = [
  {
    id: "nov13-shared-city-omha-admin-asks-salon",
    title: `Admin: "create a ca for marnie holloway at omha, she was late" — asks which Omaha salon; the Observation is the account`,
    report: REPORT,
    // Changed on purpose (13 Nov 2026): fixed in production by SHARED_CITY_ASKS_SALON_ENABLED, QA round 38d. Was OPEN.
    status: "fixed",
    fixFlags: [FLAG],
    async run(t: ReplayContext) {
      const { reply, card } = await say(t, "admin", EVERY_SALON, "create a ca for marnie holloway at omha, she was late");
      asksSalonAndCleanObservation(reply, card);
    },
  },
  {
    id: "nov13-shared-city-omha-two-salons-asks-salon",
    title: `Salon director over two Omaha salons: "create a ca for marnie holloway at omha, she was late" — asks which`,
    report: `${REPORT}; QA's question (2)`,
    // Changed on purpose (13 Nov 2026): fixed in production by SHARED_CITY_ASKS_SALON_ENABLED, QA round 38d. Was OPEN.
    status: "fixed",
    fixFlags: [FLAG],
    async run(t: ReplayContext) {
      const { reply, card } = await say(t, "salon_director", TWO_OMAHA, "create a ca for marnie holloway at omha, she was late");
      asksSalonAndCleanObservation(reply, card);
    },
  },
  {
    /*
     * QA's question (1): with the exact "at omaha" the Observation is the account, but an Admin's card is filed at the
     * employee's own salon (Kearney, from the directory) without asking which Omaha salon: pre-existing on main, and
     * the same bug as "omha" once the city is read.
     */
    id: "nov13-shared-city-omaha-admin-asks-salon",
    title: `Admin: "create a ca for marnie holloway at omaha, she was late" — asks which Omaha salon, not the employee's own`,
    report: `${REPORT}; QA's question (1)`,
    // Changed on purpose (13 Nov 2026): fixed in production by SHARED_CITY_ASKS_SALON_ENABLED, QA round 38d. Was OPEN.
    status: "fixed",
    fixFlags: [FLAG],
    async run(t: ReplayContext) {
      const { reply, card } = await say(t, "admin", EVERY_SALON, "create a ca for marnie holloway at omaha, she was late");
      asksSalonAndCleanObservation(reply, card);
    },
  },
];

/*
 * Gate-Sunny's #933 probes (13 Nov 2026), QA's ruling: "Losing account details is never acceptable." Only a place the
 * salon reader reads (a salon, a shared city or its close spelling) leaves the Observation; any other "at/in …" is the
 * account and is kept word for word. Guards: they hold on production's flags and with the flag.
 */
const MUST_KEEP: readonly { key: string; turn: string; kept: string }[] = [
  { key: "front-desk", turn: "create a ca for marnie holloway at the front desk, she was rude to a guest", kept: "at the front desk" },
  { key: "back-room", turn: "create a ca for marnie holloway in the back room, she was on her phone", kept: "in the back room" },
  { key: "at-close", turn: "create a ca for marnie holloway at close, she skipped the beds", kept: "at close" },
];

export const NOV13_SHARED_CITY_MUST_KEEP_CASES: ReplayCase[] = MUST_KEEP.map((wording) => ({
  id: `nov13-shared-city-observation-keeps-${wording.key}`,
  title: `"${wording.turn}" — the Observation keeps "${wording.kept}" (not a salon)`,
  report: `Gate-Sunny's #933 probes, QA's ruling (13 Nov 2026): account details are never lost`,
  status: "fixed",
  async run(t: ReplayContext) {
    const { reply } = await say(t, "admin", EVERY_SALON, wording.turn);
    expect(observation(reply), `"${wording.kept}" was lost from the Observation:\n${reply}`).toContain(wording.kept);
  },
}));

/*
 * Gate-Sunny's residuals: a trailing typo city stays in the Observation while the exact city is taken out ("she was late
 * in omha", "at the omha store"); and "kansas cty" was not read, because "city" had to be exact. With the flag the close
 * spelling is the exact city's twin: the salon is asked and the place leaves the account.
 */
const TRAILING: readonly { key: string; turn: string; place: RegExp }[] = [
  { key: "late-in-omha", turn: "create a ca for marnie holloway, she was late in omha", place: /\bomha\b/i },
  { key: "at-the-omha-store", turn: "create a ca for marnie holloway, she was late at the omha store", place: /\bomha\b/i },
  { key: "kansas-cty", turn: "create a ca for marnie holloway at kansas cty, she was late", place: /\bkansas\b|\bcty\b/i },
];

export const NOV13_SHARED_CITY_TRAILING_CASES: ReplayCase[] = TRAILING.map((wording) => ({
  id: `nov13-shared-city-${wording.key}-asks-salon`,
  title: `Admin: "${wording.turn}" — asks which salon; the typo city leaves the Observation like the exact city`,
  report: `Gate-Sunny's #933 probes, residuals (13 Nov 2026)`,
  // Changed on purpose (13 Nov 2026): fixed in production by SHARED_CITY_ASKS_SALON_ENABLED, QA round 38d. Was OPEN.
  status: "fixed",
  fixFlags: [FLAG],
  async run(t: ReplayContext) {
    const { reply, card } = await say(t, "admin", EVERY_SALON, wording.turn);
    expect(card?.locationId ?? null, `a salon was filed without asking: ${JSON.stringify(card)}\n${reply}`).toBeNull();
    expect(observation(reply), `the place stayed in the Observation:\n${reply}`).not.toMatch(wording.place);
    expect(observation(reply), `the account was lost:\n${reply}`).toMatch(/\blate\b/);
  },
}));
