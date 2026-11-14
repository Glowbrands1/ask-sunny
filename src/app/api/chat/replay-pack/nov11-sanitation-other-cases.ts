import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayCase, type ReplayContext } from "./cases";

/**
 * ============================================================================
 * THE CARD AND THE SAVED DRAFT SAY THE SAME POLICY (Sunny production, 10 Nov 2026 18:49Z, rated 1 star)
 * ============================================================================
 *
 * "please make a ca for <name> for not doing th e10 minute sanitaion" (the manager's words; the person invented): the card
 * cited "Care and Cleaning of Equipment and Facilities Policy, JBA Policy Manual p.21" (the slot model's heading, as live)
 * and planned to review that policy; Create saved Policy Violated "Other", the EMERGENCY passage as Direct policy and "review
 * the Other policy". QA's ruling (Pau's rule stands): cleaning or sanitation left undone is Other, the account its reason —
 * so the card shows Other and cites nothing, and the draft saves Other with no unrelated passage.
 */
const BRISA: DirectoryRow = {
  id: "e-brisa-talmadge",
  firstName: "Brisa",
  lastName: "Talmadge",
  preferredFirstName: null,
  employmentStatus: "active",
  salonIds: ["loc-0309"],
  positionName: "Tanning Consultant",
};
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
const SAID = "please make a ca for Brisa Talmadge for not doing th e10 minute sanitaion";
const REPORT = "Sunny production (10 Nov 2026 18:49Z, 1 star), via QA: the card cites Care and Cleaning p.21, Create saves Other with the emergency passage";

async function cardAndDraft(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-11-10T18:49:00Z"));
  t.directory([...STAFF, BRISA]);
  t.as("salon_director", KEARNEY);
  t.manualAlsoHas?.([CARE]);
  t.slotsRead({ employee: "Brisa Talmadge", formType: "Corrective Action Form", formTurn: true, policyHeading: "Care and Cleaning of Equipment and Facilities" });
  const thread = t.thread();
  const card = await thread.say(SAID);
  const id = await thread.create();
  return { card: card.content, saved: t.values(id), checked: t.checked(id) };
}

export const NOV11_SANITATION_OTHER_CASES: ReplayCase[] = [
  {
    id: "nov11-sanitation-other-card-equals-draft",
    title: `"${SAID}": the card's policy is the saved Policy Violated (Other), and the card cites no Care and Cleaning page`,
    report: REPORT,
    // Changed on purpose (13 Nov 2026): fixed in production by OTHER_POLICY_AGREES + OTHER_NOT_A_POLICY_NAME, QA round 38e. Was OPEN.
    status: "fixed",
    fixFlags: ["OTHER_POLICY_AGREES_ENABLED"],
    async run(t) {
      const { card, saved, checked } = await cardAndDraft(t);
      expect(card, card).toMatch(/\*\*Policy:\*\* Other\b/);
      expect(card, card).not.toMatch(/Care and Cleaning|p\.21/);
      expect(saved.policy_violated, JSON.stringify(saved)).toBe("Other");
      expect(checked.offense_type ?? []).toEqual(["other"]);
      // Never an unrelated retrieved passage as Direct policy.
      expect(saved.policy_language ?? "", JSON.stringify(saved)).not.toMatch(/emergency/i);
    },
  },
  {
    id: "nov11-sanitation-other-plan-not-other-policy",
    title: `"${SAID}": the saved Action Plan never says "the Other policy"`,
    report: REPORT,
    // Changed on purpose (13 Nov 2026): fixed in production by OTHER_POLICY_AGREES + OTHER_NOT_A_POLICY_NAME, QA round 38e. Was OPEN.
    status: "fixed",
    fixFlags: ["OTHER_POLICY_AGREES_ENABLED", "OTHER_NOT_A_POLICY_NAME_ENABLED"],
    // The protected forms/ca-action-plan.ts lines are in (Pau's standing approval via QA, 11 Nov 2026): it holds with both flags.
    async run(t) {
      const { card, saved } = await cardAndDraft(t);
      expect(card, card).not.toMatch(/review the (?:Care and Cleaning|Other) /i);
      expect(saved.action_plan ?? "", JSON.stringify(saved)).not.toMatch(/\bthe Other polic/i);
    },
  },
  {
    id: "nov11-sanitation-account-typos-mended",
    title: `"${SAID}": the card's Observation reads "not doing the 10-minute sanitation" (the manager's words, slips mended)`,
    report: `${REPORT} (C: typos on the card)`,
    status: { open: "the card's Observation is \"not doing th e10 minute sanitaion\"" },
    fixFlags: ["ACCOUNT_TYPOS_FIXED_ENABLED"],
    async run(t) {
      vi.setSystemTime(new Date("2026-11-10T18:49:00Z"));
      t.directory([...STAFF, BRISA]);
      t.as("salon_director", KEARNEY);
      const card = (await t.thread().say(SAID)).content;
      expect(card, card).toMatch(/^\*\*Observation of Offense:\*\* not doing the 10-minute sanitation$/m);
    },
  },
  // QA's controls (11 Nov 2026): a cleaning account the reader already read keeps today's Other card; a non-cleaning CA is unchanged.
  ...[
    ["beds", "please make a ca for Brisa Talmadge, she didn't clean the beds"],
    ["late", "please make a ca for Brisa Talmadge, she was 20 minutes late for her shift on 11/9"],
  ].map(
    ([id, said]): ReplayCase => ({
      id: `nov11-sanitation-other-control-${id as string}`,
      title: `control: "${said as string}" reads the same with OTHER_POLICY_AGREES and OTHER_NOT_A_POLICY_NAME on`,
      report: `${REPORT} (QA's controls)`,
      status: "fixed",
      fixFlags: ["OTHER_POLICY_AGREES_ENABLED", "OTHER_NOT_A_POLICY_NAME_ENABLED"],
      async run(t) {
        vi.setSystemTime(new Date("2026-11-10T18:49:00Z"));
        t.directory([...STAFF, BRISA]);
        t.as("salon_director", KEARNEY);
        const card = (await t.thread().say(said as string)).content;
        if (id === "beds") expect(card, card).toMatch(/\*\*Policy:\*\* Other — cleaning duties left undone/);
        else expect(card, card).not.toMatch(/\*\*Policy:\*\* Other\b/);
      },
    }),
  ),
];

/**
 * A NAMED POLICY WINS (Gate-Sunny-3 on #839, 13 Nov 2026; Pau's rule): with OTHER_POLICY_AGREES on, a manager who names
 * the Care and Cleaning section — close spellings included — keeps it; only a described duty is Other. Gate-Sunny-3's
 * own wordings are added with its verdict; these are the shapes it named. Invented person.
 */
export const NOV13_NAMED_CARE_AND_CLEANING_CASES: ReplayCase[] = [
  ["policy", "please make a ca for Brisa Talmadge for violating the care and cleaning policy, she did not sanitize the beds"],
  ["typo", "please make a ca for Brisa Talmadge per the care and clening policy, the beds were not sanitized"],
  ["ampersand", "please make a ca for Brisa Talmadge, care & cleaning policy, she left the beds dirty"],
].map(
  ([key, said]): ReplayCase => ({
    id: `nov13-named-care-and-cleaning-${key as string}`,
    title: `"${said as string}": the named Care and Cleaning policy is kept, never Other`,
    report: "Gate-Sunny-3 on #839 (13 Nov 2026): a manager who names Care and Cleaning got Other",
    // Production's CA_SALES_POLICY reads the cleaning account as Other even when the policy is named. Changed on purpose
    // (13 Nov 2026, main 0ef33633): the plainly named "care and cleaning policy" already holds on production there.
    // Changed on purpose (13 Nov 2026): fixed in production by OTHER_POLICY_AGREES + OTHER_NOT_A_POLICY_NAME, QA round 38e. Was OPEN.
    status: "fixed" as const,
    fixFlags: ["OTHER_POLICY_AGREES_ENABLED", "OTHER_NOT_A_POLICY_NAME_ENABLED"],
    async run(t) {
      vi.setSystemTime(new Date("2026-11-13T15:00:00Z"));
      t.directory([...STAFF, BRISA]);
      t.as("salon_director", KEARNEY);
      t.manualAlsoHas?.([CARE]);
      const card = (await t.thread().say(said as string)).content;
      expect(card, card).not.toMatch(/\*\*Policy:\*\* Other\b/);
    },
  }),
);

/*
 * QA's bar (the sibling gate's #772 probe, 14 Nov 2026; ported): the card's Observation never edits a coworker on the
 * roster, a salon name or a quoted span. Guards with ACCOUNT_TYPOS_FIXED (they hold flag off: nothing is edited).
 * Invented people: Manuel Quellby is a coworker one letter from "manual".
 */
const MANUEL: DirectoryRow = { ...BRISA, id: "e-manuel-quellby", firstName: "Manuel", lastName: "Quellby" };
const KEPT: readonly { key: string; said: string; account: RegExp }[] = [
  { key: "coworker", said: "please make a ca for Brisa Talmadge, manuel saw her leave the drawer open", account: /manuel saw her leave the drawer open/ },
  { key: "salon", said: "please make a ca for Brisa Talmadge, she was sent to Kearny and never showed", account: /sent to Kearny and never showed/ },
  { key: "quoted", said: "please make a ca for Brisa Talmadge, she told a guest 'that is not my registr'", account: /'that is not my registr/ },
];

export const NOV14_ACCOUNT_TYPOS_BAR_GUARDS: ReplayCase[] = KEPT.map((wording) => ({
  id: `nov14-account-typos-bar-${wording.key}`,
  title: `"${wording.said}": the card's Observation keeps it as typed`,
  report: "QA's bar, the sibling gate's #772 probe (14 Nov 2026); invented people",
  status: "fixed",
  fixFlags: ["ACCOUNT_TYPOS_FIXED_ENABLED"],
  async run(t: ReplayContext) {
    vi.setSystemTime(new Date("2026-11-14T15:00:00Z"));
    t.directory([...STAFF, BRISA, MANUEL]);
    t.as("salon_director", KEARNEY);
    const card = (await t.thread().say(wording.said)).content;
    const account = /^\*\*Observation of Offense:\*\* ([^\n]*)$/m.exec(card)?.[1] ?? "";
    expect(account, card).toMatch(wording.account);
    expect(account, card).not.toMatch(/manual saw|Kearney and never|my register/);
  },
}));
