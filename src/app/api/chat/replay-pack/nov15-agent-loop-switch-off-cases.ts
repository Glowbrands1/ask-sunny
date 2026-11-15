import { expect, vi } from "vitest";

import * as agentLoopRun from "@/lib/ai/agent-loop/run";

import { KEARNEY, STAFF, type ReplayAnswer, type ReplayCase, type ReplayContext } from "./cases";
import { loopStandIn } from "./loop-stand-in";

/**
 * ============================================================================
 * THE LOOP'S SWITCH-OFF, AT RUN TIME (QA's audit, 15 Nov 2026, PR 7b)
 * ============================================================================
 *
 * "Everything stays behind AGENT_LOOP_ENABLED + AGENT_LOOP_USERS." With AGENT_LOOP_ENABLED off, and with it on but
 * AGENT_LOOP_USERS empty or not listing the signed-in manager, the chat route never enters `agent-loop/run.ts`
 * (`runAgentTurn`, the module the route imports dynamically; spied here) and answers a fixed set of requests with the
 * same replies as today's path. The control: the manager listed, the loop answers (the spy sees it), so the spy works.
 */

const REPORT = "QA's audit (15 Nov 2026): the loop's switch-off must leave every turn on today's path";

const REQUESTS = [
  "create corrective action for Remy Calder, she was late to open on 11/10",
  "ca for marnie holloway",
  "what forms does Remy Calder have on file",
  "what is the policy on breaks",
] as const;

const NAMES = ["AGENT_LOOP_ENABLED", "AGENT_LOOP_USERS"] as const;

interface Outcome {
  readonly reply: string;
  readonly card: string | null;
}

const shape = (answer: ReplayAnswer): Outcome => ({
  reply: answer.content,
  card: answer.formProposal ? JSON.stringify({ templateKey: answer.formProposal.templateKey, employeeName: answer.formProposal.employeeName, status: answer.formProposal.status }) : null,
});

/** The fixed requests, each in a fresh thread, with the loop's entry point watched. */
async function ask(t: ReplayContext, env: { enabled: string | undefined; users: string | undefined }): Promise<{ outcomes: Outcome[]; entered: number }> {
  const saved = Object.fromEntries(NAMES.map((name) => [name, process.env[name]]));
  const spy = vi.spyOn(agentLoopRun, "runAgentTurn");
  try {
    for (const [name, value] of [["AGENT_LOOP_ENABLED", env.enabled], ["AGENT_LOOP_USERS", env.users]] as const) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    const outcomes: Outcome[] = [];
    for (const request of REQUESTS) outcomes.push(shape(await t.thread().say(request)));
    return { outcomes, entered: spy.mock.calls.length };
  } finally {
    spy.mockRestore();
    for (const name of NAMES) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
  }
}

function setup(t: ReplayContext): void {
  vi.setSystemTime(new Date("2026-11-13T22:40:00Z"));
  t.directory([...STAFF]);
  t.as("salon_director", KEARNEY);
}

export const NOV15_AGENT_LOOP_SWITCH_OFF_CASES: ReplayCase[] = [
  {
    id: "nov15-switch-off-never-enters-the-loop",
    title: "AGENT_LOOP_ENABLED off, and on with AGENT_LOOP_USERS empty or not listing the manager: the route never enters the loop, and every request gets the same reply as today's path",
    report: `${REPORT}; fixed requests: a Corrective Action, a short form request, a forms-on-file question and a policy question`,
    status: "fixed",
    async run(t) {
      setup(t);
      const off = await ask(t, { enabled: undefined, users: "qa-manager@example.test" });
      expect(off.entered, "the loop was entered with AGENT_LOOP_ENABLED unset").toBe(0);
      const states: Record<string, { enabled: string | undefined; users: string | undefined }> = {
        "enabled false": { enabled: "false", users: "qa-manager@example.test" },
        "on, users unset": { enabled: "true", users: undefined },
        "on, users empty": { enabled: "true", users: "" },
        "on, users list someone else": { enabled: "true", users: "someone.else@example.test" },
        "on, users list the manager only by prefix": { enabled: "true", users: "qa-manager" },
      };
      for (const [label, env] of Object.entries(states)) {
        const run = await ask(t, env);
        expect(run.entered, `the loop was entered: ${label}`).toBe(0);
        expect(run.outcomes, `a different reply from today's path: ${label}`).toEqual(off.outcomes);
      }
    },
  },
  {
    id: "nov15-switch-off-control-listed-manager-enters-the-loop",
    title: "control for the switch-off case: with the loop on and the manager listed, the route does enter the loop (so the spy would see it)",
    report: `${REPORT}; the spy on runAgentTurn is live`,
    status: "fixed",
    async run(t) {
      setup(t);
      const standIn = loopStandIn(() => ({ text: "Noted." }));
      t.loopModel?.(standIn);
      if (!t.loopOn?.()) return;
      const listed = await ask(t, { enabled: "true", users: "qa-manager@example.test" });
      expect(listed.entered, "the loop was not entered for a listed manager").toBe(REQUESTS.length);
    },
  },
];
