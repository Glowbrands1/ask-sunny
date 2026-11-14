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
    // Changed on purpose (14 Nov 2026): back to OPEN. SPELLING_CLEANUP was rolled back in production after the 38g live test.
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
    // Changed on purpose (14 Nov 2026): back to OPEN. SPELLING_CLEANUP was rolled back in production after the 38g live test.
    status: { open: "no cleanup check in production" },
    fixFlags: ["SPELLING_CLEANUP_ENABLED"],
    async run(t) {
      const thread = start(t);
      await thread.say(SAID);
      t.draftWrites({ observation: "Observed:\nBrisa Talmage was not doing the 10-minute sanitation." });
      await thread.create();
      const systems = t.draftSystems?.() ?? [];
      expect(systems.length, "drafted once only").toBeGreaterThanOrEqual(2);
      // A draft call with the rule, then the fallback without it. Any never-blank retry after it is also without it.
      const ruled = systems.findIndex((system) => system.includes(RULE));
      expect(ruled, "the first draft had the rule").toBeGreaterThanOrEqual(0);
      expect(systems.slice(ruled + 1).length, "drafted once only").toBeGreaterThan(0);
      expect(systems.slice(ruled + 1).every((system) => !system.includes(RULE)), "the fallback still had the rule").toBe(true);
    },
  },
  {
    id: "nov13-spelling-cleanup-quote-kept-as-typed",
    title: "QA's guard: a quoted phrase with a typo (she said \"i dont care\") stays exactly as typed; a draft that mends it is drafted again without the rule",
    report: `${REPORT}: QA's guard, 13 Nov 2026 — a quote is never cleaned up`,
    // Only with the flag: production has no cleanup, so nothing is checked and nothing is drafted again.
    // Changed on purpose (14 Nov 2026): back to OPEN. SPELLING_CLEANUP was rolled back in production after the 38g live test.
    status: { open: "no cleanup check in production" },
    fixFlags: ["SPELLING_CLEANUP_ENABLED"],
    async run(t) {
      const thread = start(t);
      await thread.say('please make a ca for Brisa Talmadge, a guest asked her for help and she said "i dont care" on 11/9');
      // The stand-in writes what a model that mended the quote would write: the check must refuse it.
      t.draftWrites({ observation: 'Observed:\nWhen a guest asked Brisa Talmadge for help, she said "I don\'t care."' });
      await thread.create();
      const systems = t.draftSystems?.() ?? [];
      const ruled = systems.findIndex((system) => system.includes(RULE));
      expect(ruled, "the first draft had the rule").toBeGreaterThanOrEqual(0);
      expect(systems.slice(ruled + 1).length, "the mended quote was not drafted again without the rule").toBeGreaterThan(0);
      expect(systems.slice(ruled + 1).every((system) => !system.includes(RULE)), "the fallback still had the rule").toBe(true);
    },
  },
  {
    id: "nov13-spelling-cleanup-quote-as-typed-saved",
    title: "QA's guard: a draft that keeps the quoted phrase as typed (\"i dont care\") is saved as written, in one call",
    report: `${REPORT}: QA's guard, 13 Nov 2026`,
    // Changed on purpose (14 Nov 2026): back to OPEN. SPELLING_CLEANUP was rolled back in production after the 38g live test.
    status: { open: "no cleanup rule in production" },
    fixFlags: ["SPELLING_CLEANUP_ENABLED"],
    async run(t) {
      const thread = start(t);
      await thread.say('please make a ca for Brisa Talmadge, a guest asked her for help and she said "i dont care" on 11/9');
      const before = (t.draftSystems?.() ?? []).length;
      t.draftWrites({ observation: 'Observed:\nWhen a guest asked Brisa Talmadge for help on November 9, 2026, she said "i dont care".' });
      const id = await thread.create();
      const systems = (t.draftSystems?.() ?? []).slice(before);
      expect(systems.length, "drafted once").toBe(1);
      expect(systems[0] ?? "").toContain(RULE);
      expect(t.values(id).observation ?? "", "the quote as typed").toContain('"i dont care"');
    },
  },
  {
    id: "nov13-spelling-cleanup-fallback-checked-again",
    title: "QA's safety ruling: when the fallback draft also respells the name, that field keeps what the form held (or nothing), never the chat turn",
    report: `${REPORT}: QA's safety ruling (Gate-Sunny-3, 13 Nov 2026) — the fallback draft is checked again`,
    // Only with the flag: production has no cleanup, so the respelled name is saved as drafted.
    // Changed on purpose (14 Nov 2026): back to OPEN. SPELLING_CLEANUP was rolled back in production after the 38g live test.
    status: { open: "no cleanup check in production" },
    fixFlags: ["SPELLING_CLEANUP_ENABLED"],
    async run(t) {
      const thread = start(t);
      await thread.say(SAID);
      // The stand-in writes the same respelled name on the first draft and on the fallback.
      t.draftWrites({ observation: "Observed:\nBrisa Talmage was not doing the 10-minute sanitation." });
      const id = await thread.create();
      const systems = t.draftSystems?.() ?? [];
      expect(systems.at(-1) ?? "", "the fallback was not drafted without the rule").not.toContain(RULE);
      const observation = t.values(id).observation ?? "";
      expect(observation, "the respelled name was saved").not.toMatch(/\bTalmage\b/);
      // Gate-Sunny-3 (13 Nov 2026): the field's fallback is its previous value or nothing, never the manager's chat turn.
      expect(observation, "the chat turn was saved as the Observation").not.toMatch(/please make a ca/i);
    },
  },
  {
    id: "nov13-spelling-cleanup-possessive-name-kept",
    title: "a draft writing the employee's full name as a possessive (\"Marnie Holloway's drawer\") keeps the name: one draft call, saved as written",
    report: `${REPORT}: Gate-Sunny-3, 13 Nov 2026 — a possessive of the full name read as a changed name, and the draft was discarded`,
    status: "fixed",
    fixFlags: ["SPELLING_CLEANUP_ENABLED"],
    async run(t) {
      vi.setSystemTime(new Date("2026-11-10T18:49:00Z"));
      t.directory([...STAFF]);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      await thread.say("please make a ca for marnie holloway, she was late on 11/1/26 and left the drawer open");
      const before = (t.draftSystems?.() ?? []).length;
      t.draftWrites({ observation: "Observed:\nMarnie Holloway's drawer was left open after she arrived late on 11/1/26." });
      const id = await thread.create();
      expect((t.draftSystems?.() ?? []).length - before, "drafted again: the possessive was read as a changed name").toBe(1);
      expect(t.values(id).observation ?? "", "the model's draft was discarded").toContain("Marnie Holloway's drawer was left open");
    },
  },
];
