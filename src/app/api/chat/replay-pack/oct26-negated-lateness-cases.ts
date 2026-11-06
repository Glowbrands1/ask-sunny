import { expect, vi } from "vitest";

import { STAFF, KEARNEY, type ReplayCase, type ReplayContext } from "./cases";

/**
 * ============================================================================
 * A LATENESS THE MANAGER DENIES IS NO "OTHER: PUNCTUALITY" TOPIC
 * (NEGATED_LATENESS_TOPIC_ENABLED, default off; rebuilds #304)
 * ============================================================================
 *
 * QA tester 2, 26 Oct 2026, production: "coaching form for <employee>, she was
 * not late today" came back with Topic of Coaching "Other" ticked and "Other:
 * Punctuality". The stand-in drafting model writes what QA saw live; the case
 * proves what the draft route's guards do with it. On production's flags
 * guardCoachingFraming only refuses an Underperformance tick and
 * guardOtherWriteIn (OTHER_WRITE_IN_GUARD_ENABLED) only fills an empty
 * write-in, so the denied topic is saved. With the fix flag the Punctuality
 * topic is cleared and the Details stay as written. The employee is the
 * pack's invented directory person.
 */

const REPORT = 'QA tester 2, 26 Oct 2026, production: "coaching form for <employee>, she was not late today" saved "Other: Punctuality"';
const DRAFTED_DETAILS = "Observed:\nMarnie was not late today.";

function start(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-10-26T15:30:00Z"));
  t.directory(STAFF);
  t.as("salon_director", KEARNEY);
  return t.thread();
}

async function coachingDraft(t: ReplayContext, said: string) {
  const thread = start(t);
  await thread.say(said);
  expect(thread.proposal, "no coaching card").toMatchObject({ templateKey: "coaching", employeeName: "Marnie Holloway" });
  t.draftWrites({ coaching_details: DRAFTED_DETAILS, other_topic: "Punctuality" }, { coaching_topics: ["other"] });
  const id = await thread.create();
  return { values: t.values(id), checked: t.checked(id) };
}

export const OCT26_NEGATED_LATENESS_CASES: ReplayCase[] = [
  {
    id: "oct26-negated-lateness-not-late-today",
    title: '"coaching form for marnie holloway, she was not late today": no Other: Punctuality topic, the Details stay',
    report: REPORT,
    status: { open: "the draft keeps the model's Other: Punctuality; NEGATED_LATENESS_TOPIC_ENABLED (default off) clears it" },
    fixFlags: ["NEGATED_LATENESS_TOPIC_ENABLED"],
    async run(t) {
      const saved = await coachingDraft(t, "coaching form for marnie holloway, she was not late today");
      expect(saved.values.coaching_details ?? "").toContain("not late today");
      expect(saved.values.other_topic ?? "", "a lateness the manager denied is the coaching topic").not.toMatch(/punctual|late/i);
      expect(saved.checked.coaching_topics ?? [], "Other is ticked with no topic the manager gave").not.toContain("other");
    },
  },
  {
    id: "oct26-negated-lateness-real-lateness-kept",
    title: '"coaching form for marnie holloway, she was not late today but was late yesterday": the Punctuality topic stays',
    report: `${REPORT} (NEVER-BREAK: a real lateness alongside a denied one still counts)`,
    status: "fixed",
    fixFlags: ["NEGATED_LATENESS_TOPIC_ENABLED"],
    async run(t) {
      const saved = await coachingDraft(t, "coaching form for marnie holloway, she was not late today but was late yesterday");
      expect(saved.values.other_topic).toBe("Punctuality");
      expect(saved.checked.coaching_topics).toEqual(["other"]);
    },
  },
];
