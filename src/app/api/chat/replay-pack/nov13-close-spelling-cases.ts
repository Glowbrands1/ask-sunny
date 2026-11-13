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
  // Changed on purpose (13 Nov 2026): fixed in production by CLOSE_SPELLING_MATCH_ENABLED, QA round 38c. Was OPEN.
  status: "fixed",
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
    // Changed on purpose (13 Nov 2026): fixed in production by CLOSE_SPELLING_MATCH_ENABLED, QA round 38c. Was OPEN.
    status: "fixed",
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
  // Changed on purpose (13 Nov 2026): fixed in production by CLOSE_SPELLING_MATCH_ENABLED, QA round 38c. Was OPEN.
  status: "fixed",
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

/*
 * QA's proof cases (13 Nov 2026), added to the manual for these cases only, with invented headings:
 *   - a title one letter off from TWO headings asks "Did you mean A or B?" and cites neither;
 *   - a word many headings share ("workplace": Visitors in the Workplace, Animals in the Workplace) is never a
 *     confident match.
 */
function manualChunk(index: number, page: number, heading: string, body: string) {
  return {
    chunkIndex: index,
    chunkId: `close-${index}`,
    locator: `Page ${page} — ${heading}`,
    page: page + 1,
    content: `${heading}\n${body}`,
    section: heading,
    printedPage: page,
    sections: [{ page, heading }],
  };
}

export const NOV13_CLOSE_SPELLING_PROOF_CASES: ReplayCase[] = [
  {
    id: "nov13-close-spelling-policy-two-headings-asks-which",
    title: `"… violating the key holdr policy …", with Key Holder Guidelines and Key Holder Requirements — "Did you mean A or B?"`,
    report: `${REPORT}; QA's proof: one letter off from two headings`,
    // Changed on purpose (13 Nov 2026): fixed in production by CLOSE_SPELLING_MATCH_ENABLED, QA round 38c. Was OPEN.
    status: "fixed",
    fixFlags: [FLAG],
    async run(t: ReplayContext) {
      const thread = start(t);
      t.manualAlsoHas?.([
        manualChunk(900, 60, "Key Holder Guidelines", "A key holder opens and closes the location."),
        manualChunk(901, 61, "Key Holder Requirements", "A key holder is at least eighteen."),
      ]);
      const reply = (
        await thread.say("create a verbal ca for juno paxton for violating the key holdr policy, she left the back door unlocked last night")
      ).content;
      expect(reply, `not asked between the two:\n${reply}`).toMatch(
        /Did you mean \*\*Key Holder Guidelines\*\* \(page 60\) or \*\*Key Holder Requirements\*\* \(page 61\)\?/,
      );
      expect(reply, `one was cited:\n${reply}`).not.toMatch(/\*\*Policy:\*\* Key Holder (?:Guidelines|Requirements), as you said/);
    },
  },
  {
    id: "nov13-close-spelling-policy-shared-word-never-confident",
    title: `"… violating the wrkplace policy …" — never a confident match to one of the "… in the Workplace" headings`,
    report: `${REPORT}; QA's proof: a word shared by many headings`,
    status: "fixed",
    async run(t: ReplayContext) {
      const thread = start(t);
      const reply = (
        await thread.say("create a verbal ca for marnie holloway for violating the wrkplace policy, she argued with a coworker today")
      ).content;
      expect(reply, `cited a heading from a shared word:\n${reply}`).not.toMatch(/\*\*Policy:\*\* (?:Visitors|Animals) in the Workplace, as you said/);
    },
  },
];

/*
 * QA's ruling on the sibling app's #859 (13 Nov 2026): "A policy the manager NAMES wins, as everywhere else ... Pau's
 * cleaning ruling (cleaning left undone → Other) applies when the manager only DESCRIBES cleaning." The manual here
 * gains its Care and Cleaning section for these cases (this pack's manual fixture has no such sheet). A station left a
 * mess is a cleaning account: on production flags the card says Other. With the flag the manager's "care and clening"
 * names that section confidently, so the Policy line cites it and the plan reviews it; "clneaing" (two letters off) is
 * not confident, so Other stays and "Did you mean …?" is asked.
 */
const CARE = "Care and Cleaning of Equipment and Facilities";
const CARE_SHEET = manualChunk(
  70,
  21,
  CARE,
  "Employees keep the equipment and the location clean and sanitized, and finish the cleaning duties assigned to their shift before it ends.",
);

export const NOV13_CLOSE_SPELLING_CLEANING_CASES: ReplayCase[] = [
  {
    id: "nov13-close-spelling-policy-care-and-clening",
    title: `"… violating the care and clening policy, she left her station a mess …" — the Policy line cites ${CARE}, and the plan agrees`,
    report: `${REPORT}; QA's example "Care and Clening", and QA's ruling: a named policy wins over cleaning-is-Other`,
    // Changed on purpose (13 Nov 2026): fixed in production by CLOSE_SPELLING_MATCH_ENABLED, QA round 38c. Was OPEN.
    status: "fixed",
    fixFlags: [FLAG],
    async run(t: ReplayContext) {
      const thread = start(t);
      t.manualAlsoHas?.([CARE_SHEET]);
      const reply = (
        await thread.say("create a verbal ca for marnie holloway for violating the care and clening policy, she left her station a mess at close today")
      ).content;
      const policy = /^\*\*Policy:\*\*[^\n]*/m.exec(reply)?.[0] ?? "";
      expect(policy, `the Policy line:\n${reply}`).toMatch(new RegExp(`^\\*\\*Policy:\\*\\* ${CARE}, as you said — the policy manual's section on page \\d+`));
      expect(reply, `the card still says Other:\n${reply}`).not.toMatch(/\*\*Policy:\*\* Other/);
      const plan = /\*\*Action plan:\*\*[^\n]*/i.exec(reply)?.[0] ?? "";
      expect(plan, `the plan does not review the same policy:\n${reply}`).toContain(`review the ${CARE} policy`);
    },
  },
  {
    id: "nov13-close-spelling-policy-cleaning-not-confident-keeps-other-asks",
    title: `"… violating the care and clneaing policy, she left her station a mess …" — Other stays; "Did you mean **${CARE}**?"`,
    report: `${REPORT}; QA's ruling: not confident keeps Other and asks`,
    // Changed on purpose (13 Nov 2026): fixed in production by CLOSE_SPELLING_MATCH_ENABLED, QA round 38c. Was OPEN.
    status: "fixed",
    fixFlags: [FLAG],
    async run(t: ReplayContext) {
      const thread = start(t);
      t.manualAlsoHas?.([CARE_SHEET]);
      const reply = (
        await thread.say("create a verbal ca for marnie holloway for violating the care and clneaing policy, she left her station a mess at close today")
      ).content;
      expect(reply, `Other is gone:\n${reply}`).toMatch(/\*\*Policy:\*\* Other — cleaning duties left undone/);
      expect(reply, `no "Did you mean":\n${reply}`).toMatch(new RegExp(`Did you mean \\*\\*${CARE}\\*\\* \\(page \\d+\\)\\?`));
      expect(reply, `cited without asking:\n${reply}`).not.toMatch(new RegExp(`\\*\\*Policy:\\*\\* ${CARE}, as you said`));
    },
  },
];

/*
 * HEADING_DISTINCTIVE_WORDS (QA, 13 Nov 2026, from the sibling app's 17s live check; ported): "ca for <A> for violating the retaliaton policy"
 * gave "Woven does not see a section … for "retaliaton"", and "retaliation" spelled right did the same: "Retaliation is
 * Prohibited" (in the live manual and this pack's fixture) wanted "is prohibited" said too. With the flag, a heading is
 * named by its distinctive words; with CLOSE_SPELLING_MATCH "retaliaton" is one letter off. Invented
 * people.
 */
const DISTINCTIVE = "HEADING_DISTINCTIVE_WORDS_ENABLED";

export const NOV13_HEADING_DISTINCTIVE_WORDS_CASES: ReplayCase[] = (
  [
    { key: "retaliation", said: "retaliation" },
    { key: "retaliaton", said: "retaliaton" },
  ] as const
).map((wording) => ({
  id: `nov13-heading-distinctive-words-${wording.key}-policy`,
  title: `"… violating the ${wording.said} policy …" — the Policy line cites Retaliation is Prohibited`,
  report: `QA, 13 Nov 2026 (HEADING_DISTINCTIVE_WORDS; 17s live check: "retaliaton"); invented people`,
  status: { open: `"${wording.said}" names no section: the card says none was found` },
  fixFlags: [DISTINCTIVE],
  async run(t: ReplayContext) {
    const thread = start(t);
    const reply = (
      await thread.say(`create a verbal ca for juno paxton for violating the ${wording.said} policy, she cut a coworker's hours after he reported her`)
    ).content;
    expect(reply, `the Policy line:\n${reply}`).toMatch(/\*\*Policy:\*\* Retaliation is Prohibited, as you said — the policy manual's section on page \d+/);
    expect(reply, `the card still says no section was found:\n${reply}`).not.toMatch(/see a section of the current policy manual for/);
  },
}));
