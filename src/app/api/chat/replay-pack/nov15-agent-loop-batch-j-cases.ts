import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";
import { lastResult, loopStandIn } from "./loop-stand-in";

/**
 * ============================================================================
 * BATCH J: QA'S LIVE RE-RUN, PART 1 (15 Nov 2026; main f6c3a3ca, batches F and H live)
 * ============================================================================
 *
 * Each case uses the manager's words from the re-run, with the people invented (Juno Paxton is STAFF's), and runs
 * through the real chat route with the loop on for this case's manager.
 */
const REPORT = "QA, batch J (15 Nov 2026): the live re-run, part 1";
const FLAG = "AGENT_LOOP_ENABLED";

function start(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-11-15T05:00:00Z"));
  t.directory(STAFF);
  t.as("salon_director", KEARNEY);
  return t.thread();
}

export const NOV15_AGENT_LOOP_BATCH_J_CASES: ReplayCase[] = [
  {
    id: "nov15-batch-j1-policy-line-with-source-marker-is-the-card",
    title: "J1: a reply whose Policy line is the card's own line with a source marker (\"… p.12 [S1]\") is never replaced by \"That change isn't on the card yet\"",
    report: `${REPORT}; L4 t1 (19.9s): "That change isn't on the card yet: policy (Standards of Conduct Policy, JBA Policy Manual p.12). Tell me again…" while the card had that policy`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      const thread = start(t);
      // The model's reply as the live one wrote it: the card's Policy line, then the source marker of read_policy.
      const model = loopStandIn((view) => {
        const card = (lastResult(view, "propose_form") as { card?: { policy?: string | null } } | undefined)?.card;
        if (!card) return { tool: "propose_form", input: { template_key: "dpoa", employee_id: "e-3", policy: "Standards of Conduct" } };
        return { text: `Here's the Corrective Action Form for **Juno Paxton**.\n\nWhat happened?\n\n**Policy:** ${card.policy} [S1]` };
      });
      t.loopModel!(model);
      const reply = await thread.say("create a CA for salon director, juno paxton for violating the standards of conduct");
      expect(thread.proposal, "no CA card for Juno Paxton").toMatchObject({ templateKey: "dpoa", employeeName: "Juno Paxton" });
      expect(reply.content, "a good reply was replaced by a false self-check").not.toMatch(/isn't on the card yet/);
      expect(reply.content).toMatch(/\*\*Policy:\*\* Standards of Conduct Policy, JBA Policy Manual p\.12/);
    },
  },
];
