import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";
import { evidenceFrom, lastResult, loopStandIn, type LoopDecision } from "./loop-stand-in";

/**
 * ============================================================================
 * A TERMINATION'S STATED REASON REACHES THE CARD AND THE SAVED FORM WHEN THE MODEL WRITES NO ACCOUNT (port of Ask Bubbles
 * #1052, aff3547e: its coder 5's live triage, 22 Nov 2026, l6)
 * ============================================================================
 *
 * Found in Ask Bubbles, the same code in Sunny: "exit form for <P>, terminated for job abandonment, not eligible for rehire"
 * made a termination card with no account in both live runs, and the reply offered to add the reason. A termination's
 * reason is its account (Create saves it as the Reason line). exit_reason (#1047's port) now applies to a termination too,
 * with the same checks; with no account from the model, the checked reason is the account. Invented name: Rowan Kestrel,
 * as in `nov22-agent-loop-exit-reason-manager-words-cases.ts`.
 */

const FLAG = "AGENT_LOOP_ENABLED";
const SAID = "exit form for Rowan Kestrel, terminated for job abandonment, not eligible for rehire";
const REPORT = "Ask Bubbles' coder 5's live triage (22 Nov 2026, l6; port of #1052): \"terminated for job abandonment\" never reached What happened or the saved reason, in both runs; the reply offered to add it";

function start(t: ReplayContext): boolean {
  /* Stand-ins replay the model's turns: they prove the tool and Create, so they do not run against the live model. */
  if (!t.loopOn?.() || process.env.AGENT_LOOP_LIVE === "1") return false;
  vi.setSystemTime(new Date("2026-11-22T18:00:00Z"));
  t.directory([...STAFF]);
  t.as("salon_director", KEARNEY);
  return true;
}

export const NOV22_AGENT_LOOP_L6_TERMINATION_REASON_SAID_CASES: ReplayCase[] = [
  {
    id: "nov22-l6-termination-reason-no-account",
    title: `L6: "${SAID}" with NO what_happened, the model passing exit_reason "terminated for job abandonment": the card's account and the saved reason read it, and the reply never offers to add it`,
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!start(t)) return;
      t.loopModel!(loopStandIn((view): LoopDecision => {
        const result = lastResult(view, "propose_form") as { card?: { reads_back?: string[] } } | null;
        if (result) return { text: ["Here's the Resignation/Exit Form for **Rowan Kestrel**.", ...(result.card?.reads_back ?? [])].join("\n\n") };
        return {
          tool: "propose_form",
          input: {
            template_key: "stc-exit", employee_id: "e-4", exit_type: "termination",
            exit_evidence: { ...evidenceFrom(view, "exit form for Rowan Kestrel"), kind: "asks_for_exit_form" },
            exit_reason: "terminated for job abandonment", exit_reason_evidence: evidenceFrom(view, "terminated for job abandonment"),
          },
        };
      }));
      const thread = t.thread();
      const reply = await thread.say(SAID);
      expect((thread.proposal as { fromAgentLoop?: boolean } | null)?.fromAgentLoop, "no loop card was made (the case proves nothing)").toBe(true);
      expect(String((thread.proposal as { issue?: string } | undefined)?.issue ?? ""), "the card's account").toMatch(/^terminated for job abandonment\.?$/i);
      expect(reply.content, "reads_back lists the reason").toMatch(/Terminated for job abandonment/);
      expect(reply.content).not.toMatch(/isn't on the card|want it added|like it added/i);
      const id = await thread.create();
      const values = t.values(id);
      const checked = t.checked(id);
      const saved = JSON.stringify({ values, checked });
      expect(checked.resignation_type ?? [], `not a termination (the case proves nothing):\n${saved}`).toContain("immediate_involuntary_separation");
      expect(values.resignation_reason ?? "", saved).toMatch(/^terminated for job abandonment\.?$/i);
    },
  },
  {
    id: "nov22-l6-termination-no-reason-stays-blank",
    title: "L6 control: \"exit form for Rowan Kestrel, he was terminated, not eligible for rehire\" with no reason given: no account is made up and the saved reason stays blank",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!start(t)) return;
      t.loopModel!(loopStandIn((view): LoopDecision => {
        if (lastResult(view, "propose_form")) return { text: "Here's the Resignation/Exit Form for **Rowan Kestrel**." };
        /* A model that passes the bare word as a reason: it is no reason, and its quote does not hold "termination". */
        return {
          tool: "propose_form",
          input: {
            template_key: "stc-exit", employee_id: "e-4", exit_type: "termination",
            exit_evidence: { ...evidenceFrom(view, "exit form for Rowan Kestrel"), kind: "asks_for_exit_form" },
            exit_reason: "Termination", exit_reason_evidence: evidenceFrom(view, "he was terminated"),
          },
        };
      }));
      const thread = t.thread();
      await thread.say("exit form for Rowan Kestrel, he was terminated, not eligible for rehire");
      expect((thread.proposal as { fromAgentLoop?: boolean } | null)?.fromAgentLoop, "no loop card was made (the case proves nothing)").toBe(true);
      expect(String((thread.proposal as { issue?: string } | undefined)?.issue ?? "")).toBe("");
      const id = await thread.create();
      expect(t.values(id).resignation_reason ?? "").toBe("");
    },
  },
];
