import { expect } from "vitest";

import { KEARNEY, STAFF, type ReplayCase } from "./cases";

/** The 2 Nov scan's data-loss reports (P1): what the manager typed must reach the form she keeps. */
export const NOV2_DATA_LOSS_CASES: readonly ReplayCase[] = [
  {
    id: "nov2-p1a-policy-turn-drops-account",
    title: "a turn naming only the policy does not leave the manager's account out of the draft",
    report:
      "\"Details managers had typed were lost. On one form, a redraft replaced her specific note with 'does not describe a specific incident.'\"",
    // "She had 24 tans and was below in … Avg Club …" reads "Avg Club" as another person, so the card's
    // source turns start after it (this-persons-turns) and the draft never sees her account. The shared
    // "is this a person?" guard (plan A) fixes it; add its flag to fixFlags then.
    // Fixed in production: the scan-fix flags on (QA, 3 Nov 2026, 04:20 UTC).
    status: "fixed",
    fixFlags: ["PERSON_GUARD_ENABLED"],
    async run(t) {
      t.directory(STAFF);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      await thread.say("Can you make a written CA for remy calder on performance");
      await thread.say("She had 24 tans and was below in Below in PPTA, LPSVA, Avg Club, CC%, and Spa%");
      await thread.say("the policy would be must see behaviors on woven");
      expect(thread.proposal?.employeeName).toBe("Remy Calder");
      t.draftWrites({});
      await thread.create();
      expect(t.draftPrompts().at(-1), "the draft was written without her account").toContain("24 tans");
    },
  },
  {
    id: "nov2-p1b-next-message-new-draft",
    title: "the next message about the open draft does not start a new draft",
    report:
      "\"Details managers had typed were lost … her next message started a new draft without what she'd typed, and that generic version is the one that got finalized.\"",
    // Fixed in production: the scan-fix flags on (QA, 3 Nov 2026, 04:20 UTC).
    status: "fixed",
    fixFlags: ["OPEN_DRAFT_KEEPS_TURNS_ENABLED"],
    async run(t) {
      t.directory(STAFF);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      await thread.say("I need to create a verbal corrective action form");
      await thread.say("Remy Calder");
      expect(thread.proposal?.employeeName).toBe("Remy Calder");
      t.draftWrites({});
      const first = await thread.create();
      t.typeOnForm(first, { observation: "Remy was below the salon average in October on every metric we track." });
      t.revisionWrites({ observation: "Remy was below the salon average in October on every metric we track — underperformance for the month of October." });
      const reply = await thread.say("underperformance for the month of october");
      expect(t.forms().filter((row) => row.employee_name === "Remy Calder"), "a second draft was started").toHaveLength(1);
      expect(reply.formProposal, "a new card was offered for the open draft").toBeUndefined();
      expect(t.values(first).observation).toContain("below the salon average");
    },
  },
  {
    id: "nov2-p2-new-request-old-incident",
    title: "a new request for the same person is drafted from its own turns, not the earlier incident's",
    report:
      "\"The card showed 'Late Opening' as the policy, but the saved draft says Standards of Conduct. In the same chat, a new late-opening request reused an older trash-and-rugs incident\"",
    // Fixed in production: the scan-fix flags on (QA, 3 Nov 2026, 04:20 UTC).
    status: "fixed",
    fixFlags: ["NEW_REQUEST_OWN_TURNS_ENABLED"],
    async run(t) {
      t.directory(STAFF);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      await thread.say("What does our policy say about attendance?");
      await thread.say("i need another for failure to complete opening duties");
      await thread.say("a CA");
      await thread.say("Rowan Kestrel failed to take trash out and put rugs out untl 12;30pm");
      t.draftWrites({ observation: "Rowan did not take the trash out or put the rugs out until 12:30pm." });
      await thread.create();
      await thread.say("make me a CA for Rowan Kestrel for being late to opening this morning");
      t.draftWrites({});
      await thread.create();
      const second = t.draftPrompts().at(-1) ?? "";
      expect(second).toContain("late to opening");
      expect(second, "the late-opening draft was given the earlier trash-and-rugs incident").not.toMatch(/trash|rugs/i);
    },
  },
];

/*
 * SECOND_REQUEST_OWN_ACCOUNT_ENABLED (QA's Sunny round-4 gate, 8 Nov 2026: nov2-p2 t5, nov2-p4 t2,
 * nov3-card-observation-own-request t3, nov3-open-draft-new-request t3): the later request no longer carries the earlier
 * one's saved policy, and its card lost "**Policy:** Attendance — read from this request." while still citing
 * Attendance p.14. The card says the section this request reads as. The person is the pack's invented Rowan Kestrel.
 */
export const NOV8_SECOND_REQUEST_POLICY_LINE_CASES: ReplayCase[] = [
  {
    id: "nov8-second-request-later-request-policy-line",
    title: "after a first request, \"make me a CA for <A> for being late to opening this morning\": the card says the policy this request reads as, with SECOND_REQUEST_OWN_ACCOUNT on too",
    report: "QA's Sunny round-4 gate (8 Nov 2026): SECOND_REQUEST_OWN_ACCOUNT lost the later request's \"Policy: Attendance — read from this request\"",
    status: "fixed",
    fixFlags: ["SECOND_REQUEST_OWN_ACCOUNT_ENABLED"],
    async run(t) {
      t.directory(STAFF);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      await thread.say("What does our policy say about attendance?");
      await thread.say("i need another for failure to complete opening duties");
      await thread.say("a CA");
      await thread.say("Rowan Kestrel failed to take trash out and put rugs out untl 12;30pm");
      t.draftWrites({ observation: "Rowan did not take the trash out or put the rugs out until 12:30pm." });
      await thread.create();
      const reply = await thread.say("make me a CA for Rowan Kestrel for being late to opening this morning");
      expect(reply.content, `the card's Policy line is gone:\n${reply.content}`).toMatch(/^\*\*Policy:\*\* Attendance — read from this request\./m);
      expect(reply.content, `the card no longer cites the section:\n${reply.content}`).toMatch(/Attendance Policy, JBA Policy Manual p\.14/);
    },
  },
];
