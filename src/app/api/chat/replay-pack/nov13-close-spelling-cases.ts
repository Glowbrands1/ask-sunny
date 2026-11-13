import { expect, vi } from "vitest";

import { KEARNEY, STAFF, TWO_SALONS, type ReplayCase, type ReplayContext } from "./cases";

/**
 * ============================================================================
 * CLOSE_SPELLING_MATCH — A POLICY OR A SALON NAMED A LETTER OFF (Pau, via QA, 13 Nov 2026)
 * ============================================================================
 *
 * QA's direction from Pau, 13 Nov 2026: "Match the manager's words against our own lists instead of exact spellings,
 * for names, stores/salons and policy titles. Allow close spellings ("Care and Clening" → "Care and Cleaning"). Put
 * the list's correct spelling on the form. Ask "Did you mean …?" when there is more than one possible match, or when
 * the match isn't confident." Ported from the sibling app. The wording is invented (QA: invented people, no
 * production rows).
 */
const FLAG = "CLOSE_SPELLING_MATCH_ENABLED";
const REPORT = "Pau via QA, 13 Nov 2026 (CLOSE_SPELLING_MATCH; invented wording)";

function start(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-11-13T15:00:00Z"));
  t.directory([...STAFF]);
  t.as("salon_director", KEARNEY);
  return t.thread();
}

/** A confident close spelling: the card cites the manual's own heading, with its spelling. */
const CONFIDENT: readonly { key: string; turn: string; heading: string }[] = [
  {
    key: "anmals-in-the-workplace",
    turn: "create a verbal ca for rowan kestrel for violating the anmals in the workplace policy, he brought his puppy to work today",
    heading: "Animals in the Workplace",
  },
  {
    key: "vistors-at-work",
    turn: "create a verbal ca for remy calder for violating the vistors at work policy, her boyfriend stayed behind the counter for an hour today",
    heading: "Visitors in the Workplace",
  },
];

export const NOV13_CLOSE_SPELLING_POLICY_CASES: ReplayCase[] = CONFIDENT.map((wording) => ({
  id: `nov13-close-spelling-policy-${wording.key}`,
  title: `"${wording.turn}" — the card cites ${wording.heading}, spelled as the manual spells it`,
  report: `${REPORT}; ${wording.key}`,
  status: { open: "a policy named a letter off cites no section of the manual" },
  fixFlags: [FLAG],
  async run(t: ReplayContext) {
    const thread = start(t);
    const reply = (await thread.say(wording.turn)).content;
    expect(reply, `the card does not cite ${wording.heading}:\n${reply}`).toContain(`**Policy:** ${wording.heading}, as you said`);
    expect(reply, `the card still says no section was found:\n${reply}`).not.toMatch(/see a section of the current policy manual for/);
  },
}));

/** Not confident (two words off): nothing is cited, and the manager is asked. */
export const NOV13_CLOSE_SPELLING_POLICY_ASK_CASES: ReplayCase[] = [
  {
    id: "nov13-close-spelling-policy-not-confident-asks",
    title: `"… violating the anmals in the wrkplace policy …" — not cited; "Did you mean **Animals in the Workplace**?"`,
    report: `${REPORT}; two words off`,
    status: { open: `no question: the card says no section was found for "anmals in the wrkplace"` },
    fixFlags: [FLAG],
    async run(t: ReplayContext) {
      const thread = start(t);
      const reply = (
        await thread.say("create a verbal ca for rowan kestrel for violating the anmals in the wrkplace policy, he brought his puppy to work today")
      ).content;
      expect(reply, `no "Did you mean":\n${reply}`).toMatch(/Did you mean \*\*Animals in the Workplace\*\* \(page \d+\)\?/);
      expect(reply, `cited without asking:\n${reply}`).not.toMatch(/\*\*Policy:\*\* Animals in the Workplace, as you said/);
    },
  },
  {
    // Guard: a policy spelled as the manual spells it is cited as before, with or without the flag.
    id: "nov13-close-spelling-policy-exact-unchanged",
    title: `"… violating the visitors at work policy …" — cited as before`,
    report: `${REPORT}; guard`,
    status: "fixed",
    async run(t: ReplayContext) {
      const thread = start(t);
      const reply = (
        await thread.say("create a verbal ca for remy calder for violating the visitors at work policy, her boyfriend stayed behind the counter for an hour today")
      ).content;
      expect(reply, `not cited:\n${reply}`).toContain("**Policy:** Visitors in the Workplace, as you said");
      expect(reply, `asked when spelled right:\n${reply}`).not.toMatch(/Did you mean/);
    },
  },
];

/*
 * A salon typed a letter off, by a salon director who covers Grand Island (primary) and Kearney (TWO_SALONS), about a
 * consultant on Kearney's roster. The manager says the incident was at Grand Island, spelled "grand islnd". On
 * production flags the typed salon is not read and the card takes the consultant's own salon, Kearney; with the flag it
 * is Grand Island.
 */
const GRAND_ISLAND_ID = "loc-0307";

export const NOV13_CLOSE_SPELLING_SALON_CASES: ReplayCase[] = (
  [
    { key: "at-grand-islnd", turns: ["create a ca for rowan kestrel at grand islnd, he was late today"] },
    { key: "grand-islnd-salon", turns: ["create a ca for rowan kestrel, he was late today at the grand islnd salon"] },
  ] as const
).map((wording) => ({
  id: `nov13-close-spelling-salon-${wording.key}`,
  title: `${wording.turns.map((turn) => `"${turn}"`).join(" → ")} — the card's salon is Grand Island`,
  report: `${REPORT}; a salon a letter off (${wording.key})`,
  status: { open: "a salon typed a letter off is not read: the card takes the consultant's own salon" },
  fixFlags: [FLAG],
  async run(t: ReplayContext) {
    vi.setSystemTime(new Date("2026-11-13T15:00:00Z"));
    t.directory([...STAFF]);
    t.as("salon_director", TWO_SALONS);
    const thread = t.thread();
    let reply = "";
    for (const turn of wording.turns) reply = (await thread.say(turn)).content;
    expect((thread.proposal as { locationId?: string | null } | null)?.locationId ?? null, `the card's salon:\n${reply}`).toBe(GRAND_ISLAND_ID);
  },
}));
