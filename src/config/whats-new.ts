import { canAccessAdminConsole } from "@/lib/permissions";
import type { Permission, Role } from "@/types";

/**
 * ============================================================================
 * WHAT'S NEW IN ASK SUNNY (Pau, 26 Nov 2026; CLAUDE.md §5)
 * ============================================================================
 *
 * The list the What's New page (`/whats-new`) shows and the AI reads (`read_whats_new`): recent updates and new
 * features, in a manager's words. TO ADD ONE, add an entry to the newest release at the TOP of `WHATS_NEW` (or a new
 * release above it) — nothing else changes: the page, the sidebar entry, the AI's tool and its replay case all read this
 * list.
 *
 * Why a typed file and not a table: the entries change when the app changes, so they ship in the same pull request as
 * the feature, reviewed with it; there is no migration, no admin screen and no seed to keep in step, and the page and
 * the AI read the same list with no database call. `whats-new.test.ts` checks every entry.
 *
 * THE FORMAT (the owner, 26 Nov 2026: the sibling product's What's New, format only):
 *   - releases newest first, each with its date (YYYY-MM-DD) and a one-line summary;
 *   - each entry tagged New or Improved, in three short parts: before (what it was like), now (what changed), howToUse
 *     (one concrete instruction, or a phrase to type in the chat);
 *   - showMe (optional): the page it is about, for a "Show me" link;
 *   - permission (optional): the permission that page's own gate takes. A role without it never sees the entry, on the
 *     page or from the AI, so nobody is told about a screen they cannot open. Leave it out for what everyone has.
 *   - adminConsole (optional): true when that page is an admin console page (`requireAdminConsolePage`): only the roles
 *     that open the admin console see the entry, whatever permissions another role holds.
 *   Plain manager language: no flag or code names.
 *
 * This is Ask Sunny's list, from Ask Sunny's own changes. The sibling app keeps its own.
 */

/**
 * NEXT_PUBLIC_WHATS_NEW_ENABLED (Pau, 27 Nov 2026: "hide this for everyone, for now pls, i will roll it out later").
 * Off: nobody sees What's New — no sidebar entry (nor in search), the page is a 404 and read_whats_new reads nothing.
 * Set it to `true` in Vercel and redeploy to roll it out. READ AT BUILD TIME, like `asdNoFormMonitoringEnabled`: a
 * literal `process.env.NEXT_PUBLIC_…` Next inlines into the browser and the server alike, so the sidebar and the page
 * never disagree. Keep adding entries below while it is off; they show the day it is turned on.
 */
export function whatsNewEnabled(): boolean {
  const raw = process.env.NEXT_PUBLIC_WHATS_NEW_ENABLED;
  return typeof raw === "string" && ["1", "true", "yes", "on"].includes(raw.trim().toLowerCase());
}
export type WhatsNewTag = "New" | "Improved";

export interface WhatsNewEntry {
  readonly tag: WhatsNewTag;
  readonly title: string;
  readonly before: string;
  readonly now: string;
  readonly howToUse: string;
  readonly showMe?: { readonly href: string; readonly label: string };
  readonly permission?: Permission;
  readonly adminConsole?: true;
}

export interface WhatsNewRelease {
  readonly date: string;
  readonly summary: string;
  readonly entries: readonly WhatsNewEntry[];
}

export const WHATS_NEW: readonly WhatsNewRelease[] = [
  {
    date: "2026-11-27",
    summary: "Administrators can ask Sunny which documents the Knowledge Base holds.",
    entries: [
      {
        tag: "Improved",
        title: "Ask Sunny about the Knowledge Base's documents",
        before: "Sunny could quote what a document says, but could not tell you which documents the Knowledge Base holds or whether one had failed.",
        now: "Administrators can ask which documents there are, when one was last updated, and which failed and why. Everyone else still gets answers from the documents themselves.",
        howToUse: "Ask Sunny \"which documents do we have?\" or \"did any document fail to sync?\".",
        showMe: { href: "/knowledge", label: "Knowledge Base" },
        permission: "view_knowledge",
        adminConsole: true,
      },
    ],
  },
  {
    date: "2026-11-26",
    summary: "A What's New page, reminders for follow-ups and new lessons, and wider search and scope for HR, DMs and RMs.",
    entries: [
      {
        tag: "New",
        title: "What's New",
        before: "New features arrived without a word; you found them by chance.",
        now: "This page lists every update, newest first, and Sunny can tell you about them.",
        howToUse: "Open What's New from the sidebar, or ask Sunny \"what's new?\".",
        showMe: { href: "/whats-new", label: "What's New" },
      },
      {
        tag: "Improved",
        title: "Ask Sunny about more pages",
        before: "Sunny could not answer questions about Bed Usage, Spa Engagement, Spa Wellness, Videos, Manager Resources or AI Training.",
        now: "Sunny reads those pages for you, with the same access you have, and says which period and data date each report figure is for.",
        howToUse: "Ask Sunny \"how many tans per bed are we doing this month?\" or \"is there a training video on cleaning the beds?\".",
        showMe: { href: "/chat", label: "Ask Sunny" },
        permission: "ask_questions",
      },
      {
        tag: "New",
        title: "The list of pages Sunny can read",
        before: "There was no way to see in the app which pages Sunny can read and which it cannot.",
        now: "Administrators see every page, whether Sunny can read it, the tool it uses, and why not when it cannot.",
        howToUse: "Open Admin, then AI-readable pages.",
        showMe: { href: "/admin/ai-readable-pages", label: "AI-readable pages" },
        permission: "view_ai_usage",
        adminConsole: true,
      },
      {
        tag: "New",
        title: "New AI Training lessons are announced",
        before: "A new lesson or module in AI Training showed up silently.",
        now: "You get a notification when a new lesson or module is posted, and it opens the lesson.",
        howToUse: "Watch the Notifications bar under Overview, or ask Sunny \"what lessons are in AI Training?\".",
        showMe: { href: "/ai-training", label: "AI Training" },
        permission: "view_ai_training",
      },
      {
        tag: "New",
        title: "Follow-up reminders in Notifications",
        before: "You had to remember to check when a form's follow-up was due.",
        now: "Whoever filed the form gets a notification when its follow-up is due, and another if it becomes overdue.",
        howToUse: "Open the notification to go to the form, or ask Sunny \"how many follow-ups are overdue?\".",
        showMe: { href: "/forms/monitoring", label: "Form Monitoring" },
        permission: "view_form_monitoring",
      },
      {
        tag: "New",
        title: "Search every form for one employee",
        before: "HR scrolled Form Monitoring to find one person's forms, and older ones were past the end of the list.",
        now: "HR and administrators type an employee's name and see every form on file for them, drafts included, with the date.",
        howToUse: "On Form Monitoring, type the name in the search bar, then narrow it to Drafts, Finalized or Approved by HR.",
        showMe: { href: "/forms/monitoring", label: "Form Monitoring" },
        permission: "view_form_monitoring",
      },
      {
        tag: "New",
        title: "Employee address in the Employee Directory",
        before: "An employee's home address was only in Woven.",
        now: "Administrators can see one person's home address from Woven in the Employee Directory. Nothing is saved.",
        howToUse: "In the Employee Directory, press \"Show address\" on the person's row.",
        showMe: { href: "/admin/integrations/woven", label: "Woven integration" },
        permission: "manage_integrations",
      },
      {
        tag: "Improved",
        title: "District and Regional Managers see their whole area",
        before: "A District or Regional Manager saw only the salons listed on their own account.",
        now: "Form Monitoring, the Overview and Sunny's forms on file cover every salon in your district or region, and you can file a form for any of them.",
        howToUse: "Ask Sunny \"show me the coaching forms in my district this month\".",
        showMe: { href: "/forms/monitoring", label: "Form Monitoring" },
        permission: "view_form_monitoring",
      },
    ],
  },
  {
    date: "2026-11-25",
    summary: "Clearer Finalize, and a better \"Create a form from this conversation\".",
    entries: [
      {
        tag: "Improved",
        title: "Missing fields explained at Finalize",
        before: "Finalize refused a form with blank fields and did not say which.",
        now: "A pop-up lists the blank fields, and each one is outlined in red on the form until it is filled.",
        howToUse: "Press \"Show me the blank fields\" in the pop-up to jump to the first one.",
        showMe: { href: "/forms/monitoring", label: "Form Monitoring" },
        permission: "view_form_monitoring",
      },
      {
        tag: "Improved",
        title: "Create a form from this conversation",
        before: "The button could leave you unsure whether a form card had been made.",
        now: "It picks the right form for what you discussed and shows its card for you to check before you create it.",
        howToUse: "After describing what happened in the chat, press \"Create a form from this conversation\".",
        showMe: { href: "/chat", label: "Ask Sunny" },
        permission: "ask_questions",
      },
    ],
  },
  {
    date: "2026-11-24",
    summary: "HR approval of forms, a Notifications bar, and the Google Reviews leaderboard by period.",
    entries: [
      {
        tag: "New",
        title: "HR approval of forms",
        before: "A form was final the moment it was finalized; HR saw it only afterwards.",
        now: "Forms that need HR's sign-off go to HR first. HR approves, sends back or rejects each one; approved forms are on the Approved tab.",
        howToUse: "Press \"Finalize and send for approval\", then ask Sunny \"has HR approved it?\".",
        showMe: { href: "/forms/monitoring", label: "Form Monitoring" },
        permission: "view_form_monitoring",
      },
      {
        tag: "New",
        title: "Notifications bar",
        before: "There was no one place that told you what happened to your forms.",
        now: "A Notifications bar under Overview tells you when your form went to HR, when HR left a note, sent it back or approved it.",
        howToUse: "Open the Notifications bar; mark a notice as unread to keep it at the top.",
      },
      {
        tag: "Improved",
        title: "Delete several drafts at once",
        before: "Drafts were deleted one at a time.",
        now: "You can tick several drafts and delete them together.",
        howToUse: "On Form Monitoring, tick the drafts' checkboxes and press Delete.",
        showMe: { href: "/forms/monitoring", label: "Form Monitoring" },
        permission: "manage_form_records",
      },
      {
        tag: "Improved",
        title: "Google Reviews leaderboard by period",
        before: "The salon leaderboard ranked one week at a time.",
        now: "Rank salons by this month, L3, L6 or YTD, or pick a single month such as October.",
        howToUse: "On Google Reviews, pick a Period on the leaderboard, or ask Sunny \"Google reviews L3 and YTD\".",
        showMe: { href: "/reviews", label: "Google Reviews" },
        permission: "view_google_reviews",
      },
    ],
  },
];

/**
 * The releases a role may see, newest first, each with only the entries it may open (a release left with none is
 * dropped). A null role, the preview with no sign-in enforced: every entry.
 */
export function whatsNewFor(role: Role | null, can: (role: Role, permission: Permission) => boolean, releases: readonly WhatsNewRelease[] = WHATS_NEW): WhatsNewRelease[] {
  return [...releases]
    .sort((a, b) => b.date.localeCompare(a.date))
    .map((release) => ({ ...release, entries: release.entries.filter((entry) => role === null || ((!entry.permission || can(role, entry.permission)) && (!entry.adminConsole || canAccessAdminConsole(role)))) }))
    .filter((release) => release.entries.length > 0);
}
