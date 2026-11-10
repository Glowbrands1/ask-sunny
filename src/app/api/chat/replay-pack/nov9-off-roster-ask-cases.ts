import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";

/**
 * ============================================================================
 * "CREATE A COACHING FORM FOR <FULL NAME NOT ON THE ROSTER>": ASKED ABOUT BEFORE A CARD (QA, the Bubbles round-6 live
 * test, 9 Nov 2026; pre-existing: byte-identical with round 5)
 * ============================================================================
 *
 * Today: a ready Coaching Form card for the typed name, no question. OFF_ROSTER_ASK_BEFORE_CARD_ENABLED
 * (`forms/off-roster-ask.ts`): a salon manager is asked "I can't find <name> on your roster — is that the right name,
 * or are they at another salon?" first; OFF_ROSTER_CONFIRM's "use <name>" still makes the card; a district manager
 * is never held up. The name is invented and on no directory (Wrenna Pollard); the pack's Marnie Holloway is on it.
 */
/** The question runs only beside OFF_ROSTER_CONFIRM (off in this app's production): QA flips the two together. */
const FIX = ["OFF_ROSTER_ASK_BEFORE_CARD_ENABLED", "OFF_ROSTER_CONFIRM_ENABLED"];
const REPORT = "QA's round-6 live test in the sibling app (9 Nov 2026): \"create a coaching form for <full name not on the roster>\" gave a card with no question";
const REPORTED = "create a coaching form for Wrenna Pollard";
const ASKS = /I can't find \*\*Wrenna Pollard\*\* on your roster — is that the right name, or are they at another salon\?/;
const GLOBAL = { level: "global", primaryAreaId: null, alsoCoversAreaIds: [] };

function start(t: ReplayContext, role = "salon_director", scope: unknown = KEARNEY) {
  vi.setSystemTime(new Date("2026-11-07T16:00:00Z"));
  t.directory(STAFF);
  t.as(role, scope);
  return t.thread();
}

export const NOV9_OFF_ROSTER_ASK_CASES: ReplayCase[] = [
  {
    id: "nov9-off-roster-ask-before-card",
    title: "QA's \"create a coaching form for <full name not on the roster>\" (a salon manager): asked about before any card",
    report: REPORT,
    // Changed on purpose (9 Nov 2026): OFF_ROSTER_CONFIRM and OFF_ROSTER_ASK_BEFORE_CARD are ON in production (Pau's "on" via QA); it holds with production's flags.
    status: "fixed",
    fixFlags: FIX,
    async run(t) {
      const thread = start(t);
      const { content } = await thread.say(REPORTED);
      expect(content, `the roster question is not asked:\n${content}`).toMatch(ASKS);
      expect(thread.proposal?.employeeName ?? null, `a card is shown before the question is answered:\n${content}`).toBeNull();
    },
  },
  {
    id: "nov9-off-roster-ask-then-name",
    title: "after the question, the name typed again makes the card, marked not from Woven",
    report: REPORT,
    // Changed on purpose (9 Nov 2026): OFF_ROSTER_CONFIRM and OFF_ROSTER_ASK_BEFORE_CARD are ON in production (Pau's "on" via QA); it holds with production's flags.
    status: "fixed",
    fixFlags: FIX,
    async run(t) {
      const thread = start(t);
      const first = await thread.say(REPORTED);
      expect(first.content).toMatch(ASKS);
      const { content } = await thread.say("Wrenna Pollard");
      expect(thread.proposal?.employeeName ?? null, `no card after the name again:\n${content}`).toBe("Wrenna Pollard");
      expect(content, `asked again:\n${content}`).not.toMatch(ASKS);
    },
  },
  {
    id: "nov9-off-roster-ask-then-use",
    title: "the question carries OFF_ROSTER_CONFIRM's offer, and \"use Wrenna Pollard\" makes the card, marked not from Woven",
    report: REPORT,
    // Changed on purpose (9 Nov 2026): OFF_ROSTER_CONFIRM and OFF_ROSTER_ASK_BEFORE_CARD are ON in production (Pau's "on" via QA); it holds with production's flags.
    status: "fixed",
    fixFlags: FIX,
    async run(t) {
      const thread = start(t);
      const first = await thread.say(REPORTED);
      expect(first.content).toMatch(ASKS);
      expect(first.content, `OFF_ROSTER_CONFIRM's offer is missing:\n${first.content}`).toMatch(/reply \*\*use Wrenna Pollard\*\*/);
      const { content } = await thread.say("use Wrenna Pollard");
      expect(thread.proposal?.employeeName ?? null, `no card after "use <name>":\n${content}`).toBe("Wrenna Pollard");
      expect(content, `asked again:\n${content}`).not.toMatch(ASKS);
    },
  },
  {
    id: "nov9-off-roster-ask-district-not-held",
    title: "must not change: a district manager's card for the same name comes as today",
    report: REPORT,
    status: "fixed",
    fixFlags: FIX,
    async run(t) {
      const thread = start(t, "district_manager", GLOBAL);
      const { content } = await thread.say(REPORTED);
      expect(content, `a district manager is held up:\n${content}`).not.toMatch(ASKS);
      expect(thread.proposal?.employeeName ?? null).toBe("Wrenna Pollard");
    },
  },
  {
    id: "nov9-off-roster-ask-roster-name",
    title: "must not change: a full name on the roster (\"Marnie Holloway\") gets its card, no question",
    report: REPORT,
    status: "fixed",
    fixFlags: FIX,
    async run(t) {
      const thread = start(t);
      const { content } = await thread.say("create a coaching form for Marnie Holloway");
      expect(content).not.toMatch(/I can't find/);
      expect(thread.proposal?.employeeName ?? null).toBe("Marnie Holloway");
    },
  },
  {
    id: "nov9-off-roster-ask-legal-name",
    title: "must not change: a roster person with a preferred name, typed by the legal name (\"tamsin wexley\" for \"Tammy Wexley\"), gets the card, no question",
    report: "The off-roster switch-on, 9 Nov 2026 (the sibling app's gate): the legal name of a roster person with a preferred name was asked about",
    status: "fixed",
    fixFlags: FIX,
    async run(t) {
      vi.setSystemTime(new Date("2026-11-07T16:00:00Z"));
      t.directory([...STAFF, { id: "e-tamsin-wexley-legal", firstName: "Tamsin", lastName: "Wexley", preferredFirstName: "Tammy", employmentStatus: "active", salonIds: ["loc-0309"], positionName: "Tanning Consultant" }]);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      const { content } = await thread.say("create a CA for tamsin wexley, verbal, she was late on 10-20-26");
      expect(content, `a roster person is asked about:\n${content}`).not.toMatch(/I can't find/);
      expect(thread.proposal?.employeeName ?? "", `no card for her:\n${content}`).toMatch(/Wexley/i);
    },
  },
];
