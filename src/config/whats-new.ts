import type { Permission, Role } from "@/types";

/**
 * ============================================================================
 * WHAT'S NEW IN ASK SUNNY (Pau, 26 Nov 2026; CLAUDE.md §5)
 * ============================================================================
 *
 * The list the What's New page (`/whats-new`) shows and the AI reads (`read_whats_new`): recent updates and new
 * features, in a manager's words. TO ADD ONE, add an entry at the TOP of `WHATS_NEW` — nothing else changes: the page,
 * the sidebar entry, the AI's tool and its replay case all read this list.
 *
 * Why a typed file and not a table: the entries change when the app changes, so they ship in the same pull request as
 * the feature, reviewed with it; there is no migration, no admin screen and no seed to keep in step, and the page and
 * the AI read the same list with no database call. `whats-new.test.ts` checks every entry (date, order, a link that
 * is a real page, and the permission of that page).
 *
 * An entry:
 *   - date: the day it reached the app, YYYY-MM-DD;
 *   - title and description: plain manager language, no flag or code names;
 *   - href (optional): the page it is about;
 *   - permission (optional): the permission that page's own gate takes. A role without it never sees the entry, on
 *     the page or from the AI, so nobody is told about a screen they cannot open. Leave it out for something everyone
 *     signed in has.
 *
 * This is Ask Sunny's list, from Ask Sunny's own changes. The sibling app keeps its own.
 */
export interface WhatsNewEntry {
  readonly date: string;
  readonly title: string;
  readonly description: string;
  readonly href?: string;
  readonly permission?: Permission;
}

export const WHATS_NEW: readonly WhatsNewEntry[] = [
  {
    date: "2026-11-26",
    title: "What's New",
    description: "This page: a list of recent updates to Ask Sunny, newest first. You can also ask Sunny \"what's new?\" in the chat.",
    href: "/whats-new",
  },
  {
    date: "2026-11-26",
    title: "New AI Training lessons are announced",
    description: "When a new lesson or module is posted in AI Training, you get a notification that opens it.",
    href: "/ai-training",
    permission: "view_ai_training",
  },
  {
    date: "2026-11-26",
    title: "Follow-up reminders in Notifications",
    description: "Whoever filed a form gets a notification when its follow-up is due, and another if it becomes overdue.",
    href: "/forms/monitoring",
    permission: "view_form_monitoring",
  },
  {
    date: "2026-11-26",
    title: "Search every form for one employee",
    description: "HR and administrators can type an employee's name on Form Monitoring and see every form on file for them, drafts included, with the date. Narrow it to Drafts, Finalized or Approved by HR.",
    href: "/forms/monitoring",
    permission: "view_form_monitoring",
  },
  {
    date: "2026-11-26",
    title: "Employee address in the Employee Directory",
    description: "Administrators can press \"Show address\" in the Employee Directory to see one person's home address from Woven. Nothing is saved.",
    href: "/admin/integrations/woven",
    permission: "manage_integrations",
  },
  {
    date: "2026-11-26",
    title: "District and Regional Managers see their whole area",
    description: "Form Monitoring, the Overview and Sunny's forms on file now cover every salon in your district or region, and you can file a form for any of them.",
    href: "/forms/monitoring",
    permission: "view_form_monitoring",
  },
  {
    date: "2026-11-25",
    title: "Missing fields explained at Finalize",
    description: "If a form still has blank fields when you press Finalize, a pop-up lists them and each one is outlined in red on the form until it is filled.",
    href: "/forms/monitoring",
    permission: "view_form_monitoring",
  },
  {
    date: "2026-11-25",
    title: "Create a form from this conversation",
    description: "In the chat, \"Create a form from this conversation\" picks the right form for what you discussed and shows its card for you to check before you create it.",
    href: "/chat",
    permission: "ask_questions",
  },
  {
    date: "2026-11-24",
    title: "Delete several drafts at once",
    description: "On Form Monitoring, tick several drafts and delete them together.",
    href: "/forms/monitoring",
    permission: "manage_form_records",
  },
  {
    date: "2026-11-24",
    title: "Notifications bar",
    description: "A Notifications bar under Overview tells you when your form went to HR, when HR left a note, sent it back or approved it. Mark a notice as unread to keep it at the top.",
  },
  {
    date: "2026-11-24",
    title: "HR approval of forms",
    description: "Forms that need HR's sign-off are sent with \"Finalize and send for approval\". HR approves, sends back or rejects each one; approved forms are on the Approved tab, and you can ask Sunny \"has HR approved it?\".",
    href: "/forms/monitoring",
    permission: "view_form_monitoring",
  },
  {
    date: "2026-11-24",
    title: "Google Reviews leaderboard by period",
    description: "Rank salons by This month, L3, L6 or YTD, or pick a single month such as October.",
    href: "/reviews",
    permission: "view_google_reviews",
  },
];

/** The entries a role may see, newest first (a null role, the preview with no sign-in enforced: every entry). */
export function whatsNewFor(role: Role | null, can: (role: Role, permission: Permission) => boolean, entries: readonly WhatsNewEntry[] = WHATS_NEW): WhatsNewEntry[] {
  return [...entries]
    .filter((entry) => !entry.permission || role === null || can(role, entry.permission))
    .sort((a, b) => b.date.localeCompare(a.date));
}
