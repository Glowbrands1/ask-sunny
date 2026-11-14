import { expect, vi } from "vitest";

import { STAFF, type ReplayCase, type ReplayContext } from "./cases";

/**
 * ============================================================================
 * SALON_NAME_LETTER_WORD — "LINCOLN STREET FAIR" IS NOT THE LINCOLN O STREET SALON (Coding-4's finding, 13 Nov 2026)
 * ============================================================================
 *
 * Found while working Gate-Sunny's #933 place probes: an Admin's "create a ca for <A>, she was at lincoln street fair
 * instead of her shift" is filed at NE Lincoln O Street (Sunny main 43ff6f53). The slot reader matched a salon by its
 * words of four letters or more, so "lincoln" and "street" anywhere were enough; the street "O" was never asked for.
 * With SALON_NAME_LETTER_WORD_ENABLED the one-letter word must be said, before the word after it. Invented person.
 */
const FLAG = "SALON_NAME_LETTER_WORD_ENABLED";
const REPORT = "Coding-4's finding (13 Nov 2026), from Gate-Sunny's #933 place probes; invented person";
const LINCOLN_O_STREET = "loc-0311";

async function cardFor(t: ReplayContext, turn: string) {
  vi.setSystemTime(new Date("2026-11-13T15:00:00Z"));
  t.directory([...STAFF]);
  t.as("admin", { level: "global", primaryAreaId: null, alsoCoversAreaIds: [] });
  const thread = t.thread();
  const reply = (await thread.say(turn)).content;
  return { reply, locationId: (thread.proposal as { locationId?: string | null } | null)?.locationId ?? null };
}

/*
 * "because": an open case until 38j. REASON_PLACE_NOT_SALON (#975) is on in production since round 38j, so a "because
 * she was at …" reason's place is never the salon there, and this case now holds in production too: a guard
 * ("fixed"), flag off and on. "instead-of-shift" is not a reason and stays open.
 */
const OPEN: readonly { key: string; turn: string; fixedInProduction?: true }[] = [
  { key: "instead-of-shift", turn: "create a ca for marnie holloway, she was at lincoln street fair instead of her shift" },
  { key: "because", turn: "create a ca for marnie holloway, she missed her shift because she was at the lincoln street fair", fixedInProduction: true },
];

export const NOV14_SALON_NAME_LETTER_WORD_CASES: ReplayCase[] = OPEN.map((wording) => ({
  id: `nov14-salon-name-letter-word-${wording.key}`,
  title: `Admin: "${wording.turn}" — not filed at NE Lincoln O Street`,
  report: REPORT,
  status: wording.fixedInProduction ? "fixed" : { open: `"lincoln street fair" is read as the NE Lincoln O Street salon` },
  fixFlags: [FLAG],
  async run(t: ReplayContext) {
    const { reply, locationId } = await cardFor(t, wording.turn);
    expect(locationId, `filed at Lincoln O Street:\n${reply}`).not.toBe(LINCOLN_O_STREET);
  },
}));

/** Guards, flag off and on: the salon said with its street letter is still read. */
const MUST_READ: readonly { key: string; turn: string }[] = [
  { key: "lincoln-o-street", turn: "create a ca for marnie holloway at lincoln o street, she was late" },
  { key: "lincoln-o-st", turn: "create a ca for marnie holloway at the lincoln o st salon, she was late" },
];

export const NOV14_SALON_NAME_LETTER_WORD_GUARDS: ReplayCase[] = MUST_READ.map((wording) => ({
  id: `nov14-salon-name-letter-word-guard-${wording.key}`,
  title: `Admin: "${wording.turn}" — NE Lincoln O Street, as before`,
  report: REPORT,
  status: "fixed",
  fixFlags: [FLAG],
  async run(t: ReplayContext) {
    const { reply, locationId } = await cardFor(t, wording.turn);
    expect(locationId, `the salon was not read:\n${reply}`).toBe(LINCOLN_O_STREET);
  },
}));
