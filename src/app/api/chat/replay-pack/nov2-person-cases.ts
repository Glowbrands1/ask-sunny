import { expect } from "vitest";

import { KEARNEY, STAFF, type ReplayCase } from "./cases";

/** The 2 Nov scan's "read as a person" reports (P6, P7), and the rule that a roster person is never blocked. */
export const NOV2_PERSON_CASES: readonly ReplayCase[] = [
  {
    id: "nov2-p6-must-see-behaviors",
    title: "\"CA for must see behaviors\" is not a form for a person called Must See Behaviors",
    report: "\"In 'CA for must see behaviors,' the bot read 'Must' as a name.\"",
    // Fixed in production: the scan-fix flags on (QA, 3 Nov 2026, 04:20 UTC).
    status: "fixed",
    fixFlags: ["PERSON_GUARD_ENABLED"],
    async run(t) {
      t.directory(STAFF);
      t.as("salon_director", KEARNEY);
      const reply = await t.thread().say("can you create a CA for must see behaviors");
      expect(String(reply.formProposal?.employeeName ?? "")).not.toMatch(/must|behavior/i);
    },
  },
  {
    id: "nov2-p7-practice",
    title: "\"a mock coaching form for practice\" is not a form for a person called Practice",
    report: "\"'Practice' was saved as an employee name on a practice coaching form.\"",
    // Fixed in production: the scan-fix flags on (QA, 3 Nov 2026, 04:20 UTC).
    status: "fixed",
    fixFlags: ["PERSON_GUARD_ENABLED"],
    async run(t) {
      t.directory(STAFF);
      t.as("salon_director", KEARNEY);
      const reply = await t.thread().say("Give me a mock coaching form for practice");
      expect(String(reply.formProposal?.employeeName ?? "")).not.toMatch(/practice/i);
    },
  },
  {
    id: "person-guard-roster-wins",
    title: "somebody on the roster named like a listed word is still that person",
    report: "QA, 3 Nov 2026: the roster rule must hold for a real-looking name that equals a listed word",
    status: "fixed",
    fixFlags: ["PERSON_GUARD_ENABLED"],
    async run(t) {
      t.directory([
        ...STAFF,
        { id: "e-8", firstName: "Mark", lastName: "Practice", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0309"], positionName: "Tanning Consultant" },
        { id: "e-9", firstName: "Grace", lastName: "Behaviors", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0309"], positionName: "Tanning Consultant" },
      ]);
      t.as("salon_director", KEARNEY);
      const mark = await t.thread().say("coaching form for Mark Practice, he was late today");
      expect(mark.formProposal?.employeeName).toBe("Mark Practice");
      const grace = await t.thread().say("CA for Grace Behaviors, she was late today");
      expect(grace.formProposal?.employeeName).toBe("Grace Behaviors");
    },
  },
];

/** P6: the metric refusal said three times, and the speaker's manager read as the employee's title. */
export const NOV2_METRIC_LOOP_CASES: readonly ReplayCase[] = [
  {
    id: "nov2-p6-dm-title",
    title: "\"my DM told me she gets one this month\" does not make the employee a District Manager",
    report: "\"… and listed a Tanning Consultant's job title as District Manager.\"",
    // Fixed in production: the scan-fix flags on (QA, 3 Nov 2026, 04:20 UTC).
    status: "fixed",
    fixFlags: ["TITLE_NOT_SPEAKERS_MANAGER_ENABLED"],
    async run(t) {
      t.directory(STAFF);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      await thread.say("Marnie Holloway was below the company average last month in the following categories; PPTA, LPSVA, Club Close%, and spa %");
      await thread.say("can you make a verbal warning Ca");
      if (!thread.proposal) await thread.say("yes");
      const reply = await thread.say("my DM told me she gets one this month");
      expect(reply.formProposal?.employeeRole ?? null).not.toBe("District Manager");
      expect(reply.content).not.toMatch(/\*\*(?:Position|Job title):\*\*\s*District Manager/i);
    },
  },
  {
    id: "nov2-p6-refusal-no-repeat",
    title: "the same refusal is never said twice in a row; the second time says what moves it on",
    report: "\"It also gave the same refusal 3 times\" (\"A low number on its own isn't what our progression escalates on …\")",
    // Fixed in production: the scan-fix flags on (QA, 3 Nov 2026, 04:20 UTC).
    status: "fixed",
    fixFlags: ["REFUSAL_NO_REPEAT_ENABLED"],
    async run(t) {
      t.directory(STAFF);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      const refusal =
        "A low number on its own isn't what our progression escalates on, so I won't open formal corrective action off a metric. Underperformance enters the ladder at coaching, and it reaches formal accountability through what happens after that.\n\nWhich would help?";
      t.modelSays(refusal);
      const first = await thread.say("what does the manual say about metrics?");
      const second = await thread.say("my DM told me she gets one this month");
      t.modelSays(null);
      const opening = (text: string) => text.split(/\n\s*\n/)[0]!.trim();
      expect(opening(second.content)).not.toBe(opening(first.content));
      expect(second.content).toMatch(/coaching/i);
    },
  },
];
