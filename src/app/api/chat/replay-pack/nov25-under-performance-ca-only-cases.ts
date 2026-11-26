import { expect, vi } from "vitest";

import { STAFF, type ReplayCase, type ReplayContext } from "./cases";
import { lastResult, loopStandIn, type LoopDecision, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * "UNDER PERFORMANCE ISN'T ON THE CA FORM" IS A CORRECTIVE ACTION'S LINE ONLY (live test, 25 Nov 2026)
 * ============================================================================
 *
 * The owner's live re-test of QA's report, word for word (an Admin, Standard mode):
 *   "Draft a coaching form for a performance concern for a made-up employee named Test Employee" →
 *   "**Policy:** Standards of Conduct Policy, JBA Policy Manual p.12 Under Performance isn't on the CA form. Sales
 *   performance CAs use the Standards of Conduct."
 * The line explains the Corrective Action Form's missing Under Performance box; on a Coaching Form it is about another
 * form. `propose_form` set the under_performance fact for any form whose policy is the Standards of Conduct and whose
 * words hold "perform…". Now the fact is a Corrective Action's only; the CA keeps it.
 */
const REPORT = `Live re-test, 25 Nov 2026 (Admin, Standard): "Draft a coaching form for a performance concern for a made-up employee named Test Employee" carded "Under Performance isn't on the CA form…"`;
const ADMIN = { level: "global", primaryAreaId: null, alsoCoversAreaIds: [] };
const COACHING = "Draft a coaching form for a performance concern for a made-up employee named Test Employee";
const CA = "Draft a corrective action form for Test Employee for under performance, she was below target in PPTA and Spa %";
const NAME = "Test Employee";

function start(t: ReplayContext): void {
  vi.setSystemTime(new Date("2026-11-25T16:00:00Z"));
  t.directory([...STAFF]);
  t.as("admin", ADMIN);
}

const model = (template: string, said: string, account: string) =>
  loopStandIn((view: LoopView): LoopDecision => {
    const result = lastResult(view, "propose_form") as { card?: unknown; facts?: Record<string, unknown> } | null;
    if (result) return { text: `Here's the form for **${NAME}**.` };
    return {
      tool: "propose_form",
      input: {
        template_key: template,
        employee_name: NAME,
        person_evidence: { message_id: view.turns.filter((turn) => turn.role === "user").at(-1)?.messageIds?.at(-1) ?? "current", quote: NAME },
        policy: "Standards of Conduct",
        what_happened: account,
        form_asked_evidence: said,
      },
    };
  });

function facts(standIn: ReturnType<typeof model>): Record<string, unknown> {
  const result = [...standIn.views].reverse().map((view) => lastResult(view, "propose_form")).find(Boolean) as { facts?: Record<string, unknown> } | null;
  return result?.facts ?? {};
}

export const NOV25_UNDER_PERFORMANCE_CA_ONLY_CASES: ReplayCase[] = [
  {
    id: "nov25-under-performance-not-on-coaching-card",
    title: `"${COACHING}" (an Admin, the loop): the Coaching card carries no under_performance fact, so no "Under Performance isn't on the CA form" line`,
    report: REPORT,
    status: "fixed",
    async run(t) {
      if (!t.loopOn?.() || process.env.AGENT_LOOP_LIVE === "1") return;
      start(t);
      const standIn = model("coaching", COACHING, "Performance concern.");
      t.loopModel!(standIn);
      const thread = t.thread();
      const reply = await thread.say(COACHING);
      expect(thread.proposal, `no card was made (the case proves nothing):\n${reply.content}`).not.toBeNull();
      expect(facts(standIn).under_performance, "a Coaching card was told to say the CA form has no Under Performance box").toBeUndefined();
      expect(reply.content).not.toMatch(/isn['’]t on the CA form/);
    },
  },
  {
    id: "nov25-under-performance-kept-on-ca-card",
    title: `Control: "${CA}" (the loop): the Corrective Action card still carries under_performance`,
    report: REPORT,
    status: "fixed",
    async run(t) {
      if (!t.loopOn?.() || process.env.AGENT_LOOP_LIVE === "1") return;
      start(t);
      const standIn = model("dpoa", CA, "Test Employee was below target in PPTA and Spa %.");
      t.loopModel!(standIn);
      const thread = t.thread();
      const reply = await thread.say(CA);
      expect(thread.proposal, `no card was made (the case proves nothing):\n${reply.content}`).not.toBeNull();
      expect(facts(standIn).under_performance, "the CA lost its Under Performance explanation").toBe(true);
    },
  },
];
