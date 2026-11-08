import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayCase } from "./cases";

/**
 * ============================================================================
 * A COACHING FORM ASKED FOR WELL AFTER A CORRECTIVE ACTION SAYS WHERE THE NAME CAME FROM (QA's round-6 item, 8 Nov
 * 2026; KEPT_REQUEST_SAME_FORM_ENABLED)
 * ============================================================================
 *
 * The production conversation of 20 Oct 2026 (the person invented; the same turns as
 * corrective-action-chat-edits-e2e "carries … into a Coaching Form asked for well after she was named"). Since QA's
 * flip 9, REQUEST_KEPT_IN_WINDOW kept the Corrective Action request in the Coaching card's window: the card still
 * named the person, but no longer said "I took <A> from earlier in this conversation — if this form is for somebody
 * else, tell me who." (a silent carry-over).
 */
const PERSON: DirectoryRow = {
  id: "e-briar-castellane",
  firstName: "Briar",
  lastName: "Castellane",
  preferredFirstName: null,
  employmentStatus: "active",
  salonIds: ["loc-0309"],
  positionName: "Tanning Consultant",
};

/** The invented person of this file (a function: the registry reads exported arrays as cases). */
export function keptRequestSameFormPeople(): readonly DirectoryRow[] {
  return [PERSON];
}

const TURNS = [
  "create corrective action for Briar Castellane for Late Opening from the policy manual. It is a verbal warning",
  "can you add late opening policy to the direct policy section of this form",
  "I have independently verified and the policy is correct",
  "what does the manual say about reimbursing the company?",
  "how much is the late opening fee?",
  "and who pays for client restitution?",
  "ok thanks",
] as const;

const FIX = ["KEPT_REQUEST_SAME_FORM_ENABLED", "NEXT_PUBLIC_KEPT_REQUEST_SAME_FORM_ENABLED", "CARRIED_PERSON_NOTICE_ENABLED"];

function start(t: Parameters<ReplayCase["run"]>[0]) {
  vi.setSystemTime(new Date("2026-10-20T15:00:00Z"));
  t.directory([...STAFF, PERSON]);
  t.as("salon_director", KEARNEY);
  return t.thread();
}

export const NOV8_KEPT_REQUEST_SAME_FORM_CASES: ReplayCase[] = [
  {
    id: "nov8-kept-request-coaching-says-where-the-name-came-from",
    title: "\"Create a Coaching Form from this conversation.\" well after a Corrective Action for <A>: the card is <A>'s and says the name came from earlier",
    report: "QA's round-6 item, 8 Nov 2026: with REQUEST_KEPT_IN_WINDOW on, the carried person's notice is gone (a silent carry-over)",
    // Changed on purpose (8 Nov 2026): fixed in production by KEPT_REQUEST_SAME_FORM_ENABLED, QA round 6, 8 Nov 2026; it now holds with production's flags.
    status: "fixed",
    // On the route, production's INTENT_EXTRACTION and SLOT_RETENTION drop the notice as well as REQUEST_KEPT_IN_WINDOW
    // (coding 2's bisect of the 232 live flags): KEPT_REQUEST_SAME_FORM keeps the CA request out of the Coaching card's
    // window, and CARRIED_PERSON_NOTICE says where the person came from, whichever reader put them on the card.
    fixFlags: FIX,
    async run(t) {
      const thread = start(t);
      for (const turn of TURNS) await thread.say(turn);
      const reply = await thread.say("Create a Coaching Form from this conversation.");
      expect(thread.proposal?.templateKey, `no Coaching card:\n${reply.content}`).toBe("coaching");
      expect(thread.proposal?.employeeName, `the card is for someone else:\n${reply.content}`).toBe("Briar Castellane");
      expect(reply.content, `a silent carry-over:\n${reply.content}`).toMatch(/I took \*\*Briar Castellane\*\* from earlier in this conversation/);
      // "Late Opening Policy, JBA Policy Manual p.15" on this Coaching card is not the window: production's POLICY_CITATION,
      // ATTENDANCE_POLICY_CITATION, GROUNDED_ENTITIES and INTENT_EXTRACTION cite the policy the conversation discussed
      // (coding 2's bisect, 8 Nov 2026), so it is not asserted here (QA to decide).
    },
  },
  {
    id: "nov8-kept-request-coaching-named-now-no-notice",
    title: "must not change: \"Create a Coaching Form for <A> from this conversation.\" names the person in its own turn, so no notice",
    report: "QA's round-6 item, 8 Nov 2026 (the negative)",
    status: "fixed",
    fixFlags: FIX,
    async run(t) {
      const thread = start(t);
      for (const turn of TURNS) await thread.say(turn);
      const reply = await thread.say("Create a Coaching Form for Briar Castellane from this conversation.");
      expect(thread.proposal?.employeeName, `the card is for someone else:\n${reply.content}`).toBe("Briar Castellane");
      expect(reply.content, `a notice for a name typed in this very turn:\n${reply.content}`).not.toMatch(/from earlier in this conversation/);
    },
  },
  {
    id: "nov8-kept-request-ca-named-recently-no-notice",
    title: "must not change: a Corrective Action asked for two turns after the person was named says nothing about earlier turns",
    report: "QA's round-6 item, 8 Nov 2026 (the negative)",
    status: "fixed",
    fixFlags: FIX,
    async run(t) {
      const thread = start(t);
      await thread.say("Briar Castellane opened the salon 40 minutes late on 10/19");
      await thread.say("what does the manual say about late opening?");
      const reply = await thread.say("Create a Corrective Action Form from this conversation.");
      expect(thread.proposal?.employeeName, `the card is for someone else:\n${reply.content}`).toBe("Briar Castellane");
      expect(reply.content, `a notice for a name in the last turns:\n${reply.content}`).not.toMatch(/from earlier in this conversation/);
    },
  },
];
