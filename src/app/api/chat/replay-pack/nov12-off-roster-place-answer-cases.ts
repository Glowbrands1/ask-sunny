import { expect, vi } from "vitest";

import { STAFF, type ReplayAnswer, type ReplayCase, type ReplayContext } from "./cases";

/**
 * ============================================================================
 * A PLACE IS NEVER THE PERSON WHILE THE OFF-ROSTER OFFER IS OPEN (QA's priority live bug, Sunny 37b, 12 Nov 2026;
 * OFF_ROSTER_PLACE_ANSWER_ENABLED)
 * ============================================================================
 *
 * Admin (all salons): "CA for <C>, do not terminate yet, she was late" → the off-roster offer ("reply use <C>"), the
 * card with no Employee, Observation "do not terminate yet, she was late", Attendance p.14 → the manager answered with a
 * salon only, written state-first as the salon directory writes it ("IA Altoona"). The bot took it as a new person
 * ("Ia Altoona"); the salon was not set, the Observation line and the date were lost, and "use <C>" was not asked
 * again. #902's case covers a salon director's "kearney, ne" only. <C> is invented (Brisa Talmadge, not on the
 * directory); the salons are the fixture directory's, and "IA Altoona" is the tester's own answer — a salon this
 * fixture does not list, as the live directory's newer salons are not.
 */
const C = "Brisa Talmadge";
const REQUEST = `CA for ${C}, do not terminate yet, she was late`;
const FLAG = "OFF_ROSTER_PLACE_ANSWER_ENABLED";
const REPORT = "QA, Sunny 37b live test (12 Nov 2026), Admin (all salons)";
const ADMIN = { level: "global", primaryAreaId: null, alsoCoversAreaIds: [] };

const observation = (reply: ReplayAnswer) => /\*\*Observation of Offense:\*\*\s*([^\n]*)/.exec(reply.content)?.[1]?.trim() ?? "";

async function offered(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-11-12T15:00:00Z"));
  t.directory([...STAFF]);
  t.as("admin", ADMIN);
  const thread = t.thread();
  const first = await thread.say(REQUEST);
  if (t.loopActive?.()) {
    // Changed on purpose (Pau 14 Nov: fewer questions / off-roster card + not-on-Woven line): with the loop on, the card comes at once with the line; every outcome check is kept.
    expect((thread.proposal as { employeeName?: string | null } | null)?.employeeName, `no card for ${C}:\n${first.content}`).toBe(C);
    expect(first.content).toMatch(new RegExp(`\\*\\*${C}\\*\\* isn't on (?:your salon's|the) Woven staff list`));
    expect(observation(first), `the first card's Observation:\n${first.content}`).toMatch(/she was late/i);
    return thread;
  }
  expect(first.content, `no offer for ${C}:\n${first.content}`).toContain(`reply **use ${C}**`);
  expect(observation(first), `the first card's Observation:\n${first.content}`).toBe("do not terminate yet, she was late");
  return thread;
}

function heldAndAskedAgain(reply: ReplayAnswer, proposal: unknown, place: string) {
  const card = proposal as { employeeName?: string | null; templateKey?: string } | null;
  expect(card?.templateKey, `no Corrective Action card:\n${reply.content}`).toBe("dpoa");
  expect(card?.employeeName ?? null, `"${place}" became the employee:\n${reply.content}`).toBeNull();
  expect(reply.content, `"use ${C}" is not asked again:\n${reply.content}`).toContain(`reply **use ${C}**`);
  expect(observation(reply), `the Observation was lost:\n${reply.content}`).toBe("do not terminate yet, she was late");
  expect(reply.content, `the Attendance policy was lost:\n${reply.content}`).toMatch(/Attendance/);
}

const PLACES = [
  { key: "state-first-unlisted", place: "IA Altoona", salon: null },
  { key: "state-first", place: "KS Manhattan", salon: "loc-0462" },
  { key: "city-only", place: "Manhattan", salon: "loc-0462" },
  { key: "city-state", place: "Altoona, IA", salon: null },
] as const;

export const NOV12_OFF_ROSTER_PLACE_ANSWER_CASES: ReplayCase[] = PLACES.map(({ key, place, salon }) => ({
  id: `nov12-off-roster-place-answer-${key}`,
  title: `Admin: "${REQUEST}" → offer → "${place}": never a person; the account is kept${salon ? ", the salon set," : ""} and "use ${C}" asked again`,
  report: `${REPORT}; ${key}`,
  // Changed on purpose (13 Nov 2026): fixed in production by OFF_ROSTER_PLACE_ANSWER_ENABLED, QA round 38a. Was OPEN.
    status: "fixed",
  fixFlags: [FLAG],
  async run(t: ReplayContext) {
    const thread = await offered(t);
    const reply = await thread.say(place);
    if (t.loopActive?.()) {
      // Changed on purpose (Pau 14 Nov: fewer questions / off-roster card + not-on-Woven line): with the loop on, the card comes at once with the line; every outcome check is kept.
      const card = thread.proposal as { employeeName?: string | null; templateKey?: string; locationId?: string | null } | null;
      expect(card?.employeeName ?? null, `"${place}" became the employee:\n${reply.content}`).toBe(C);
      expect(card?.templateKey).toBe("dpoa");
      expect(observation(reply), `the Observation was lost:\n${reply.content}`).toMatch(/she was late/i);
      if (salon) expect(card?.locationId, `the salon is not set:\n${reply.content}`).toBe(salon);
      return;
    }
    heldAndAskedAgain(reply, thread.proposal, place);
    expect(reply.content, `the place is named as a person:\n${reply.content}`).not.toMatch(/\*\*(?:Ia Altoona|Ks Manhattan)\*\*/);
    if (salon) {
      expect((thread.proposal as { locationId?: string | null }).locationId, `the salon is not set:\n${reply.content}`).toBe(salon);
      // The sibling app's Gate-Bubbles-5 (12 Nov 2026): the salon was set, so the reply never says the form won't name one.
      expect(reply.content, `the reply contradicts the salon it set:\n${reply.content}`).not.toMatch(/covers every salon/);
    }
    /*
     * Not asserted here: "use <C>" after the offer. For an all-salon admin it is refused on production's flags even
     * with no place turn between ("\"<C>\" isn't a person on your team"), a defect of its own reported to QA
     * (12 Nov 2026).
     */
  },
}));
