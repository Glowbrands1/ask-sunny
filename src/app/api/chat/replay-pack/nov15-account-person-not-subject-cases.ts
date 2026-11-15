import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";
import { lastResult, loopStandIn } from "./loop-stand-in";

/**
 * ============================================================================
 * A PERSON NAMED INSIDE THE ACCOUNT IS NEVER THE FORM'S SUBJECT (QA's J11, 15 Nov 2026)
 * ============================================================================
 *
 * Batch J2's case: after "change observation of offense to: <B> completed onboarding with new hire <C> on 9-28-26. …",
 * Create refused the card: "This proposal is out of date: the conversation now says the form is for <C>, not <B>."
 * A second person named inside the account (a new hire, a witness, a guest) is never the subject when the card's own
 * person is stated. People invented: Juno Paxton (STAFF's), the new hire Corran Vale.
 */
const FLAG = "ACCOUNT_PERSON_NOT_SUBJECT_ENABLED";
const REQUEST = "create a CA for salon director, juno paxton for violating the standards of conduct";
const DICTATED = "change observation of offense to: Juno completed onboarding with new hire Corran Vale on 9-28-26. As of 10-16-26 Corran had not acknowledged onboarding policies in Woven that should have been completed during onboarding.";

function start(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-11-15T05:00:00Z"));
  t.directory(STAFF);
  t.as("salon_director", KEARNEY);
  return t.thread();
}

export const NOV15_ACCOUNT_PERSON_NOT_SUBJECT_CASES: ReplayCase[] = [
  {
    id: "nov15-j11-new-hire-in-the-account-not-the-subject",
    title: "J11: \"… with new hire <C> …\" in the account never makes Create read the form as <C>'s; another person stated as the subject still does",
    report: "QA, J11 (15 Nov 2026): Create refused Juno's card as \"out of date: the conversation now says the form is for Corran Vale\"",
    status: { open: "a person named inside the account (\"with new hire <C>\") is read as the form's subject at Create" },
    fixFlags: [FLAG],
    async run(t) {
      const thread = start(t);
      await thread.say(REQUEST);
      await thread.say(DICTATED);
      expect(thread.proposal?.employeeName, "the card is not Juno's").toBe("Juno Paxton");
      // Today's path: Create runs the conversation check (proposal-currency.ts) the same way for either path.
      const id = await thread.create();
      expect(t.forms().find((row) => row.id === id)?.employee_name).toBe("Juno Paxton");
    },
  },
  {
    id: "nov15-j11-new-hire-in-the-account-agent-loop",
    title: "J11 with the loop: the dictated account names the new hire; Create files Juno's card",
    report: "QA, J11 (15 Nov 2026): the loop's own J2 case met it",
    status: { open: "a person named inside the account is read as the form's subject at Create" },
    fixFlags: [FLAG, "AGENT_LOOP_ENABLED"],
    async run(t) {
      if (!t.loopOn?.()) return;
      const said = DICTATED.replace(/^change observation of offense to: /, "");
      const model = loopStandIn((view) => {
        const latest = view.turns.filter((turn) => turn.role === "user").at(-1)?.text ?? "";
        if (/^\[app check\]/.test(latest)) return { text: "Here's the Corrective Action Form for **Juno Paxton**.\n\n**Policy:** Standards of Conduct Policy, JBA Policy Manual p.12" };
        return lastResult(view, "propose_form")
          ? { text: "Here's the Corrective Action Form for **Juno Paxton**.\n\n**Policy:** Standards of Conduct Policy, JBA Policy Manual p.12" }
          : { tool: "propose_form", input: { template_key: "dpoa", employee_id: "e-3", policy: "Standards of Conduct", ...(/^change observation/.test(latest) ? { what_happened: said } : {}) } };
      });
      const thread = start(t);
      t.loopModel!(model);
      await thread.say(REQUEST);
      await thread.say(DICTATED);
      const id = await thread.create();
      expect(t.forms().find((row) => row.id === id)?.employee_name).toBe("Juno Paxton");
    },
  },
  {
    id: "nov15-j11-another-subject-still-refused",
    title: "J11 negative: \"actually this is for Remy Calder\" after Juno's card still makes Juno's card out of date",
    report: "QA, J11 (15 Nov 2026): a person stated as the subject still supersedes the card",
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      const thread = start(t);
      await thread.say("verbal ca for juno paxton, she was 20 minutes late on 11/9/26");
      const juno = thread.proposal;
      expect(juno?.employeeName).toBe("Juno Paxton");
      await thread.say("actually this is for remy calder");
      expect(thread.proposal?.employeeName ?? null, "the correction did not move the card to Remy").not.toBe("Juno Paxton");
    },
  },
];
