import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayCase } from "./cases";
import { evidenceFrom, lastResult, loopStandIn, type LoopDecision, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * THE ACCOUNT'S LEGAL FIRST NAME IS THE CARD'S PERSON (port from the sibling app, its QA's live re-run, 23 Nov 2026)
 * ============================================================================
 *
 * The sibling's manager typed the person's preferred name; the card showed "<preferred> <last> (<legal> <last> in the
 * roster)", which was right. The account named the person by the legal first name and said "did not clean up after
 * themself". The card read "… did not clean up after <preferred> <last>" (the pronoun pass replaced "themself", making
 * the person the object of their own action), and the saved Expectation said "the account describes another
 * individual's actions" (the drafter read the legal name as a second person). The turns are the sibling report's
 * shape; the person is invented: roster legal first name Velmara, preferred Brisenne Pellwood.
 */

const REPORT = "Sibling app QA's live re-run (23 Nov 2026): \"did not clean up after <preferred name>\" on the card and saved form, and \"the account describes another individual's actions\" in the saved Expectation";
const VELMARA: DirectoryRow = { id: "e-velmara-pellwood", firstName: "Velmara", lastName: "Pellwood", preferredFirstName: "Brisenne", employmentStatus: "active", salonIds: ["loc-0309"], positionName: "Tanning Consultant" };
const T1 = "make a corrective action for brisenne pellwood verbal warning payroll not deductable";
const T2 = "here is what happened:";
const T3 = "observation of offense: on 11/14 Velmara worked 50 minutes over the scheduled shift and did not clean up after themself";

const users = (view: LoopView) => view.turns.filter((turn) => turn.role === "user" && (turn.messageIds?.length ?? 0) > 0).length;

export const NOV23_AGENT_LOOP_LEGAL_NAME_SAME_PERSON_CASES: ReplayCase[] = [
  {
    id: "nov23-legal-first-name-in-account-is-the-card-person",
    title: "Port (sibling U19 live re-run): the card is Brisenne Pellwood (Velmara in the roster); the account \"on 11/14 Velmara worked 50 minutes over the scheduled shift and did not clean up after themself\": the card and the saved form name the person, never \"clean up after Brisenne\" or \"another individual\"",
    report: REPORT,
    status: "fixed",
    async run(t) {
      vi.setSystemTime(new Date("2026-11-16T18:00:00Z"));
      t.directory([...STAFF, VELMARA]);
      t.as("salon_director", KEARNEY);
      const account = "On 11/14 Velmara worked 50 minutes over the scheduled shift and did not clean up after themself.";
      t.loopModel!(loopStandIn((view): LoopDecision => {
        if (lastResult(view, "propose_form")) return { text: "Here's the Corrective Action Form." };
        const turn = users(view);
        if (turn === 2) return { text: "What happened?" };
        return {
          tool: "propose_form",
          input: {
            template_key: "dpoa", employee_id: VELMARA.id, person_evidence: evidenceFrom(view, "brisenne pellwood", turn - 1),
            warning_level: "verbal", level_evidence: evidenceFrom(view, "verbal warning", turn - 1),
            payroll_deduct: "no", payroll_evidence: evidenceFrom(view, "payroll not deductable", turn - 1),
            ...(turn === 3 ? { what_happened: account, incident_date: "2026-11-14" } : {}),
          },
        };
      }));
      const thread = t.thread();
      await thread.say(T1);
      await thread.say(T2);
      const reply = await thread.say(T3);
      const issue = String((thread.proposal as { issue?: string | null } | null)?.issue ?? "");
      expect(issue, reply.content).toMatch(/worked 50 minutes/);
      expect(issue, `the card makes the person the object of their own action:\n${issue}`).not.toMatch(/after (?:Brisenne|Velmara)/i);
      const id = await thread.create();
      const saved = JSON.stringify(t.values(id));
      expect(saved, saved).not.toMatch(/after (?:Brisenne|Velmara)/i);
      expect(saved, saved).not.toMatch(/another individual/i);
    },
  },
];
