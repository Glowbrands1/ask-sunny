/**
 * ============================================================================
 * THE OVERVIEW'S QUICK ACTIONS — NAVIGATION, NOT SEEDED CONTENT
 * ============================================================================
 *
 * Four destinations the app shell offers on every page. Three are internal
 * routes and one is an external tool the team uses. They describe where a
 * manager can go, not what happened at a salon, so they are production
 * configuration.
 *
 * WHY THEY MOVED OUT OF `data/demo/dashboard.ts`. That file also holds
 * `DEMO_RECENT_ACTIVITY` — six fabricated actions attributed to named people.
 * `jump-to-row.tsx` renders on every page and imported the quick actions from
 * there, so the invented activity shipped in the bundle behind a row of
 * navigation buttons.
 */

/** Quick actions on the Overview screen. */
export interface QuickAction {
  id: string;
  label: string;
  href: string;
  iconKey: string;
  external?: boolean;
  /**
   * An external destination nobody has confirmed resolves.
   *
   * Hidden on a live deployment. A navigation tile is a promise that there is
   * something at the other end, and an unverified preview host is not a
   * promise this product should make on every page.
   */
  unverified?: boolean;
}

export const DASHBOARD_QUICK_ACTIONS: QuickAction[] = [
  { id: "qa-ask", label: "Ask Sunny a question", href: "/chat", iconKey: "message-circle" },
  {
    id: "qa-coaching",
    label: "Create a coaching form",
    href: "/forms/create?template=tpl-coaching",
    iconKey: "file-plus",
  },
  { id: "qa-stats", label: "Review Daily Stats", href: "/reports", iconKey: "line-chart" },
  {
    id: "qa-l10",
    label: "Open L10 Meetings",
    href: "https://preview--leadership-sync-tool.lovable.app/",
    iconKey: "calendar-check",
    external: true,
    /*
     * A Lovable PREVIEW host, not a production domain, and it could not be
     * reached to confirm it resolves. Shown in demo, withheld from live until
     * somebody confirms the real URL — the same bar `data/resources.ts` sets.
     */
    unverified: true,
  },
];
