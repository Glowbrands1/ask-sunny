import type { ExternalResource } from "@/types";

/**
 * ============================================================================
 * MANAGER RESOURCES THAT ACTUALLY EXIST
 * ============================================================================
 *
 * PRODUCTION CONFIGURATION, NOT SEEDED CONTENT, which is why it is here beside
 * `salons.ts` and not under `data/demo/`. Everything in this file is a link a
 * manager can click on a real deployment and arrive somewhere.
 *
 * WHAT THIS REPLACES. `data/demo/resources.ts` holds ten tiles and eight of
 * them point at `https://example.com/...` — Power BI, Woven, Company Policies,
 * Training Portal, HR Resources, IT Support, Scheduling. They rendered on
 * every live deployment to every Salon Director, Assistant, District and
 * Regional Manager, with no label saying they were placeholders and an
 * `availability: "available"` badge saying the opposite. A manager who clicked
 * "Company Policies" got example.com.
 *
 * THE BAR FOR BEING IN THIS FILE is that the URL resolves to a real working
 * tool. It is deliberately a short list, and a short list of real links is the
 * point — the screen says so rather than padding itself out.
 *
 * HOW A TOOL GETS ADDED. Someone confirms the URL and adds the entry. That is
 * the whole process, and it is the same one `demo/resources.ts` describes for
 * itself ("modelled as data rather than hard-coded links so the list becomes
 * database managed later"). When that database arrives this file becomes its
 * seed or its fallback; until then it is the production list.
 */
export const PRODUCTION_RESOURCES: ExternalResource[] = [
  /*
   * THE ONE THE TEAM ALREADY SHIPS. `demo/resources.ts` says it itself — "L10
   * Meetings points at the live app; the remaining URLs are placeholders until
   * those tools are connected" — and the app shell's quick-actions row has
   * linked to this same URL from every page of the live deployment for as long
   * as that row has existed. It is an existing production link, carried over
   * rather than introduced.
   */
  {
    id: "res-l10",
    name: "L10 Meetings",
    description:
      "The weekly leadership meeting app the team built. Scorecard, rocks, to-dos, and issue list.",
    category: "meetings",
    url: "https://preview--leadership-sync-tool.lovable.app/",
    openMode: "new_tab",
    owner: "JB & Associates",
    availability: "available",
    iconKey: "calendar-check",
  },
];
