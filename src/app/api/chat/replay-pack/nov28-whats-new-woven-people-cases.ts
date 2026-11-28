import { expect, vi } from "vitest";

import { WHATS_NEW } from "@/config/whats-new";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";
import { lastResult, loopStandIn, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * THE WOVEN HIRE AND TERMINATION ENTRIES REACH ADMINS AND HR ONLY (Pau, 28 Nov 2026; CLAUDE.md §5)
 * ============================================================================
 *
 * Pau, 28 Nov 2026, of the Notifications bar's "New hire" and "Terminated" notices: "caan we add this to whats new
 * page … ADMIN and HR Only". HR is not a role: it is the list of people who hear of every Woven hire and termination
 * (WOVEN_HR_NOTIFY_EMAILS). These cases run the real chat route with production's flags and ask in a manager's words:
 * a Salon Director on that list gets both entries through read_whats_new; the same Salon Director off the list gets
 * neither. The harness signs in as its verified QA account, which the first case puts on the list.
 */
const REPORT = "Pau, 28 Nov 2026: \"caan we add this to whats new page … ADMIN and HR Only\" (the Woven hire and termination notices)";
const FLAG = "AGENT_LOOP_ENABLED";
const ROLLOUT = "NEXT_PUBLIC_WHATS_NEW_ENABLED";
const HR_LIST = "WOVEN_HR_NOTIFY_EMAILS";
const SIGNED_IN = "qa-manager@example.test";
const TITLES = WHATS_NEW.flatMap((release) => release.entries).filter((entry) => entry.visibleTo === "admins_and_hr").map((entry) => entry.title);

async function titlesFor(t: ReplayContext, hrList: string): Promise<string[]> {
  vi.setSystemTime(new Date("2026-11-28T16:00:00Z"));
  t.directory(STAFF);
  t.as("salon_director", KEARNEY);
  const saved = { rollout: process.env[ROLLOUT], hr: process.env[HR_LIST] };
  process.env[ROLLOUT] = "true";
  process.env[HR_LIST] = hrList;
  try {
    const model = loopStandIn((view: LoopView) => (lastResult(view, "read_whats_new") ? { text: "Here's what's new." } : { tool: "read_whats_new", input: { since: "2026-11-28" } }));
    t.loopModel!(model);
    await t.thread().say("anything new this week for HR?");
    const output = model.views.flatMap((view) => view.results.filter((result) => result.tool === "read_whats_new")).at(-1)?.output as { releases?: { updates: { title: string }[] }[] } | undefined;
    return (output?.releases ?? []).flatMap((release) => release.updates.map((update) => update.title));
  } finally {
    for (const [key, value] of [[ROLLOUT, saved.rollout], [HR_LIST, saved.hr]] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

export const NOV28_WHATS_NEW_WOVEN_PEOPLE_CASES: ReplayCase[] = [
  {
    id: "nov28-whats-new-woven-people-for-hr",
    title: "\"anything new this week for HR?\" (a Salon Director on HR's notice list): the Woven hire and termination updates reach the model",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.() || process.env.AGENT_LOOP_LIVE === "1") return;
      expect(TITLES.length).toBeGreaterThan(0);
      const titles = await titlesFor(t, `someone@example.test, ${SIGNED_IN.toUpperCase()}`);
      for (const title of TITLES) expect(titles, `HR was not told: ${title}`).toContain(title);
    },
  },
  {
    id: "nov28-whats-new-woven-people-not-for-others",
    title: "\"anything new this week for HR?\" (a Salon Director not on HR's notice list): neither Woven update reaches the model",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.() || process.env.AGENT_LOOP_LIVE === "1") return;
      const titles = await titlesFor(t, "someone@example.test");
      for (const title of TITLES) expect(titles, `told someone who is neither admin nor HR: ${title}`).not.toContain(title);
    },
  },
];
