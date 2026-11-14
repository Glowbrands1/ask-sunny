import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase } from "./cases";

/**
 * ============================================================================
 * WHAT A LATER TURN ADDS TO THE CARD: ITS FACT, NEVER A HEDGE, LEVEL, TITLE, PLACE, HISTORY OR DENIAL
 * (CARD_ACCOUNT_DROPS_NON_FACTS_ENABLED, with production's CARD_CHECKED_AGAINST_WORDS and CARD_ADDED_FACT_IN_OBSERVATION)
 * ============================================================================
 *
 * v2-Gate-Sunny-3's 78 probes (14 Nov 2026; record: claude/gate-sunny-3-records,
 * docs/gate-records/sunny-3/card-added-fact-78-probes.txt), in the gate's own wording. An open card "create a CA for
 * Marnie Holloway, she was late on 11/3/26", then one turn. Each row: the card's "Added" note and its Observation line.
 * "open": what production does today (the fix turns it). The person is the pack's invented one.
 */

const OPEN_CARD = "create a CA for Marnie Holloway, she was late on 11/3/26";
const BEFORE = "she was late on 11/3/26";
const FLAG = "CARD_ACCOUNT_DROPS_NON_FACTS_ENABLED";
const REPORT = "v2-Gate-Sunny-3's card-added-fact probes (14 Nov 2026), via QA";

interface Row {
  readonly said: string;
  /** The Added note's text with the fix; null: no Added note. */
  readonly added: string | null;
  /** What production shows today, when it differs. */
  readonly open?: string;
}

const ROWS: readonly Row[] = [
  // 3a: the raw turn stayed in the Observation.
  { said: "she maybe forgot", added: null, open: "the raw turn stays in the Observation" },
  { said: "i think she yelled at a guest", added: null, open: "the raw turn stays in the Observation" },
  { said: "she might have yelled at a guest", added: null, open: "the raw turn stays in the Observation" },
  { said: "she probably forgot to clean the bed", added: null, open: "the raw turn stays in the Observation" },
  { said: "not sure but she yelled at a guest", added: null, open: "the raw turn stays in the Observation" },
  { said: "possibly she left the drawer open", added: null, open: "the raw turn stays in the Observation" },
  { said: "apparently she yelled at a guest", added: null, open: "the raw turn stays in the Observation" },
  { said: "this is a final warning she yelled at a guest", added: "she yelled at a guest", open: "the raw turn stays in the Observation" },
  { said: "it happened at north platte", added: null, open: "the raw turn stays in the Observation" },
  { said: "last week she also yelled at a guest", added: null, open: "the raw turn stays in the Observation" },
  { said: "she owes $25 for the late opening", added: null, open: "the raw turn stays in the Observation" },
  { said: "she has to pay $15 for the broken bulb", added: null, open: "the raw turn stays in the Observation" },
  { said: "it was on 11/3", added: null, open: "the raw turn stays in the Observation" },
  { said: "also she didn't clean", added: "she didn't clean", open: "the raw turn stays in the Observation" },
  // 3b: the Added note kept a clause that is no fact.
  { said: "she yelled at a guest i guess", added: "she yelled at a guest", open: "Added keeps \"i guess\"" },
  { said: "she yelled at a guest, maybe twice", added: "she yelled at a guest", open: "Added keeps \", maybe twice\"" },
  { said: "she yelled at a guest as a TC", added: "she yelled at a guest", open: "Added keeps \"as a TC\"" },
  { said: "she works as a tanning consultant and yelled at a guest", added: "she yelled at a guest", open: "Added keeps the title" },
  { said: "she had a verbal last month", added: null, open: "history added as a fact" },
  { said: "she has been late 3 times this month", added: null, open: "history added as a fact" },
  { said: "she was previously warned about her phone", added: null, open: "history added as a fact" },
  // NEG: a denied fault is no fact.
  { said: "she was not late, she yelled at a guest", added: "she yelled at a guest", open: "Added keeps \"she was not late\"" },
  { said: "she didn't yell at a guest", added: null, open: "a denial added as a fact" },
  // 3c: the fact kept, with no "; " and no note.
  { said: "she yelled at a guest at kearney", added: "she yelled at a guest", open: "no Added note and no \"; \"" },
  { said: "she was late at the kearney store", added: null, open: "\"she was late\" repeated" },
  // Guards.
  { said: "she yelled at a guest", added: "she yelled at a guest" },
  { said: "she did not clean bed 4", added: "she did not clean bed 4" },
  { said: "she didn't answer the phone", added: "she didn't answer the phone" },
  { said: "she yelled at a guest and she maybe forgot", added: "she yelled at a guest" },
];

export const NOV14_CARD_ADDED_FACTS_PROBES_CASES: ReplayCase[] = ROWS.map((row, index) => ({
  id: `nov14-card-added-facts-probe-${index + 1}`,
  title: `"${OPEN_CARD}" then "${row.said}": ${row.added === null ? "nothing is added" : `the card adds "${row.added}"`}`,
  report: REPORT,
  status: row.open ? { open: row.open } : "fixed",
  fixFlags: [FLAG],
  async run(t) {
    vi.setSystemTime(new Date("2026-11-13T16:00:00Z"));
    t.directory(STAFF);
    t.as("salon_director", KEARNEY);
    const thread = t.thread();
    await thread.say(OPEN_CARD);
    const reply = await thread.say(row.said);
    const observation = (reply.content.match(/^\*\*Observation of Offense:\*\*\s*(.*)$/m) ?? [])[1] ?? "";
    const added = (reply.content.match(/^\*\*Added to [^*]+:\*\*\s*(.*)$/m) ?? [])[1] ?? null;
    expect(added, `the Added note:\n${reply.content}`).toBe(row.added);
    expect(observation, `the card's Observation:\n${reply.content}`).toBe(row.added === null ? BEFORE : `${BEFORE}; ${row.added}`);
  },
}));
