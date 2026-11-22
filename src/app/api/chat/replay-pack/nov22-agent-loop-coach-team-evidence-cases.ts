import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";
import { evidenceFrom, lastResult, loopStandIn } from "./loop-stand-in";

/**
 * ============================================================================
 * A WHOLE-TEAM COACHING REQUEST IS THE MODEL'S CALL, SHOWN BY THE MANAGER'S WORDS (QA's shadow re-run S2, 22 Nov 2026)
 * ============================================================================
 *
 * "can you make me a coaching form for my entire <team> at <store> for selling <product> and not writing rain checks":
 * coach_team answered wrong_tool ("not a whole-team request"), because its old phrase reader knows "entire team / staff
 * / crew" but not a group word such as "sales team" or "tanning consultants". The model decides it is a whole team and
 * passes team_evidence: the manager's words, checked only for being real (evidence.ts). Pau: guide the loop, no word
 * lists. The groups below are the ones the phrase reader missed; Kearney and lotion stand in for <store> and <product>.
 */

const FLAG = "AGENT_LOOP_ENABLED";
const REPORT = "QA's 266-chat shadow re-run (22 Nov 2026), S2: coach_team refused \"a coaching form for my entire <team> at <store>\" as not a team request";
const GROUPS = ["sales team", "front desk team", "tanning consultants", "employees", "salon"];

function start(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-11-22T16:00:00Z"));
  t.directory([...STAFF]);
  t.as("salon_director", KEARNEY);
  return t.thread();
}

/** QA's exact sentence (a salon director, one turn, no person named), typos kept. */
const VERBATIM = "can you make me a coahcing form for my entire team at pine lake for selling kits and not writing raing checks";

const said = (group: string) => `can you make me a coaching form for my entire ${group} at Kearney for selling lotion and not writing rain checks`;

export const NOV22_AGENT_LOOP_COACH_TEAM_EVIDENCE_CASES: ReplayCase[] = [
  ...GROUPS.map((group): ReplayCase => ({
    id: `nov22-s2-coach-team-evidence-${group.replace(/\s+/g, "-")}`,
    title: `S2: "${said(group)}" with team_evidence: the team Coaching card, never wrong_tool`,
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      const thread = start(t);
      const model = loopStandIn((view) => (lastResult(view, "coach_team") ? { text: "Here is the team Coaching card." } : { tool: "coach_team", input: { team_evidence: evidenceFrom(view, `my entire ${group}`) } }));
      t.loopModel!(model);
      const reply = await thread.say(said(group));
      const result = lastResult(model.views.at(-1)!, "coach_team") as { reason_code?: string; error?: string } | null;
      expect(result?.reason_code ?? null, JSON.stringify(result)).not.toBe("wrong_tool");
      expect(reply.formProposal?.employeeName, `no team card:\n${reply.content}`).toBe("All team members");
    },
  })),
  {
    id: "nov22-s2-coach-team-evidence-not-in-message",
    title: "Control: team_evidence whose words are not in the manager's message is not evidence: wrong_tool, as before",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      const thread = start(t);
      const model = loopStandIn((view) => (lastResult(view, "coach_team") ? { text: "ok" } : { tool: "coach_team", input: { team_evidence: evidenceFrom(view, "my whole sales team") } }));
      t.loopModel!(model);
      await thread.say("can you make me a coaching form for remy calder for selling lotion");
      const result = lastResult(model.views.at(-1)!, "coach_team") as { reason_code?: string } | null;
      expect(result?.reason_code).toBe("wrong_tool");
    },
  },
  {
    id: "nov22-s2-verbatim-pine-lake-own-salon",
    title: "S2 verbatim, the salon director of Pine Lake: \"can you make me a coahcing form for my entire team at pine lake …\" (typo and all) with team_evidence makes the team Coaching card",
    report: `${REPORT}; QA's exact sentence (22 Nov 2026)`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      vi.setSystemTime(new Date("2026-11-22T16:00:00Z"));
      t.directory([...STAFF].map((row) => ({ ...row, salonIds: ["loc-0312"] })));
      t.as("salon_director", { level: "salon", primaryAreaId: "loc-0312", alsoCoversAreaIds: [] });
      const model = loopStandIn((view) => (lastResult(view, "coach_team") ? { text: "Here is the team Coaching card." } : { tool: "coach_team", input: { team_evidence: evidenceFrom(view, "my entire team at pine lake") } }));
      t.loopModel!(model);
      const reply = await t.thread().say(VERBATIM);
      const result = lastResult(model.views.at(-1)!, "coach_team") as { reason_code?: string } | null;
      expect(result?.reason_code ?? null, JSON.stringify(result)).not.toBe("wrong_tool");
      expect(reply.formProposal?.employeeName, `no team card:\n${reply.content}`).toBe("All team members");
    },
  },
  {
    id: "nov22-s2-verbatim-pine-lake-not-her-salon",
    title: "S2 verbatim, a Kearney salon director: the same sentence is a team request (never wrong_tool); Pine Lake is not hers, so no Pine Lake card",
    report: `${REPORT}; QA's exact sentence (22 Nov 2026)`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      const thread = start(t);
      const model = loopStandIn((view) => (lastResult(view, "coach_team") ? { text: "ok" } : { tool: "coach_team", input: { team_evidence: evidenceFrom(view, "my entire team at pine lake") } }));
      t.loopModel!(model);
      const reply = await thread.say(VERBATIM);
      const result = lastResult(model.views.at(-1)!, "coach_team") as { reason_code?: string } | null;
      expect(result?.reason_code ?? null, JSON.stringify(result)).not.toBe("wrong_tool");
      expect(reply.formProposal?.locationId ?? null).not.toBe("loc-0312");
    },
  },
];
