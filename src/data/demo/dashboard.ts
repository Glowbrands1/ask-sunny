import { isoHoursFromAnchor } from "@/lib/utils/date";

/** Recent Ask Sunny activity strip on the Overview screen — DEMO CONTENT. */
export interface ActivityEntry {
  id: string;
  kind: "question" | "form" | "upload" | "video" | "review";
  summary: string;
  actor: string;
  at: string;
}

export const DEMO_RECENT_ACTIVITY: ActivityEntry[] = [
  {
    id: "dash-act-1",
    kind: "question",
    summary: "Asked what to focus on in today's Daily Stats",
    actor: "MO Kansas City Wornall",
    at: isoHoursFromAnchor(-3),
  },
  {
    id: "dash-act-2",
    kind: "form",
    summary: "Drafted a Coaching Form for Tyrell Jacobs",
    actor: "Corey Vandenberg",
    at: isoHoursFromAnchor(-20),
  },
  {
    id: "dash-act-3",
    kind: "upload",
    summary: "Uploaded Google Review Request Guide to Sales & Client Experience",
    actor: "Alicia Moreno",
    at: isoHoursFromAnchor(-26),
  },
  {
    id: "dash-act-4",
    kind: "video",
    summary: "Added Spray Booth Will Not Start — First Checks",
    actor: "Corey Vandenberg",
    at: isoHoursFromAnchor(-30),
  },
  {
    id: "dash-act-5",
    kind: "question",
    summary: "Asked how to handle a price objection",
    actor: "KS Shawnee Mission Pkwy",
    at: isoHoursFromAnchor(-34),
  },
  {
    id: "dash-act-6",
    kind: "review",
    summary: "Reviewed the weekly Google review count for District 2",
    actor: "Alicia Moreno",
    at: isoHoursFromAnchor(-44),
  },
];

/*
 * THE QUICK ACTIONS LIVE IN `data/quick-actions.ts` NOW. They are navigation
 * and the activity above is not; keeping them together shipped the invented
 * activity into every page's bundle.
 */
export type { QuickAction } from "@/data/quick-actions";
export { DASHBOARD_QUICK_ACTIONS } from "@/data/quick-actions";

/**
 * Quick actions that exist only in a demo build.
 *
 * L10 Meetings points at `preview--leadership-sync-tool.lovable.app` — a
 * Lovable preview host, not a production domain, and unreachable from here to
 * confirm. Keeping it in the production list and filtering it at render would
 * still have put the URL in every production bundle.
 */
export const DEMO_QUICK_ACTIONS: QuickActionEntry[] = [
  {
    id: "qa-l10",
    label: "Open L10 Meetings",
    href: "https://preview--leadership-sync-tool.lovable.app/",
    iconKey: "calendar-check",
    external: true,
  }
];

type QuickActionEntry = import("@/data/quick-actions").QuickAction;
