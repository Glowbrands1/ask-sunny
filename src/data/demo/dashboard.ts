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
    actor: "Riverbend Commons",
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
    actor: "Cedar Point Plaza",
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
  { id: "qa-upload", label: "Upload a document", href: "/knowledge?upload=1", iconKey: "upload" },
  { id: "qa-video", label: "Watch a training video", href: "/videos", iconKey: "play-circle" },
  {
    id: "qa-l10",
    label: "Open L10 Meetings",
    href: "https://example.com/l10-meetings",
    iconKey: "calendar-check",
    external: true,
  },
];
