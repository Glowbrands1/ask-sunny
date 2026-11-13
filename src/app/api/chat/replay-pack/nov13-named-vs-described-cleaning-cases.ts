import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayCase, type ReplayContext } from "./cases";

/**
 * ============================================================================
 * A NAMED POLICY WINS; ONLY A DESCRIBED DUTY IS OTHER (Gate-Sunny-3's probes on #839, 13 Nov 2026; Pau's rule)
 * ============================================================================
 *
 * Gate-Sunny-3's twelve wordings, its setup exactly: an invented person (Odessa Quillfeather, on no directory), retrieval
 * holding the Care and Cleaning passage (printed p.21) and the slot stand-in reading its heading, as the live chat did.
 * ON is OTHER_POLICY_AGREES + OTHER_NOT_A_POLICY_NAME (ACCOUNT_TYPOS_FIXED will not ship: QA's ruling).
 *   - NAMED: the manager names Care and Cleaning (close spellings included): the card and the saved draft keep it,
 *     never Other. On main, 4 and 5 were Other (the cleaning-is-Other override beat the named policy); with the first
 *     #839 head, 2 and 3 were too.
 *   - DESCRIBED: a cleaning duty described, no policy named: Other on the card and the draft. On main, 1 and 6 cited
 *     p.21.
 */
const ODESSA: DirectoryRow = { id: "e-odessa", firstName: "Odessa", lastName: "Quillfeather", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0309"], positionName: "Tanning Consultant" };
const CARE = {
  chunkIndex: 21.5,
  chunkId: "jba-21-5",
  locator: "Page 21 — Care and Cleaning of Equipment and Facilities",
  page: 22,
  content: "Care and Cleaning of Equipment and Facilities\nEmployees keep the salon, its beds and its equipment clean and sanitized as directed.",
  section: "Care and Cleaning of Equipment and Facilities",
  printedPage: 21,
  sections: [],
};
const ON = ["OTHER_POLICY_AGREES_ENABLED", "OTHER_NOT_A_POLICY_NAME_ENABLED"];
const REPORT = "Gate-Sunny-3's named-policy probes on #839 (13 Nov 2026)";

async function cardAndDraft(t: ReplayContext, said: string, create = true) {
  vi.setSystemTime(new Date("2026-11-13T15:00:00Z"));
  t.directory([...STAFF, ODESSA]);
  t.as("salon_director", KEARNEY);
  t.manualAlsoHas?.([CARE]);
  t.slotsRead({ employee: "Odessa Quillfeather", formType: "Corrective Action Form", formTurn: true, policyHeading: "Care and Cleaning of Equipment and Facilities" });
  const thread = t.thread();
  const card = (await thread.say(said)).content;
  if (!create) return { card, saved: null };
  const id = await thread.create();
  return { card, saved: t.values(id) };
}

const NAMED: readonly { n: number; said: string; open?: string; create?: boolean }[] = [
  { n: 1, said: "please make a ca for Odessa Quillfeather for violating the care and cleaning policy" },
  { n: 2, said: "ca for Odessa Quillfeather under care and clening, she did not do the 10 minute sanitaion" },
  { n: 3, said: "ca for Odessa Quillfeather, policy is Care and Cleaning of Equipment and Facilities. she skipped the bed sanitation" },
  { n: 4, said: "write up Odessa Quillfeather for care and cleaning - beds were left dirty", open: "the named Care and Cleaning reads as Other" },
  { n: 5, said: "CA for Odessa Quillfeather, care and cleaning violation, did not clean the lobby", open: "the named Care and Cleaning reads as Other" },
  // Gate-Sunny-3: create() here meets the stand-in's "This proposal is out of date" quirk in both arms; the card is checked.
  { n: 6, said: "ca for Odessa Quillfeather care and clening policy not followed", create: false },
];

const DESCRIBED: readonly { n: number; said: string; open?: string }[] = [
  { n: 1, said: "please make a ca for Odessa Quillfeather for not doing th e10 minute sanitaion", open: "the card cites Care and Cleaning p.21 for a described duty" },
  { n: 2, said: "ca for Odessa Quillfeather, she did not clean the beds after her shift", open: "the card is Other but its Action Plan reviews the Care and Cleaning policy" },
  { n: 3, said: "ca for Odessa Quillfeather for skipping the 10 minute sanitize", open: "the card is Other but its Action Plan reviews the Care and Cleaning policy" },
  { n: 4, said: "ca for Odessa Quillfeather, she left the restrooms dirty at close", open: "the card is Other but its Action Plan reviews the Care and Cleaning policy" },
  { n: 5, said: "ca for Odessa Quillfeather for not completing her daily cleaning duties", open: "the card is Other but its Action Plan reviews the Care and Cleaning policy" },
  { n: 6, said: "ca for Odessa Quillfeather, the sanitation was not done this morning", open: "the card cites Care and Cleaning p.21 for a described duty" },
];

export const NOV13_NAMED_VS_DESCRIBED_CLEANING_CASES: ReplayCase[] = [
  ...NAMED.map(({ n, said, create }): ReplayCase => ({
    id: `nov13-cleaning-named-${n}`,
    title: `named ${n}: "${said}" keeps Care and Cleaning on the card and the draft, never Other`,
    report: REPORT,
    // Changed on purpose (13 Nov 2026): fixed in production by OTHER_POLICY_AGREES + OTHER_NOT_A_POLICY_NAME, QA round 38e. Was OPEN.
    status: "fixed",
    fixFlags: ON,
    async run(t) {
      const { card, saved } = await cardAndDraft(t, said, create !== false);
      expect(card, `a named Care and Cleaning reads as Other:\n${card}`).not.toMatch(/\*\*Policy:\*\* Other\b/);
      expect(card, `the card does not cite Care and Cleaning:\n${card}`).toMatch(/Care and Cleaning/);
      if (saved) expect(saved.policy_violated ?? "", `the draft is Other: ${JSON.stringify(saved)}`).not.toBe("Other");
    },
  })),
  ...DESCRIBED.map(({ n, said }): ReplayCase => ({
    id: `nov13-cleaning-described-${n}`,
    title: `described ${n}: "${said}" is Other on the card and the draft, no Care and Cleaning line`,
    report: REPORT,
    // Changed on purpose (13 Nov 2026): fixed in production by OTHER_POLICY_AGREES + OTHER_NOT_A_POLICY_NAME, QA round 38e. Was OPEN.
    status: "fixed",
    fixFlags: ON,
    async run(t) {
      const { card, saved } = await cardAndDraft(t, said);
      expect(card, `a described duty is not Other:\n${card}`).toMatch(/\*\*Policy:\*\* Other\b/);
      expect(card, `the card cites Care and Cleaning for a described duty:\n${card}`).not.toMatch(/Care and Cleaning|p\.21/);
      expect(saved?.policy_violated ?? "", `the draft is not Other: ${JSON.stringify(saved)}`).toBe("Other");
    },
  })),
];

/**
 * Gate-Sunny-3's two notes on #839 (13 Nov 2026), OPEN and not fixed in this PR (QA): they are main's own limits, the
 * same with the flags off and on.
 *   - "she did not take care and clean the beds": rightly not read as NAMING Care and Cleaning, but the cleaning reader
 *     does not read it as an undone duty either, so the card cites p.21 instead of Other.
 *   - "violating the care and cleaning policy": the card says "I don't see a section … for 'care and cleaning' … so I
 *     won't cite one" AND carries a "Care and Cleaning … p.21" line — the two contradict.
 */
export const NOV13_CLEANING_GATE_NOTES_CASES: ReplayCase[] = [
  {
    id: "nov13-cleaning-gate-note-take-care-and-clean",
    title: `"ca for Odessa Quillfeather, she did not take care and clean the beds" is a described duty: Other, no p.21`,
    report: `${REPORT}; note (a)`,
    status: { open: "the cleaning reader does not read \"did not take care and clean\" as an undone duty: the card cites p.21" },
    async run(t) {
      const { card } = await cardAndDraft(t, "ca for Odessa Quillfeather, she did not take care and clean the beds", false);
      expect(card, `a described duty is not Other:\n${card}`).toMatch(/\*\*Policy:\*\* Other\b/);
      expect(card, `the card cites p.21 for a described duty:\n${card}`).not.toMatch(/p\.21\b/);
    },
  },
  {
    id: "nov13-cleaning-gate-note-named-no-contradiction",
    title: `"please make a ca for Odessa Quillfeather for violating the care and cleaning policy": never both "won't cite one" and a p.21 line`,
    report: `${REPORT}; note (b)`,
    // Changed on purpose (13 Nov 2026): Gate-Sunny-3 saw both lines on 9a248824; after main 0ef33633 (its close-spelling
    // match) is merged, production's card no longer carries both. Kept as a guard.
    status: "fixed" as const,
    async run(t) {
      const { card } = await cardAndDraft(t, "please make a ca for Odessa Quillfeather for violating the care and cleaning policy", false);
      const wontCite = /so I won't cite one/i.test(card);
      const cites = /Care and Cleaning[^\n]*p\.21/i.test(card);
      expect(wontCite && cites, `the card both declines to cite and cites p.21:\n${card}`).toBe(false);
    },
  },
];
