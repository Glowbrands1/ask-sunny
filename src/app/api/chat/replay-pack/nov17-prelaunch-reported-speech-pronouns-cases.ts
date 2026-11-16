import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayCase, type ReplayContext } from "./cases";
import { evidenceFrom, lastResult, loopStandIn, type LoopDecision } from "./loop-stand-in";

/**
 * ============================================================================
 * A PRONOUN IN REPORTED SPEECH IS THE CARD PERSON'S (Pau's ruling via QA, 17 Nov 2026; the 266 re-run on train 3)
 * ============================================================================
 *
 * #1077 named the card's person inside another person's reported question only when the card's person was named in the
 * same sentence. Runner 2's c090 T5 and c091 T5 (the manager calls the card's person by another first name in the
 * account, so the card's name is not in the sentence) and c247 T1 (the card's person messages another person "stating
 * she quit") kept she/her. The general rule (QA's narrowing): a pronoun in a clause a named person reports (asked, told,
 * said, stating, messaged …) is the card person's when that reporter is the card's person, the signed-in manager or a
 * roster leader (a manager, director, lead or supervisor by job title); a peer, a guest or a pronoun keeps it. Exact wording, invented names (Runner 2's
 * masking); the controls are pinned in `agent-loop/reply-pronouns.test.ts`.
 */

const FLAG = "AGENT_LOOP_ENABLED";
const REPORT = "QA (17 Nov 2026), Runner 2's 266 re-run on launch train 3: c090 T5, c091 T5, c247 T1 kept she/her for the card's person in reported speech";
const offline = process.env.AGENT_LOOP_LIVE !== "1";
const BRISA: DirectoryRow = { id: "e-brisa-rennick", firstName: "Brisa", lastName: "Rennick", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0309"], positionName: "Salon Director" };

function start(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-11-16T18:00:00Z"));
  t.directory([...STAFF, BRISA]);
  t.as("salon_director", KEARNEY);
}

const C090_ACCOUNT = "- Arlo set up a spray booth, then went into Room 4 and stayed there until the first customer arrived at 7:57am. / - When we arrived at 8:15am, the lobby lights were still off. / - When Brisa asked whether she had completed her 10-minute sanitization, Arlo said yes. The footage showed that it had not been completed. / - She was also not in dress code, was not wearing her nametag, and did not have a goal sheet until she was asked about it.";

export const NOV17_REPORTED_SPEECH_PRONOUN_CASES: ReplayCase[] = [
  {
    id: "nov17-pronoun-reported-question-card-person-not-named-c090",
    title: "c090 T5: the card is for Corin Quillfeather (typed, not on the staff list); Sunny's Observation says \"When Brisa asked whether she had completed her 10-minute sanitization, Arlo said yes.\" — the card's name is not in that sentence, and she/her become Corin",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.() || !offline) return;
      start(t);
      t.loopModel!(loopStandIn((view): LoopDecision => {
        if (lastResult(view, "propose_form")) {
          return { text: "Here's the Corrective Action Form for **Corin**, with your account added.\n**Observation of Offense:** Corin set up a spray booth, then went into Room 4 and stayed there until the first customer arrived at 7:57am. When we arrived at 8:15am, the lobby lights were still off. When Brisa asked whether she had completed her 10-minute sanitization, Arlo said yes. The footage showed that it had not been completed. Corin was also not in dress code, was not wearing Corin's nametag, and did not have a goal sheet until Corin was asked about it." };
        }
        return { tool: "propose_form", input: { template_key: "dpoa", employee_name: "Corin Quillfeather", person_evidence: evidenceFrom(view, "write up for Tanning Consultant Corin Quillfeather"), policy: "Standards of Conduct", what_happened: C090_ACCOUNT.replace(/(^|\/ )- /g, "$1").replace(/ \/ /g, " ") } };
      }));
      const thread = t.thread();
      const reply = await thread.say(`write up for Tanning Consultant Corin Quillfeather\n${C090_ACCOUNT}`);
      expect(reply.content).toContain("When Brisa asked whether Corin had completed Corin's 10-minute sanitization, Arlo said yes.");
      expect(reply.content, "a she/her for the card's person stayed in the reported question").not.toMatch(/asked whether she\b|completed her\b/);
    },
  },
  {
    id: "nov17-pronoun-reported-with-stating-c247",
    title: "c247 T1: \"create exit form for Arlo Quillfeather … How resigned: On 11-5-26 Arlo messaged Training Salon Director, Brisa Rennick via Woven stating she quit effective immediately.\" — the reply's \"stating she quit\" becomes \"stating Arlo quit\" (Brisa Rennick is named between)",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.() || !offline) return;
      start(t);
      const said = "create exit form for Arlo Quillfeather. Last day worked 11-5-26. Permanent address 100 Example Street. Immediate Vol resignation. How resigned: On 11-5-26 Arlo messaged Training Salon Director, Brisa Rennick via Woven stating she quit effective immediately. Store items were returned and payroll deduction is applicable. Reason for resignation: Arlo found it difficult to fulfill the responsibilities of the position.";
      t.loopModel!(loopStandIn((view): LoopDecision => {
        if (lastResult(view, "propose_form")) {
          return { text: "Here's the Resignation/Exit Form for **Arlo**.\n**Reason for Resignation:** Arlo found it difficult to fulfill the responsibilities of the position, and how it was given: on 11-5-26 Arlo messaged Training Salon Director, Brisa Rennick via Woven stating she quit effective immediately." };
        }
        return {
          tool: "propose_form",
          input: {
            template_key: "stc-exit",
            employee_name: "Arlo Quillfeather",
            person_evidence: evidenceFrom(view, "create exit form for Arlo Quillfeather"),
            exit_evidence: { ...evidenceFrom(view, "create exit form for Arlo Quillfeather"), kind: "asks_for_exit_form" },
            exit_type: "resignation",
            incident_date: "2026-11-05",
            what_happened: "Last day worked 11-5-26. Immediate Vol resignation. How resigned: On 11-5-26 Arlo messaged Training Salon Director, Brisa Rennick via Woven stating she quit effective immediately. Store items were returned. Reason for resignation: Arlo found it difficult to fulfill the responsibilities of the position.",
          },
        };
      }));
      const reply = await t.thread().say(said);
      expect(reply.content).toContain("via Woven stating Arlo quit effective immediately.");
    },
  },
  {
    id: "nov17-pronoun-reported-by-a-peer-or-guest-stays",
    title: "Controls (QA, 17 Nov 2026): a coaching card for Tamsin Orwell whose reply says \"Rowan Kestrel asked whether she could swap shifts.\" (a Tanning Consultant, a peer) and \"Mia Lane, a guest, said she wanted a refund.\": both pronouns stay as written",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.() || !offline) return;
      start(t);
      t.directory([...STAFF, BRISA, { id: "e-tamsin-orwell", firstName: "Tamsin", lastName: "Orwell", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0309"], positionName: "Tanning Consultant" }]);
      t.loopModel!(loopStandIn((view): LoopDecision => {
        const staff = lastResult(view, "find_staff") as { matches?: { employee_id: string }[] } | null;
        if (!staff) return { tool: "find_staff", input: { name: "Tamsin Orwell", person_evidence: evidenceFrom(view, "Tamsin Orwell") } };
        if (!lastResult(view, "propose_form")) return { tool: "propose_form", input: { template_key: "coaching", employee_id: staff.matches?.[0]?.employee_id, what_happened: "Tamsin left the front desk during a refund request on 11/14." } };
        return { text: "Here's the Coaching Form for **Tamsin**.\nRowan Kestrel asked whether she could swap shifts. Mia Lane, a guest, said she wanted a refund." };
      }));
      const reply = await t.thread().say("coaching for Tamsin Orwell, she left the front desk during a refund request on 11/14. Mia Lane, a guest, said she wanted a refund");
      expect(reply.content).toContain("Rowan Kestrel asked whether she could swap shifts.");
      expect(reply.content).toContain("Mia Lane, a guest, said she wanted a refund.");
    },
  },
];
