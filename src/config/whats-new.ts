import { HOME_ADDRESS_MANAGER_ROLES } from "@/lib/employees/woven/home-address-access";
import { ADMIN_CONSOLE_ROLES, canAccessAdminConsole } from "@/lib/permissions";
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
 *   - before (optional): leave it out when there is nothing useful to say about how it was.
 *   - audience (optional): "HR only" or "Admin only", a red badge beside the tag.
 *   - note (optional): a caveat shown in red under How to use it.
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
/** The red "HR ONLY" / "ADMIN ONLY" badge (the owner, 28 Nov 2026). A label only: who SEES the entry is still
 * permission / adminConsole / roles. */
export type WhatsNewAudience = "HR only" | "Admin only" | "Admin and HR only";

export interface WhatsNewEntry {
  readonly tag: WhatsNewTag;
  readonly title: string;
  readonly before?: string;
  /** Who the feature is for, shown as a red badge beside the tag (the owner, 28 Nov 2026). */
  readonly audience?: WhatsNewAudience;
  /** A caveat the reader must not miss, shown in red under How to use it (the owner, 28 Nov 2026). */
  readonly note?: string;
  readonly now: string;
  readonly howToUse: string;
  readonly showMe?: { readonly href: string; readonly label: string };
  readonly permission?: Permission;
  readonly adminConsole?: true;
  readonly roles?: readonly Role[];
  /**
   * visibleTo "admins_and_hr": only the admin console roles and the people on HR's notice list (WOVEN_HR_NOTIFY_EMAILS, read on
   * the server: `wovenHrNotifyFor`). For a feature HR has by email, not by role (Pau, 28 Nov 2026: "ADMIN and HR Only").
   */
  readonly visibleTo?: "admins_and_hr";
  readonly image?: { readonly src: string; readonly alt: string };
}

export interface WhatsNewRelease {
  readonly date: string;
  readonly summary: string;
  readonly entries: readonly WhatsNewEntry[];
}

export const WHATS_NEW: readonly WhatsNewRelease[] = [
  {
    // HOLD (28 Nov 2026): merge only once the Woven hire and termination notices are merged (#1393) and switched on in
    // production (NEW_HIRE_NOTICES_ENABLED); date this release on the day they go live.
    date: "2026-11-28",
    summary: "Hires and terminations from Woven in your Notifications, for administrators and HR.",
    entries: [
      {
        tag: "New",
        title: "New hires from Woven in your Notifications",
        before: "You found out about a new hire only when someone told you.",
        now: "When Woven records a new hire, a notice says who they are, their Woven email, their position and salon, and any other salons they work at. Administrators, HR, and the Salon Director and Assistant Salon Director of that salon get it. Tanning Consultants are not announced.",
        howToUse: "Open the Notifications bar under Overview. Administrators can press the notice to open the Employee Directory.",
        audience: "Admin and HR only",
        visibleTo: "admins_and_hr",
      },
      {
        tag: "New",
        title: "Terminations from Woven, with their sign-in status",
        before: "A termination in Woven reached Ask Sunny without anyone being told.",
        now: "When Woven records a termination, HR gets a notice with the termination date, position and salon, and whether the person's Ask Sunny sign-in is already turned off. If it is still on, the notice says so, so an administrator can turn it off in Users.",
        howToUse: "Open the Notifications bar under Overview and check the sign-in line on each termination.",
        audience: "Admin and HR only",
        visibleTo: "admins_and_hr",
      },
    ],
  },
  {
    date: "2026-11-27",
    summary: "One calendar for follow-ups and every L10, talking to Sunny, attaching files, the exit form's address, and a better phone layout.",
    entries: [
      {
        tag: "New",
        title: "The Calendar",
        before: "Follow-ups, forms waiting for HR, Google Reviews checks and L10 meetings were each in a different place.",
        now: "One calendar shows your follow-ups, forms waiting for HR, Google Reviews checks, your reminders, every L10 and US holidays. An employee's name on a form's entry is shown only to administrators, HR, the form's creator and whoever owns its follow-up.",
        howToUse: "Open Calendar from the sidebar, or ask Sunny \"what's on my calendar this week?\".",
        showMe: { href: "/calendar", label: "Calendar" },
        permission: "view_overview",
        image: { src: "/whats-new/2026-11-27/calendar.webp", alt: "The Calendar for November with follow-ups, an HR approval, a Google Reviews check, a holiday and weekly L10s, and the chosen day listed below it." },
      },
      {
        tag: "Improved",
        title: "The Calendar stays open beside every page",
        before: "To check the calendar you had to leave the page you were on.",
        now: "The Calendar sits on the right of the screen and stays open as you move between pages. Fold it down to a tab when you need the room, or drag it wider.",
        howToUse: "Press the Calendar tab on the right edge of any page to open it; press » to fold it back, or drag its left edge to make it wider.",
        showMe: { href: "/calendar", label: "Calendar" },
        permission: "view_overview",
      },
      {
        tag: "Improved",
        title: "L10 meetings on the Calendar",
        before: "An L10's time could only be changed in the Leadership Hub, and the calendar did not show who attends.",
        now: "Every recurring L10 is on the Calendar with its day, time, length and attendees. Change a meeting's time for every week or for one date, and its attendees are told. Only attendees and administrators can open a meeting; everyone else sees its name and day.",
        howToUse: "Press an L10 on the Calendar, then press Edit time on its Time row.",
        showMe: { href: "/calendar", label: "Calendar" },
        permission: "view_overview",
        image: { src: "/whats-new/2026-11-27/meeting-edit-time.webp", alt: "An L10 opened from the Calendar, with its day, time, length and attendees, and Edit time open with Every week or Only this date." },
      },
      {
        tag: "New",
        title: "Hand a follow-up to someone else",
        before: "A form's follow-up always stayed with whoever filed the form.",
        now: "Give a form's follow-up to someone else who can open that salon's forms, such as your DM. It goes on their calendar with reminders, and you still get the reminders too.",
        howToUse: "On Form Monitoring or on the form, press Change next to Owner under the follow-up date, pick the person and press Save owner, or ask Sunny \"assign this follow-up to someone else\".",
        showMe: { href: "/forms/monitoring", label: "Form Monitoring" },
        permission: "view_form_monitoring",
      },
      {
        tag: "New",
        title: "Talk to Sunny instead of typing",
        before: "You had to type every question.",
        now: "Every Sunny chat box has a microphone. In the Ask Sunny chat your words appear as you speak; elsewhere they fill the box when you stop. Sunny matches names to the staff list's spelling where it can tell who is meant, and you can choose which microphone to use.",
        howToUse: "Press the microphone and speak. In the Ask Sunny chat, press the check mark to send or the cross to cancel.",
        showMe: { href: "/chat", label: "Ask Sunny" },
        permission: "ask_questions",
        image: { src: "/whats-new/2026-11-27/microphone.webp", alt: "The chat box with the microphone button and the Microphone list for choosing which microphone to use." },
      },
      {
        tag: "New",
        title: "Attach files in the chat",
        before: "To ask about a file you had to copy its contents into the chat.",
        now: "Attach up to five files at a time and ask about them. Pictures: Sunny reads what is in them, text included, so a photo of a handwritten note or a screenshot of a sales report works; large photos are made smaller first. PDFs, scanned pages included. Word documents, tables included. Excel workbooks, each sheet read as a table. CSV, text and Markdown files are read as they are. Sunny reads about the first 120,000 characters of each Word, Excel or text file. The DM L10 assistant takes the same files.",
        howToUse: "Press the paperclip in the chat box, or drop files on it, then ask, for example \"what does this note say?\". Re-save an old .doc or .xls file as .docx, .xlsx or PDF first, and double-check any total that matters.",
        showMe: { href: "/chat", label: "Ask Sunny" },
        permission: "ask_questions",
        image: { src: "/whats-new/2026-11-27/attach-files.webp", alt: "The chat box with a sample sales report attached and a question about it, ready to send." },
      },
      {
        tag: "Improved",
        title: "Sunny on your phone",
        before: "On a phone the chat showed only a small part of the conversation, and the Overview's buttons were too big.",
        now: "The whole conversation fits on the screen, the app is more compact, and the Overview's suggestion buttons are smaller.",
        howToUse: "Open Ask Sunny on your phone and chat as usual.",
        image: { src: "/whats-new/2026-11-27/phone.webp", alt: "Ask Sunny on a phone: the question, the start of the answer and the chat box all fit on the screen." },
      },
      {
        tag: "New",
        title: "The exit form fills in the Permanent Address",
        before: "You typed the employee's home address on the Resignation/Exit form yourself.",
        now: "On the Resignation/Exit form, the employee's Permanent Address now fills in automatically from their Woven employee record. If Sunny can't find one clear address for them, the line stays blank for you to fill in by hand.",
        howToUse: "Ask Sunny to start a Resignation/Exit form for the employee, then check the Permanent Address line before you finalize.",
        roles: [...ADMIN_CONSOLE_ROLES, ...HOME_ADDRESS_MANAGER_ROLES],
      },
    ],
  },
  {
    date: "2026-11-26",
    summary: "A What's New page, reminders for follow-ups and new lessons, detailed coaching answers, and wider search and scope for HR, DMs and RMs.",
    entries: [
      {
        tag: "New",
        title: "What's New",
        before: "New features arrived without a word; you found them by chance.",
        now: "This page lists recent updates, newest first, and Sunny can tell you about them.",
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
        howToUse: "Open the notification to see your follow-ups on Form Monitoring, or mark it Completed or extend it right there, or ask Sunny \"how many follow-ups are overdue?\".",
        showMe: { href: "/forms/monitoring", label: "Form Monitoring" },
        permission: "view_form_monitoring",
      },
      {
        tag: "New",
        title: "Search every form for one employee",
        audience: "HR only",
        before: "HR scrolled Form Monitoring to find one person's forms, and older ones were past the end of the list.",
        now: "HR and administrators type an employee's name and see every form on file for them, drafts included, with the date.",
        howToUse: "On Form Monitoring, type the name in the search bar, then narrow it to Drafts, Finalized or Approved by HR.",
        showMe: { href: "/forms/monitoring", label: "Form Monitoring" },
        permission: "view_form_monitoring",
      },
      {
        tag: "New",
        title: "Employee address in the Employee Directory",
        audience: "Admin only",
        before: "An employee's home address was only in Woven.",
        now: "Administrators can see an employee's home address from Woven in the Employee Directory. It is read from Woven each time and never saved in Ask Sunny.",
        howToUse: "Open Integrations, then Woven Employee Sync, then the Employee Directory tab, and press \"Show address\" on the person's row.",
        showMe: { href: "/admin/integrations/woven", label: "Woven Employee Sync" },
        permission: "manage_integrations",
        roles: ADMIN_CONSOLE_ROLES,
        note: "If an employee has no address in Woven, none shows on the Resignation/Exit form either.",
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
      {
        tag: "Improved",
        title: "Detailed coaching answers",
        before: "Asking how to coach someone gave general advice.",
        now: "You get a plan ready to use, built from the company's coaching guide: an outline, the words to say, a role-play, an action plan with a follow-up date, and the closest training video when there is one.",
        howToUse: "Ask Sunny \"how do I coach someone who keeps showing up late?\".",
        showMe: { href: "/chat", label: "Ask Sunny" },
        permission: "ask_questions",
      },
      {
        tag: "Improved",
        title: "The Corrective Action history box fills itself",
        before: "You wrote the history box yourself, and only recent forms counted as history.",
        now: "N/A is filled in when there is no history, every earlier coaching and Corrective Action on file counts (including ones waiting for HR or sent back), and each line says whether it is a draft or finalized.",
        note: "Sunny fills it in as long as the employee has history in Form Monitoring.",
        howToUse: "Open a Corrective Action and check its history box before you finalize.",
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
        now: "A pop-up lists the blank fields, and each one is outlined in red on the form until it is filled.",
        howToUse: "Press \"Show me the blank fields\" in the pop-up to jump to the first one.",
        showMe: { href: "/chat", label: "Ask Sunny" },
        permission: "ask_questions",
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
    summary: "HR approval of forms, a Notifications bar, a bell for your L10s, and the Google Reviews leaderboard by period.",
    entries: [
      {
        tag: "New",
        title: "HR approval of forms",
        before: "A form was final the moment it was finalized; HR saw it only afterwards.",
        now: "Forms that need HR's sign-off go to HR first. HR approves, sends back or rejects each one; your approved forms say \"Approved by HR\" in Form Monitoring.",
        howToUse: "Press \"Finalize and send for approval\", then ask Sunny \"has HR approved it?\".",
        showMe: { href: "/forms/monitoring", label: "Form Monitoring" },
        permission: "view_form_monitoring",
      },
      {
        tag: "New",
        title: "Notifications bar",
        before: "There was no one place that told you what happened to your forms.",
        now: "A Notifications bar under Overview keeps everything in one list: a form's follow-up that is due or overdue (mark it Completed or extend it right there), your form going to HR, HR's notes, a form sent back or approved, and new AI Training lessons and modules. HR is told when a form is waiting for approval and reminded each weekday morning of forms still waiting, and AI Training reviewers are told when someone submits a lesson.",
        howToUse: "Open the Notifications bar and press a notice to go to it. Mark one as unread to come back to it, press × to remove one, or Clear all.",
        image: { src: "/whats-new/2026-11-24/notifications.webp", alt: "The Notifications bar opened: a follow-up due today, an HR approval, a new AI Training lesson and an HR note, with Mark all as read." },
      },
      {
        tag: "Improved",
        title: "A bell just for your L10 meetings",
        before: "The DM L10 bell's list worked differently from the Notifications bar.",
        now: "The DM L10 bell, in the meeting's top bar, now works like the Notifications bar: press × to remove one or Clear all. It covers only the meetings you attend, and tells you when someone mentions you, gives you a To-Do, adds or solves an Issue, adds or changes a Rock, or changes the meeting's time.",
        howToUse: "In the DM L10, press the bell at the top to see what changed.",
        image: { src: "/whats-new/2026-11-24/meeting-bell.webp", alt: "The DM L10 bell opened: a mention, a To-Do given to you, a new Issue and a changed meeting time." },
      },
      {
        tag: "Improved",
        title: "Google Reviews leaderboard by period",
        before: "The salon leaderboard ranked one week at a time.",
        now: "Rank salons by this month, L3, L6 or YTD, or pick a single month such as October.",
        howToUse: "On Google Reviews, open Salon Leaderboard and pick a Period, or ask Sunny \"Google reviews L3 and YTD\".",
        showMe: { href: "/reviews", label: "Google Reviews" },
        permission: "view_google_reviews",
      },
    ],
  },
  {
    date: "2026-11-21",
    summary: "Sunny sets follow-up dates, keeps your own plan steps, and records every deleted form.",
    entries: [
      {
        tag: "Improved",
        title: "A follow-up date when you promise one",
        before: "A form could say you would follow up without giving a date.",
        now: "A Corrective Action always gets a follow-up date, and another form gets one when you say you will follow up: the date you give, or a week after the form's date. You can change it.",
        howToUse: "Tell Sunny \"we will follow up next week\" when you describe the conversation.",
        showMe: { href: "/chat", label: "Ask Sunny" },
        permission: "ask_questions",
      },
      {
        tag: "Improved",
        title: "Your own steps in the Action Plan",
        before: "A Corrective Action's Action Plan used only its standard steps.",
        now: "Up to three steps you describe are added to a Corrective Action's Action Plan in your words, before its closing.",
        howToUse: "Tell Sunny the steps you agreed with the employee when you ask for the Corrective Action.",
        showMe: { href: "/chat", label: "Ask Sunny" },
        permission: "ask_questions",
      },
      {
        tag: "New",
        title: "A record of every deleted form",
        before: "Once a form was deleted, nothing showed who deleted it or when.",
        now: "Every deleted form leaves a permanent record of who deleted it, when and how. Administrators can ask Sunny.",
        howToUse: "Ask Sunny \"who deleted this employee's form?\".",
        adminConsole: true,
      },
      {
        tag: "Improved",
        title: "Due dates on L10 To-Dos",
        before: "A To-Do in the DM L10 could only say \"Next wk\".",
        now: "Give a To-Do a due date when you add it, and change it later, in both layouts.",
        howToUse: "In the DM L10, pick a date in the To-Do's date box.",
      },
      {
        tag: "Improved",
        title: "AI Training lessons in clear steps",
        before: "A lesson was one long page, and reviewers did not hear about new submissions.",
        now: "Each lesson has Objective, Learn, Practice and Submit sections, and the people who review submissions get a notification when someone submits.",
        howToUse: "Open a lesson in AI Training and work through it from the top.",
        showMe: { href: "/ai-training", label: "AI Training" },
        permission: "view_ai_training",
      },
    ],
  },
  {
    date: "2026-11-20",
    summary: "Ask Sunny about Google reviews for any period.",
    entries: [
      {
        tag: "Improved",
        title: "Google reviews in the chat for any period",
        before: "Sunny could only answer about this reporting week and last.",
        now: "Ask about a month this year, L3, L6 or YTD, for one salon or all of yours, with the same dates the Google Reviews page uses.",
        howToUse: "Ask Sunny \"how many Google reviews did my salon get in October?\".",
        showMe: { href: "/chat", label: "Ask Sunny" },
        permission: "ask_questions",
      },
    ],
  },
  {
    date: "2026-11-19",
    summary: "Google Reviews by L3, L6 and YTD, with each month lined up.",
    entries: [
      {
        tag: "Improved",
        title: "Google Reviews by L3, L6 and YTD",
        before: "Google Reviews showed weeks only, and the month-by-month rows did not line up.",
        now: "Pick L3, L6 or YTD, see each salon month by month in line, and the chart counts every review.",
        howToUse: "On Google Reviews, see L3, L6 and YTD in Month by month on the Overview, or choose one in Period on the Salon Leaderboard.",
        showMe: { href: "/reviews", label: "Google Reviews" },
        permission: "view_google_reviews",
      },
    ],
  },
  {
    date: "2026-11-18",
    summary: "AI Training inside Ask Sunny, and an L10 assistant that reads your figures.",
    entries: [
      {
        tag: "New",
        title: "AI Training",
        before: "The AI Training program lived outside Ask Sunny.",
        now: "AI Training is in the sidebar: tracks of short lessons on using AI at work. Each lesson ends with an assignment; submit your response and a reviewer approves it or asks for changes. Your submissions are listed on the lesson. A few named people manage the lessons and review the submissions.",
        howToUse: "Open AI Training from the sidebar, pick a lesson, and press Submit when you have done its assignment.",
        showMe: { href: "/ai-training", label: "AI Training" },
        permission: "view_ai_training",
        image: { src: "/whats-new/2026-11-18/ai-training.webp", alt: "AI Training: the announcement, the Claude and ChatGPT tracks, and a module of lessons to open." },
      },
      {
        tag: "Improved",
        title: "The L10 assistant reads your figures",
        before: "The L10 assistant answered only from the meeting itself.",
        now: "It also reads reports, Google reviews and forms on file when you ask.",
        howToUse: "In the DM L10, ask the assistant \"how did our Google reviews do this month?\".",
      },
    ],
  },
  {
    date: "2026-11-16",
    summary: "Sunny's new assistant for every manager.",
    entries: [
      {
        tag: "Improved",
        title: "Sunny looks things up for you",
        before: "Sunny answered from the policy manual but could not look up your forms or figures.",
        now: "Sunny looks up your forms on file, reports and Google reviews for your salons, and drafts a form as a card you check before you create it.",
        howToUse: "Ask Sunny \"show me the coaching forms for this employee\" or \"draft a corrective action for being late on Monday\".",
        showMe: { href: "/chat", label: "Ask Sunny" },
        permission: "ask_questions",
      },
    ],
  },
];

/**
 * The releases a role may see, newest first, each with only the entries it may open (a release left with none is
 * dropped). A null role, the preview with no sign-in enforced: every entry.
 */
export function whatsNewFor(
  role: Role | null,
  can: (role: Role, permission: Permission) => boolean,
  releases: readonly WhatsNewRelease[] = WHATS_NEW,
  viewer: { readonly hr?: boolean } = {},
): WhatsNewRelease[] {
  return [...releases]
    .sort((a, b) => b.date.localeCompare(a.date))
    .map((release) => ({ ...release, entries: release.entries.filter((entry) => role === null || ((!entry.permission || can(role, entry.permission)) && (!entry.adminConsole || canAccessAdminConsole(role)) && (!entry.roles || entry.roles.includes(role)) && (entry.visibleTo !== "admins_and_hr" || canAccessAdminConsole(role) || viewer.hr === true))) }))
    .filter((release) => release.entries.length > 0);
}
