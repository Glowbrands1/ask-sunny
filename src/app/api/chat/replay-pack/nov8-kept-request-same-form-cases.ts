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

export const NOV8_KEPT_REQUEST_SAME_FORM_CASES: ReplayCase[] = [
  {
    id: "nov8-kept-request-coaching-says-where-the-name-came-from",
    title: "\"Create a Coaching Form from this conversation.\" well after a Corrective Action for <A>: the card is <A>'s and says the name came from earlier",
    report: "QA's round-6 item, 8 Nov 2026: with REQUEST_KEPT_IN_WINDOW on, the carried person's notice is gone (a silent carry-over)",
    status: { open: "the Coaching card names the person with no \"I took … from earlier in this conversation\"" },
    fixFlags: ["KEPT_REQUEST_SAME_FORM_ENABLED", "NEXT_PUBLIC_KEPT_REQUEST_SAME_FORM_ENABLED"],
    // On the route, production's INTENT_EXTRACTION and SLOT_RETENTION each drop the notice too (coding 2's bisect, 8 Nov
    // 2026); this pair fixes only REQUEST_KEPT_IN_WINDOW's part (proven in corrective-action-chat-edits-e2e). Open until
    // the notice is decided from the manager's own window (QA deciding).
    fixStatus: { open: "INTENT_EXTRACTION and SLOT_RETENTION also drop the notice on the route" },
    async run(t) {
      vi.setSystemTime(new Date("2026-10-20T15:00:00Z"));
      t.directory([...STAFF, PERSON]);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      for (const turn of TURNS) await thread.say(turn);
      const reply = await thread.say("Create a Coaching Form from this conversation.");
      expect(thread.proposal?.templateKey, `no Coaching card:\n${reply.content}`).toBe("coaching");
      expect(thread.proposal?.employeeName, `the card is for someone else:\n${reply.content}`).toBe("Briar Castellane");
      expect(reply.content, `a silent carry-over:\n${reply.content}`).toMatch(/I took \*\*Briar Castellane\*\* from earlier in this conversation/);
    },
  },
];
