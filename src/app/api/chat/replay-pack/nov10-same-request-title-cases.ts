import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayCase } from "./cases";

/**
 * ============================================================================
 * "NOW ONE FOR <B>, <TITLE>, LATE TODAY" GIVES <B> A CARD (QA's B22-2, 25 Oct 2026, #233; the October triage's #2)
 * ============================================================================
 *
 * QA's wording, with QA's own placeholder names ("Test Employee", "Test Employee Two"). After Test Employee's CA, "now
 * one for Test Employee Two, tanning consultant, late today" kept the card Test Employee's (card on screen) or said
 * "I haven't changed the Corrective Action Form for Test Employee" (after Create): no card for Test Employee Two, in
 * every casing (the October triage, 10 Nov 2026: 4 of 4 runs). "now one for Test Employee Two for being late today"
 * already gave the card (SAME_REQUEST_OTHER_PERSON_ENABLED). SAME_REQUEST_TITLE_ACCOUNT_ENABLED. Supersedes #233's
 * no-card half; A's facts carried onto B's card are the cross-person fix (S#236).
 */

const person = (id: string, firstName: string, lastName: string): DirectoryRow => ({
  id, firstName, lastName, preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0309"], positionName: "Tanning Consultant",
});
const TEST_EMPLOYEE = person("e-srt-te", "Test", "Employee");
const TEST_EMPLOYEE_TWO = person("e-srt-te2", "Test", "Employee Two");

const SAID = "now one for Test Employee Two, tanning consultant, late today";
const casings = [
  ["sentence", SAID],
  ["lower", SAID.toLowerCase()],
  ["caps", SAID.toUpperCase()],
] as const;

export const NOV10_SAME_REQUEST_TITLE_CASES: ReplayCase[] = casings.flatMap(([casing, said]) =>
  [false, true].map((created): ReplayCase => ({
    id: `nov10-same-request-title-${casing}-${created ? "after-create" : "card-on-screen"}`,
    title: `${created ? "with Test Employee's CA created" : "with Test Employee's CA card on screen"}, "${said}": Test Employee Two's own card; Test Employee's unchanged`,
    report: 'QA B22-2, 25 Oct 2026 (#233; the October triage, 10 Nov 2026): "now one for Test Employee Two, tanning consultant, late today" gives no card',
    status: { open: "no card for Test Employee Two: Test Employee's card is kept, or \"I haven't changed the Corrective Action Form for Test Employee\"" },
    fixFlags: ["SAME_REQUEST_TITLE_ACCOUNT_ENABLED"],
    async run(t) {
      vi.setSystemTime(new Date("2026-10-26T15:00:00Z"));
      t.directory([...STAFF, TEST_EMPLOYEE, TEST_EMPLOYEE_TWO]);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      await thread.say("I need a corrective action for Test Employee, she was late opening the salon on Monday");
      let first: string | null = null;
      let before = "";
      if (created) {
        t.draftWrites({ observation: "Observed:\nTest Employee opened the salon late on Monday." });
        first = await thread.create();
        before = JSON.stringify({ values: t.values(first), checked: t.checked(first) });
      }
      const reply = await thread.say(said);
      expect(reply.formUpdate?.instanceId ?? null, "Test Employee's form was written over").toBeNull();
      expect(reply.formProposal ?? null, `no card for Test Employee Two:\n${reply.content}`).toMatchObject({ templateKey: "dpoa", employeeName: "Test Employee Two" });
      expect(reply.content, "the title is read as the account").not.toMatch(/Observation of Offense:\*\*[^\n]*tanning consultant/i);
      if (first) expect(JSON.stringify({ values: t.values(first), checked: t.checked(first) }), "Test Employee's form changed").toBe(before);
      t.draftWrites({ observation: "Observed:\nTest Employee Two was late today." });
      const second = await thread.create();
      if (first) expect(second, "Test Employee Two's card reopened Test Employee's form").not.toBe(first);
      expect(t.values(second).employee_name ?? "").toBe("Test Employee Two");
    },
  })),
);
