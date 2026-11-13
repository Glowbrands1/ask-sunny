import { expect, vi } from "vitest";

import { STAFF, KEARNEY, type DirectoryRow, type ReplayCase, type ReplayContext, type ReplayThread } from "./cases";

/**
 * ============================================================================
 * SPELLING CLEANUP ON THE FORM, NEVER ON A FACT (Pau via QA, 13 Nov 2026; SPELLING_CLEANUP_ENABLED)
 * ============================================================================
 *
 * The sanitation chat (this app's 1-star report, 10 Nov 2026 18:49Z, ported from Ask Bubbles),
 * word for word, the person invented. The drafting model is the pack's stand-in: it writes what a model that follows
 * the cleanup rule writes. What is checked is the app's side: the Corrective Action draft is asked to clean up spelling
 * (the rule is in its system), the cleaned text is kept, and the policy is read from it (cleaning left undone is the
 * form's Other box, Pau's ruling); a draft that changes a name is drafted again without the rule.
 */
const REPORT = "Pau via QA, 13 Nov 2026: the sanitation chat — the typo reaches the form";
const BRISA: DirectoryRow = {
  id: "e-brisa-talmadge-spell",
  firstName: "Brisa",
  lastName: "Talmadge",
  preferredFirstName: null,
  employmentStatus: "active",
  salonIds: ["loc-0309"],
  positionName: "Tanning Consultant",
};
const SAID = "please make a ca for Brisa Talmadge for not doing th e10 minute sanitaion";
const RULE = "SPELLING, SPACING AND CAPITALS";

function start(t: ReplayContext): ReplayThread {
  vi.setSystemTime(new Date("2026-11-10T18:49:00Z"));
  t.directory([...STAFF, BRISA]);
  t.as("salon_director", KEARNEY);
  return t.thread();
}

export const NOV13_SPELLING_CLEANUP_CASES: ReplayCase[] = [
  {
    id: "nov13-spelling-cleanup-sanitation",
    title: `"${SAID}": the CA draft is written "not doing the 10-minute sanitation" and cites Other (cleaning left undone)`,
    report: REPORT,
    status: { open: "the CA draft has no cleanup rule, and the typed \"sanitaion\" reads as no cleaning: Standards of Conduct" },
    fixFlags: ["SPELLING_CLEANUP_ENABLED"],
    async run(t) {
      const thread = start(t);
      await thread.say(SAID);
      t.draftWrites({ observation: "Observed:\nBrisa Talmadge was not doing the 10-minute sanitation." }, { offense_type: ["standards_of_conduct"] });
      const id = await thread.create();
      const systems = t.draftSystems?.() ?? [];
      expect(systems.at(-1) ?? "", "the Corrective Action draft is not asked to clean up spelling").toContain(RULE);
      const values = t.values(id);
      expect(values.observation, "the cleaned account").toContain("not doing the 10-minute sanitation");
      expect(values.policy_violated ?? "", "the policy").toBe("Other");
      expect(t.checked(id).offense_type ?? [], "Type of Offense").toEqual(["other"]);
    },
  },
  {
    id: "nov13-spelling-cleanup-name-changed-redrafts",
    title: "a cleaned draft that respells the employee's name is drafted again without the cleanup rule (the manager's text)",
    report: `${REPORT}: the hard limit — a cleanup never changes a name, date, number or quote`,
    // Only with the flag: production has no cleanup, so nothing is checked and nothing is drafted again.
    status: { open: "no cleanup check in production" },
    fixFlags: ["SPELLING_CLEANUP_ENABLED"],
    async run(t) {
      const thread = start(t);
      await thread.say(SAID);
      t.draftWrites({ observation: "Observed:\nBrisa Talmage was not doing the 10-minute sanitation." });
      await thread.create();
      const systems = t.draftSystems?.() ?? [];
      expect(systems.length, "drafted once only").toBeGreaterThanOrEqual(2);
      expect(systems.at(-2) ?? "", "the first draft had the rule").toContain(RULE);
      expect(systems.at(-1) ?? "", "the second draft still had the rule").not.toContain(RULE);
    },
  },
];
