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
    status: { open: "the card cites Care and Cleaning p.21; the draft saves no matching policy" },
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
    status: { open: "the Action Plan names Care and Cleaning (card) or \"the Other policy\" (draft)" },
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
    status: key === "policy" ? ("fixed" as const) : { open: "a named Care and Cleaning policy reads as Other" },
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
