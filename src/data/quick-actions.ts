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
 * THE ONE UNVERIFIED DESTINATION IS NOT HERE. L10 Meetings points at a
 * Lovable PREVIEW host that could not be reached to confirm, so it lives
 * behind the demo boundary (`lib/demo/runtime.ts`) rather than being filtered
 * out at render — a runtime filter still ships the URL, and the requirement is
 * that unverified links are absent from production assets, not merely hidden.
 * Confirm the real destination and it moves back into this list.
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
];
