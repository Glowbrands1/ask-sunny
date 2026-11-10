import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase } from "./cases";
import { keptRequestSameFormPeople } from "./nov8-kept-request-same-form-cases";

/**
 * QUESTIONS TO THE APP ARE NEVER THE ACCOUNT (QA's Sunny round-6 solo gate, 8 Nov 2026; gate runner 2). With
 * SECOND_REQUEST_OWN_ACCOUNT_ENABLED on, "Create a Coaching Form from this conversation." after a chat of policy
 * questions kept the earlier request's turns as its account, and the card's Observation read: "Late Opening from the
 * policy manual. I have independently verified and the policy is correct what does the manual say about reimbursing
 * the company? how much is the late opening fee? and who pays for client restitution?". The production conversation of
 * nov8-kept-request-same-form (its invented person). With the flag off there is no Observation line; with it on, the
 * line never holds a question, a confirmation of the policy, a sentence that only names the policy or a closing
 * "ok thanks": no Observation line, as with the flag off, and the policy stays on its own line.
 */
const TURNS = [
  "create corrective action for Briar Castellane for Late Opening from the policy manual. It is a verbal warning",
  "can you add late opening policy to the direct policy section of this form",
  "I have independently verified and the policy is correct",
  "what does the manual say about reimbursing the company?",
  "how much is the late opening fee?",
  "and who pays for client restitution?",
  "ok thanks",
] as const;

const QUESTION_OR_CHATTER = /\?|what does the manual say|how much is|who pays|independently verified|policy is correct|ok thanks/i;

export const NOV8_QUESTIONS_NOT_ACCOUNT_CASES: ReplayCase[] = (["Create a Coaching Form from this conversation.", "Create a Coaching Form for Briar Castellane from this conversation."] as const).map(
  (asked, index): ReplayCase => ({
    id: `nov8-questions-not-account-coaching-${index === 0 ? "from-conversation" : "named"}`,
    title: `"${asked}" after policy questions: the card's Observation never holds the manager's questions to the app`,
    report: "QA's Sunny round-6 solo gate (8 Nov 2026): the Coaching card's Observation pasted the manager's policy questions",
    // production-flags.json lists round 6 (SECOND_REQUEST_OWN_ACCOUNT on): fails before the fix, holds after.
    status: "fixed",
    fixFlags: ["SECOND_REQUEST_OWN_ACCOUNT_ENABLED"],
    async run(t) {
      vi.setSystemTime(new Date("2026-10-20T15:00:00Z"));
      t.directory([...STAFF, ...keptRequestSameFormPeople()]);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      for (const turn of TURNS) await thread.say(turn);
      const reply = await thread.say(asked);
      expect(thread.proposal, `no Coaching card:\n${reply.content}`).toMatchObject({ employeeName: "Briar Castellane" });
      const observation = /\*\*Observation of Offense:\*\*[^\n]*/.exec(reply.content)?.[0] ?? "";
      expect(observation, `the Observation holds the manager's questions to the app:\n${reply.content}`).not.toMatch(QUESTION_OR_CHATTER);
      // QA (8 Nov 2026): "Late Opening from the policy manual." only points to the policy, so there is no Observation line,
      // as with the flag off; the policy stays on its own line.
      expect(observation, `the Observation only names the policy:\n${reply.content}`).toBe("");
      expect(reply.content, `the policy line was lost:\n${reply.content}`).toMatch(/Late Opening Policy, JBA Policy Manual p\.15/);
    },
  }),
);
