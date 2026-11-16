import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase } from "./cases";
import { lastResult, loopStandIn, type LoopDecision } from "./loop-stand-in";

/**
 * ============================================================================
 * NEVER JSON TO A MANAGER (QA's live finding, 16 Nov 2026)
 * ============================================================================
 *
 * Production, conv_mwin8fc82kk8c7i, 02:28:05Z: "coaching on lotions at checkout" (no name). The loop ran its tools,
 * stopped "reply", and the reply shown was {"content":"This looks like a coaching topic but I need to know who it's
 * for...","citations":[],...}. The stand-in here answers in that shape (bare, and in a ```json fence); the manager sees
 * the sentence, never the object.
 */

const FLAG = "AGENT_LOOP_ENABLED";
const SAID = "This looks like a coaching topic but I need to know who it's for. Who is this Coaching Form for?";
const ENVELOPE = JSON.stringify({ content: SAID, citations: [], coverage: "not_applicable", recommendedVideoIds: [] });

export const NOV16_AGENT_LOOP_NO_JSON_REPLY_CASES: ReplayCase[] = ([
  ["bare", ENVELOPE],
  ["fenced", `\`\`\`json\n${ENVELOPE}\n\`\`\``],
] as const).map(([tag, written]): ReplayCase => ({
  id: `nov16-loop-reply-never-json-${tag}`,
  title: `Never JSON to a manager (live, conv_mwin8fc82kk8c7i): "coaching on lotions at checkout", and the model writes its reply as the response object (${tag}); the manager sees "${SAID}"`,
  report: "QA's live finding, 16 Nov 2026, 02:28:05Z (production dpl_AQK5Aur…, main e2e92554)",
  status: "fixed",
  fixFlags: [FLAG],
  async run(t) {
    if (!t.loopOn?.()) return;
    vi.setSystemTime(new Date("2026-11-16T02:28:05Z"));
    t.directory([...STAFF]);
    t.as("salon_director", KEARNEY);
    t.loopModel!(loopStandIn((view): LoopDecision => {
      if (!lastResult(view, "propose_form")) return { tool: "propose_form", input: { template_key: "coaching" } };
      return { text: written };
    }));
    const reply = await t.thread().say("coaching on lotions at checkout");
    expect(reply.content, "the manager was shown JSON").toBe(SAID);
    expect(reply.content).not.toMatch(/[{}]|"citations"/);
  },
}));
