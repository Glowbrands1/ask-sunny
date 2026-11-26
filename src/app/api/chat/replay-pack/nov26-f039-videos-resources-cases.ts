import { expect, vi } from "vitest";

import { AI_READABLE_PAGES, readablePagesLine } from "@/config/ai-readable-pages";
import { __setDataToolDepsForTests } from "@/lib/ai/agent-loop/data-tools";
import type { TrainingVideo } from "@/lib/videos/types";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";
import { lastResult, loopStandIn, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * THE VIDEOS AND MANAGER RESOURCES PAGES REACH THE MODEL (board f039, part 2; CLAUDE.md §5)
 * ============================================================================
 *
 * Both pages were `notReadable`. read_videos reads the Videos page's library as every viewer gets it (ready videos
 * only); read_manager_resources reads the Manager Resources page's live links, which are none yet. These cases ask in a
 * manager's words through the real chat route with production's flags and assert what the page shows reaches the
 * model. The video library is a table the harness does not hold, so it is scripted (two ready videos).
 */
const REPORT = "Pau, 20 Nov 2026: \"how can we program this AI to read new things added to the app? i need to always say it?\" (board f039: Videos, Manager Resources)";
const FLAG = "AGENT_LOOP_ENABLED";

const video = (title: string, category: string, keywords: string[], uploadedAt: string): TrainingVideo =>
  ({ id: title, title, description: `${title}, step by step.`, category, durationSeconds: 240, uploadedByName: "Invented Trainer", uploadedAt, equipment: [], keywords, tags: [], status: "ready" }) as unknown as TrainingVideo;
const LIBRARY = [video("Cleaning the beds between guests", "operations", ["sanitation"], "2026-11-20T10:00:00Z"), video("Greeting a guest at the desk", "customer_service", [], "2026-11-10T10:00:00Z")];

async function ask(t: ReplayContext, tool: string, input: Record<string, unknown>, words: string) {
  vi.setSystemTime(new Date("2026-11-26T16:00:00Z"));
  t.directory(STAFF);
  t.as("salon_director", KEARNEY);
  const model = loopStandIn((view: LoopView) => (lastResult(view, tool) ? { text: "Here is what the page shows." } : { tool, input }));
  t.loopModel!(model);
  await t.thread().say(words);
  return { model, output: (model.views.flatMap((view) => view.results.filter((result) => result.tool === tool)).at(-1)?.output ?? {}) as Record<string, unknown> };
}

export const NOV26_F039_VIDEOS_RESOURCES_CASES: ReplayCase[] = [
  {
    id: "nov26-f039-videos-reach-the-model",
    title: "\"is there a training video on cleaning the beds?\": read_videos gives the model the Videos page's matching video, and the rules name the page",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.() || process.env.AGENT_LOOP_LIVE === "1") return;
      __setDataToolDepsForTests({ loadVideos: async () => LIBRARY });
      try {
        const { model, output } = await ask(t, "read_videos", { topic: "cleaning the beds" }, "is there a training video on cleaning the beds?");
        expect(model.views[0]?.system).toContain(readablePagesLine(AI_READABLE_PAGES)!);
        expect(model.views[0]?.system).toContain("Videos (read_videos)");
        expect(output.refused, JSON.stringify(output)).toBeUndefined();
        const titles = JSON.stringify(output.videos);
        expect(titles, "the matching video did not reach the model").toContain("Cleaning the beds between guests");
        expect(titles, "a video on another topic was listed").not.toContain("Greeting a guest");
        expect(output.total).toBe(2);
      } finally {
        __setDataToolDepsForTests(null);
      }
    },
  },
  {
    id: "nov26-f039-manager-resources-reach-the-model",
    title: "\"what manager resources do we have?\": read_manager_resources gives the model the page's list (none yet) and tells it to say so, never inventing a link",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.() || process.env.AGENT_LOOP_LIVE === "1") return;
      const { model, output } = await ask(t, "read_manager_resources", {}, "what manager resources do we have?");
      expect(model.views[0]?.system).toContain("Manager resources (read_manager_resources)");
      expect(output.refused, JSON.stringify(output)).toBeUndefined();
      expect(output.resources).toEqual([]);
      expect(String(output.note)).toMatch(/no links yet.*never name or invent/);
    },
  },
];
