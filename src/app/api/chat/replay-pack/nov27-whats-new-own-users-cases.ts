import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";
import { lastResult, loopStandIn, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * WHAT'S NEW, "LIVE BUT ON MY OWN PAGE ONLY" (the owner, 27 Nov 2026)
 * ============================================================================
 *
 * What's New is hidden until NEXT_PUBLIC_WHATS_NEW_ENABLED is on (production has it off). The owner wants it live for
 * themselves meanwhile: WHATS_NEW_USERS, a server-only list of sign-in emails checked against the verified session.
 * These cases ask "what's new" through the real chat route with production's flags, the switch off: a listed user's
 * question reaches the updates; an unlisted user's reads nothing and the model is told not to point at the page. The
 * harness signs everyone in as qa-manager@example.test (verified), so the list names that address, or another one.
 */
const REPORT = "The owner, 27 Nov 2026: What's New \"live but on my own page only\" (WHATS_NEW_USERS)";
const FLAG = "AGENT_LOOP_ENABLED";
const ASK = "what's new?";

async function askWith(t: ReplayContext, users: string) {
  const before = { users: process.env.WHATS_NEW_USERS, rollout: process.env.NEXT_PUBLIC_WHATS_NEW_ENABLED };
  process.env.WHATS_NEW_USERS = users;
  delete process.env.NEXT_PUBLIC_WHATS_NEW_ENABLED; // as production is: off
  try {
    vi.setSystemTime(new Date("2026-11-27T16:00:00Z"));
    t.directory(STAFF);
    t.as("salon_director", KEARNEY);
    const model = loopStandIn((view: LoopView) => (lastResult(view, "read_whats_new") ? { text: "Here's what's new." } : { tool: "read_whats_new", input: {} }));
    t.loopModel!(model);
    await t.thread().say(ASK);
    return (model.views.flatMap((view) => view.results.filter((result) => result.tool === "read_whats_new")).at(-1)?.output ?? {}) as { releases?: { updates: unknown[] }[]; refused?: string };
  } finally {
    if (before.users === undefined) delete process.env.WHATS_NEW_USERS;
    else process.env.WHATS_NEW_USERS = before.users;
    if (before.rollout === undefined) delete process.env.NEXT_PUBLIC_WHATS_NEW_ENABLED;
    else process.env.NEXT_PUBLIC_WHATS_NEW_ENABLED = before.rollout;
  }
}

export const NOV27_WHATS_NEW_OWN_USERS_CASES: ReplayCase[] = [
  {
    id: "nov27-whats-new-listed-user-sees-it",
    title: `"${ASK}" from a user on WHATS_NEW_USERS (any letter case), the rollout switch off: read_whats_new gives the model the updates`,
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.() || process.env.AGENT_LOOP_LIVE === "1") return;
      const output = await askWith(t, "someone@example.test, QA-Manager@Example.TEST");
      expect(output.refused, JSON.stringify(output)).toBeUndefined();
      expect((output.releases ?? []).flatMap((release) => release.updates).length, "the listed user got no updates").toBeGreaterThan(0);
    },
  },
  {
    id: "nov27-whats-new-unlisted-user-does-not",
    title: `"${ASK}" from a user not on WHATS_NEW_USERS, the rollout switch off: nothing is read and the model is told not to mention the page`,
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.() || process.env.AGENT_LOOP_LIVE === "1") return;
      const output = await askWith(t, "someone@example.test");
      expect(output.releases, "an unlisted user got the updates").toBeUndefined();
      expect(output.refused).toContain("do not mention a What's New page");
    },
  },
];
