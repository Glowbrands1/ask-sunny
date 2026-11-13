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
    status: { open: `"omha" is not read: no salon question, and "marnie holloway at omha" is the Observation` },
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
    status: { open: `"omha" is not read: no salon question, and "marnie holloway at omha" is the Observation` },
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
    status: { open: "the card is filed at the employee's own salon (Kearney), not asked among the Omaha salons the manager named" },
    fixFlags: [FLAG],
    async run(t: ReplayContext) {
      const { reply, card } = await say(t, "admin", EVERY_SALON, "create a ca for marnie holloway at omaha, she was late");
      asksSalonAndCleanObservation(reply, card);
    },
  },
];
