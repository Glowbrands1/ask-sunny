import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";
import { lastResult, loopStandIn, type LoopDecision } from "./loop-stand-in";

/**
 * ============================================================================
 * MSB IS "OTHER: MUST SEE BEHAVIORS", NOT THE STANDARDS OF CONDUCT (Pau, 16 Nov 2026)
 * ============================================================================
 *
 * Pau's ruling (16 Nov 2026, via QA): "MSB" / "must see behaviors", abbreviated or spelled out, any case, is Other: Must
 * See Behaviors on the Corrective Action Form, not the Standards of Conduct. A guest or customer complaint about the
 * employee's conduct stays the Standards of Conduct. The loop's Other policy is written "Other — <topic>" (the card's
 * Policy line and Create read it so: `card-policy.ts` splits on " — "). Loop only: today's path and MSB_PHRASE_SOC are
 * untouched. Invented people: Remy Calder is on the roster.
 */

const FLAG = "AGENT_LOOP_ENABLED";
const REPORT = "Pau's ruling, 16 Nov 2026 (via QA): MSB / must see behaviors is Other: Must See Behaviors, not the Standards of Conduct";

type Card = { card?: { employee?: string; policy?: string | null }; error?: string } | null;
type Staff = { matches?: { employee_id: string }[] } | null;

async function salon(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-11-14T22:40:00Z"));
  t.directory([...STAFF]);
  t.as("salon_director", KEARNEY);
}

/** A stand-in that cites the policy the rules book gives for the account (the rules text is what changed). */
function citing(policy: string, account: string) {
  return loopStandIn((view): LoopDecision => {
    const staff = lastResult(view, "find_staff") as Staff;
    const card = lastResult(view, "propose_form") as Card;
    if (!staff) return { tool: "find_staff", input: { name: "Remy Calder" } };
    if (!card) return { tool: "propose_form", input: { template_key: "dpoa", employee_id: staff.matches?.[0]?.employee_id, policy, what_happened: account, incident_date: "2026-11-14" } };
    return { text: `Here's the Corrective Action Form for **${card.card?.employee}**.\n\n**Policy:** ${card.card?.policy ?? ""}` };
  });
}

export const NOV16_AGENT_LOOP_MSB_OTHER_CASES: ReplayCase[] = [
  ...([
    ["msb", "CA for Remy Calder, her MSB were not done on 11/14", "Her MSB were not done on 11/14."],
    ["spelled-out", "CA for Remy Calder, she didn't do her must see behaviors on 11/14", "She didn't do her must see behaviors on 11/14."],
  ] as const).map(([tag, words, account]): ReplayCase => ({
    id: `nov16-msb-is-other-must-see-behaviors-${tag}`,
    title: `Pau's MSB ruling: "${words}" cites Other — Must See Behaviors on the card (never the Standards of Conduct), and the rules book says so`,
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      await salon(t);
      const standIn = citing("Other — Must See Behaviors", account);
      t.loopModel!(standIn);
      const thread = t.thread();
      const reply = await thread.say(words);
      expect(standIn.views[0]?.system, "the rules book still sends MSB to the Standards of Conduct").toMatch(/must see behaviors[^.]*is not the Standards of Conduct[^.]*Other — Must See Behaviors/i);
      expect((thread.proposal as { policyLine?: string | null } | undefined)?.policyLine, `MSB was not Other — Must See Behaviors:\n${reply.content}`).toBe("Other — Must See Behaviors");
      expect((thread.proposal as { policyLine?: string | null } | undefined)?.policyLine ?? "").not.toMatch(/Standards of Conduct/i);
    },
  })),
  {
    id: "nov16-msb-ruling-guest-complaint-stays-standards-of-conduct",
    title: "Pau's MSB ruling, the control: \"CA for Remy Calder, a guest complained she was rude at the front desk on 11/14\" still cites the Standards of Conduct",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      await salon(t);
      const standIn = citing("Standards of Conduct", "A guest complained she was rude at the front desk on 11/14.");
      t.loopModel!(standIn);
      const thread = t.thread();
      await thread.say("CA for Remy Calder, a guest complained she was rude at the front desk on 11/14");
      expect(standIn.views[0]?.system).toMatch(/A guest or customer complaint about the employee's conduct is the Standards of Conduct/);
      expect((thread.proposal as { policyLine?: string | null } | undefined)?.policyLine ?? "").toMatch(/^Standards of Conduct/);
    },
  },
];
