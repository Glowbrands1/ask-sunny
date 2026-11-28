import { expect, vi } from "vitest";

import { AI_READABLE_PAGES, readablePagesLine } from "@/config/ai-readable-pages";
import { WHATS_NEW, whatsNewFor } from "@/config/whats-new";
import { DEFAULT_PERMISSION_MATRIX, hasPermission } from "@/lib/permissions";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";
import { lastResult, loopStandIn, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * "WHAT'S NEW IN SUNNY?" IS ANSWERED FROM THE WHAT'S NEW PAGE (Pau, 26 Nov 2026; CLAUDE.md §5)
 * ============================================================================
 *
 * The What's New page (`/whats-new`) lists recent updates from `src/config/whats-new.ts`; the AI reads the same list
 * through read_whats_new, scoped as the page is: an entry about a page only for a role that may open that page. These
 * cases run the real chat route with production's flags, ask in a manager's words, and assert the entries reach the
 * model: a Salon Director gets every update they may open and not the administrators' Employee Directory one; an
 * administrator gets that one too.
 *
 * Pau, 27 Nov 2026 ("hide this for everyone, for now pls, i will roll it out later"): What's New is hidden until
 * NEXT_PUBLIC_WHATS_NEW_ENABLED is set, and production has it off. The first case asks as production is (nothing reaches
 * the model, and it is told not to point at the page), then turns it on, as the rollout will, for the rest.
 */
const ROLLOUT = "NEXT_PUBLIC_WHATS_NEW_ENABLED";
const REPORT = "Pau, 26 Nov 2026: a What's New page of recent updates, and \"what's new in Sunny?\" answered from it (CLAUDE.md §5)";
const FLAG = "AGENT_LOOP_ENABLED";
const ASK = "what's new in Sunny?";
const ADMIN_ONLY = "Employee address in the Employee Directory";

type Update = { tag: string; title: string; before: string; now: string; how_to_use: string; show_me?: { page: string; link: string } };
type Release = { date: string; summary: string; updates: Update[] };

/**
 * CHANGED ON PURPOSE (the owner, 27 Nov 2026: "add in whats new what we accomplished last week and this week"). The
 * list now holds more updates than read_whats_new gives the model at once (its newest 15), so the case asks for what a
 * role's page lists first, worked out from the list, not for fixed titles that drop past the cap as entries are added.
 */
const LISTED = 15;
const visibleTo = (role: Parameters<typeof whatsNewFor>[0]) => whatsNewFor(role, (r, permission) => hasPermission(DEFAULT_PERMISSION_MATRIX, r, permission));
const day = (date: string) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));

async function ask(t: ReplayContext, words: string, input: Record<string, unknown> = {}) {
  vi.setSystemTime(new Date("2026-11-26T16:00:00Z"));
  const model = loopStandIn((view: LoopView) => (lastResult(view, "read_whats_new") ? { text: "Here's what's new." } : { tool: "read_whats_new", input }));
  t.loopModel!(model);
  await t.thread().say(words);
  const output = model.views.flatMap((view) => view.results.filter((result) => result.tool === "read_whats_new")).at(-1)?.output as
    | { releases?: Release[]; refused?: string; error?: string }
    | undefined;
  return { model, output, updates: (output?.releases ?? []).flatMap((release) => release.updates) };
}

export const NOV26_WHATS_NEW_CASES: ReplayCase[] = [
  {
    id: "nov26-whats-new-reaches-the-model",
    title: `"${ASK}" (a Salon Director): read_whats_new gives the model the What's New page's updates, newest first, and not the administrators' Employee Directory update; the rules name the page`,
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.() || process.env.AGENT_LOOP_LIVE === "1") return;
      t.directory(STAFF);
      t.as("salon_director", KEARNEY);
      // CHANGED ON PURPOSE (the owner, 28 Nov 2026: "roll out whats new to all users both app"): production has the
      // switch on now, so the hidden half turns it off itself, as the off switch would.
      delete process.env[ROLLOUT];
      const hidden = await ask(t, ASK);
      expect(hidden.updates, "What's New reached the model while it is hidden").toEqual([]);
      expect(hidden.output?.refused).toContain("do not mention a What's New page");
      process.env[ROLLOUT] = "true"; // as production is (on since 28 Nov 2026); the harness restores it after the case
      const { model, output, updates } = await ask(t, ASK);
      expect(model.views[0]?.system, "the readable-pages line is not in what the model is given").toContain(readablePagesLine(AI_READABLE_PAGES)!);
      expect(model.views[0]?.system).toContain("What's New (read_whats_new)");
      expect(output?.refused, JSON.stringify(output)).toBeUndefined();
      const titles = updates.map((update) => update.title);
      const expected = visibleTo("salon_director").flatMap((release) => release.entries.map((entry) => entry.title)).slice(0, LISTED);
      expect(titles, "the newest updates a Salon Director's page lists did not reach the model").toEqual(expected);
      expect(titles, "an administrators-only update reached a Salon Director").not.toContain(ADMIN_ONLY);
      // Newest first: the first release is the newest one with an update a Salon Director may open.
      const newest = visibleTo("salon_director")[0]!;
      expect(output?.releases?.[0]?.date, "newest first").toBe(day(newest.date));
      expect(output?.releases?.[0]?.summary, "the release's summary").toBe(WHATS_NEW.find((release) => release.date === newest.date)!.summary);
      // The owner's format: tag, Before / Now / How to use it, and the Show me page, so the answer can say how to use it.
      const shown = updates.find((update) => update.show_me)!;
      const entry = WHATS_NEW.flatMap((release) => release.entries).find((candidate) => candidate.title === shown.title)!;
      expect(shown).toMatchObject({ tag: entry.tag, before: entry.before, now: entry.now, how_to_use: entry.howToUse, show_me: { page: entry.showMe!.label, link: entry.showMe!.href } });
    },
  },
  {
    id: "nov26-whats-new-admin-and-since",
    title: `"any new features this week?" (an administrator): the Employee Directory update reaches the model, and since keeps only that week's updates`,
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.() || process.env.AGENT_LOOP_LIVE === "1") return;
      t.directory(STAFF);
      t.as("admin", { level: "global", primaryAreaId: null, alsoCoversAreaIds: [] });
      process.env[ROLLOUT] = "true"; // as production is (on since 28 Nov 2026); the harness restores it
      const { updates } = await ask(t, "any new features this week?", { since: "2026-11-25" });
      const titles = updates.map((update) => update.title);
      const sinceTheWeek = visibleTo("admin").filter((release) => release.date >= "2026-11-25").flatMap((release) => release.entries.map((entry) => entry.title));
      expect(titles, "the week's updates an administrator's page lists did not reach the model").toEqual(sinceTheWeek.slice(0, LISTED));
      // The administrators' Knowledge Base post was taken off What's New on 28 Nov 2026 (owner's request), so it is no longer asserted here.
      const older = WHATS_NEW.filter((release) => release.date < "2026-11-25").flatMap((release) => release.entries.map((entry) => entry.title));
      expect(titles.filter((title) => older.includes(title)), "an update from before the 25th was given for this week").toEqual([]);
    },
  },
];
