import type { Permission } from "@/types";

/**
 * ============================================================================
 * THE PAGES SUNNY'S AI CAN READ (board f039, QA approved 23 Nov 2026; CLAUDE.md §5)
 * ============================================================================
 *
 * Pau, 20 Nov 2026: "how can we program this AI to read new things added to the app? i need to always say it?" — no:
 * every page under `src/app/(app)` has an entry here, and `ai-readable-pages.test.ts` fails when one has none. An entry
 * names the tool that reads the page's figures for the AI (the agent loop's data tools), or says plainly why the AI
 * cannot read it yet (`notReadable`). A new page can't merge until it declares one or the other.
 *
 * What an entry declares:
 *   - route and title, as the app shows them;
 *   - access: the gate the page itself calls (`requirePagePermission` / `requireAdminConsolePage` with its permission,
 *     or `requireAuthenticatedPage`); the test reads the page's source and checks it is the same, and that the reader
 *     tool checks the same permission (`READER_PERMISSION`), so the AI never reads more than the page shows;
 *   - reader: the tool and its args, the figures and periods in a manager's words, and a replay case that asks for it.
 *     The tool's description and the rules book's Business data line are written from these entries, so the model
 *     knows what to ask for (`readablePagesLine`, `pagesToolLine`);
 *   - or notReadable: why not, honestly. Each one is its own board item to build a reader for.
 *
 * Scope (QA): pages under `src/app/(app)`, plus an API route that returns report figures with no page behind it
 * (`kind: "api"`). Other admin-only API routes don't count.
 *
 * This is Ask Sunny's list. The sibling app keeps its own, from its own pages; port the mechanism, not this list.
 */

/** The loop tools that read a page's figures. */
export type PageReaderTool = "read_reviews" | "read_stats" | "find_past_forms" | "read_hr_approvals" | "read_follow_ups" | "read_calendar" | "read_whats_new" | "read_videos" | "read_manager_resources" | "read_ai_training" | "read_knowledge_documents" | "read_meeting";

export interface PageReader {
  readonly tool: PageReaderTool;
  /** The args that read this page, as the tool takes them. */
  readonly args: Readonly<Record<string, string>>;
  /** The figures, as the page labels them and a manager asks for them. */
  readonly figures: readonly string[];
  /** The periods the reader returns, in a manager's words. */
  readonly periods: readonly string[];
  /** A replay case that asks for this page's figures in a manager's words (`src/app/api/chat/replay-pack/`). */
  readonly replayCase: string;
}

/** The gate the page (or route) calls first. */
export type PageAccess =
  | { readonly permission: Permission; readonly adminConsole?: true }
  | { readonly signedIn: true; readonly note: string }
  | { readonly signedRequest: string };

interface PageBase {
  readonly kind: "page" | "api";
  /** The URL, with its dynamic segments as the folder names spell them (`/reports/salon-performance/[salon]`). */
  readonly route: string;
  readonly title: string;
  readonly access: PageAccess;
}

export type AiReadablePage =
  | (PageBase & { readonly reader: PageReader; readonly notReadable?: never })
  | (PageBase & { readonly reader?: never; readonly notReadable: string });

const REVIEWS_READER: PageReader = {
  tool: "read_reviews",
  args: {},
  figures: ["qualifying reviews against the monthly goal", "this week and last week", "the average star", "the latest reviews", "each salon's figure for one month (the leaderboard's Period)"],
  periods: ["month to date", "this week", "last week", "L3", "L6", "YTD", "each month"],
  replayCase: "nov19-google-reviews-l3-l6-ytd-agent-loop",
};

const NO_LOOP_READER = "no tool of the chat or the agent loop reads it.";
const ADMIN = "An admin console page: ";
/*
 * Pau, 28 Nov 2026: "why it cant read this?" then "ok but depends on the access of the user ok? admin gets all". read_meeting
 * reads the meeting pages from the Leadership Hub as the person asking: the pages' own sign-in, then the Hub's answer
 * (the meeting's attendees, and the Hub's admins, who get every meeting). Anyone else is told they are not an attendee.
 */
const MEETING_CASE = "nov28-meeting-content-reaches-the-model";
const MEETING_NOW: PageReader = {
  tool: "read_meeting",
  args: {},
  figures: ["each to-do's owner, due date and whether it is overdue", "the open issues (short-term and long-term) and the ones solved most recently", "headlines and rocks", "each scorecard metric's latest weeks against its goal", "the meeting notes and cascading message"],
  periods: ["now", "the latest past meetings"],
  replayCase: MEETING_CASE,
};
const MEETING_PAST: PageReader = {
  tool: "read_meeting",
  args: { part: "past" },
  figures: ["each past meeting's date, length and rating", "who came and how they rated it", "the issues solved and the to-dos left open", "its notes and cascading message"],
  periods: ["each past meeting, newest first"],
  replayCase: MEETING_CASE,
};
const MEETING_HISTORY: PageReader = {
  tool: "read_meeting",
  args: { part: "history" },
  figures: ["who saved each version of the meeting, and when"],
  periods: ["the latest saved versions"],
  replayCase: MEETING_CASE,
};
const TRAINING_EDITOR = "The AI Training editors' console (drafts, the archive, editing), for the editor list only: an admin console; " + NO_LOOP_READER;

export const AI_READABLE_PAGES: readonly AiReadablePage[] = [
  /*
   * QA, 24 Nov 2026: the follow-up queue is one set of forms the Overview, the sidebar badge and Form Monitoring's
   * banner and Open / Overdue pills all count (`readFollowUpQueue`); read_follow_ups reads that set. The Notifications
   * bar (its × and Clear all) is each viewer's own notices; no tool reads it, and an HR decision in it is read by
   * read_hr_approvals.
   */
  { kind: "page", route: "/", title: "Overview", access: { permission: "view_overview" },
    reader: { tool: "read_follow_ups", args: {}, figures: ["follow-ups overdue, due this week and open", "each follow-up's employee, form, salon and date"], periods: ["today", "this business week"], replayCase: "nov24-follow-ups-overdue-same-count-as-the-overview" } },
  /* Pau, 26 Nov 2026: one calendar with the Leadership Hub and Ask Bubbles; read_calendar is the page's own read. */
  { kind: "page", route: "/calendar", title: "Calendar", access: { permission: "view_overview" },
    reader: { tool: "read_calendar", args: {}, figures: ["each follow-up, HR approval, Google Reviews check, reminder and L10 meeting by day and Central time", "which are overdue or due today", "who can see a reminder"], periods: ["this week", "next week", "a day", "a date range"], replayCase: "nov26-calendar-whats-on-my-calendar-this-week" } },
  /* Pau, 26 Nov 2026: recent updates, from `src/config/whats-new.ts`; an entry about a page only for a role that may open it. */
  { kind: "page", route: "/whats-new", title: "What's New", access: { permission: "view_overview" },
    reader: { tool: "read_whats_new", args: {}, figures: ["each release's date and summary", "each update's tag (New or Improved), before, now and how to use it", "its Show me page"], periods: ["newest first", "since a day"], replayCase: "nov26-whats-new-reaches-the-model" } },
  { kind: "page", route: "/chat", title: "Chat", access: { permission: "ask_questions" }, notReadable: "The chat itself: nothing on it to read." },

  { kind: "page", route: "/reviews", title: "Google Reviews", access: { permission: "view_google_reviews" }, reader: REVIEWS_READER },
  { kind: "page", route: "/reviews/setup", title: "Google Reviews setup", access: { permission: "manage_integrations" },
    notReadable: "The Google Reviews connection settings: no figures." },

  { kind: "page", route: "/reports/sales-totals", title: "Sales Totals", access: { permission: "view_reports" },
    reader: { tool: "read_stats", args: { report: "sales totals" }, figures: ["the Sales Totals measures, as the page labels them", "how current the report is"], periods: ["a single day", "month to date"], replayCase: "nov23-f039-readable-pages-reach-the-model" } },
  { kind: "page", route: "/reports/salon-performance", title: "Salon Performance (Comp)", access: { permission: "view_reports" },
    reader: { tool: "read_stats", args: { report: "comp" }, figures: ["the Comp report's measures per salon, as the page labels them", "how current the report is"], periods: ["month to date", "year to date"], replayCase: "nov15-agent-loop-daily-stats-own-salons" } },
  { kind: "page", route: "/reports/salon-performance/[salon]", title: "Salon Performance for one salon", access: { permission: "view_reports" },
    reader: { tool: "read_stats", args: { report: "comp", salon: "<the salon>" }, figures: ["one salon's Comp measures"], periods: ["month to date", "year to date"], replayCase: "nov15-agent-loop-daily-stats-own-salons" } },
  /* Pau, 26 Nov 2026 (CLAUDE.md §5): the bed and spa reports, through read_stats, each its own report family. */
  { kind: "page", route: "/reports/bed-usage", title: "Bed Usage", access: { permission: "view_reports" },
    reader: { tool: "read_stats", args: { report: "bed usage" }, figures: ["total tans, bed quantity and tans per bed per salon and equipment level", "performance against the chain", "how current the report is"], periods: ["month to date"], replayCase: "nov26-f039-bed-usage-reaches-the-model" } },
  { kind: "page", route: "/reports/spa-engagement", title: "Spa Engagement", access: { permission: "view_reports" },
    reader: { tool: "read_stats", args: { report: "spa engagement" }, figures: ["spa sessions, unique tanners and unique spa tanners per salon", "spa beds, sessions per bed and the published ranks", "how current the report is"], periods: ["month to date"], replayCase: "nov26-f039-spa-engagement-reaches-the-model" } },
  { kind: "page", route: "/reports/spa-wellness", title: "Spa Wellness", access: { permission: "view_reports" },
    reader: { tool: "read_stats", args: { report: "spa wellness" }, figures: ["spa sessions by equipment type against peers with the same equipment", "first and last use dates", "how current the report is"], periods: ["month to date", "year to date", "last twelve months"], replayCase: "nov26-f039-spa-wellness-reaches-the-model" } },

  { kind: "page", route: "/forms/monitoring", title: "Form Monitoring", access: { permission: "view_form_monitoring" },
    reader: { tool: "find_past_forms", args: {}, figures: ["the forms on file per person, form and date", "their counts", "each form's status"], periods: ["a date", "a date range", "this month"], replayCase: "nov20-f081-c-month-list-counts" } },
  { kind: "page", route: "/forms/monitoring/[id]", title: "One form on file", access: { permission: "view_form_monitoring" },
    reader: { tool: "find_past_forms", args: {}, figures: ["one form on file: its fields and status (then read_form)"], periods: ["the form's date"], replayCase: "nov20-f081-c-month-list-counts" } },
  { kind: "page", route: "/forms/hr-approval/[id]", title: "HR approval of one form", access: { permission: "view_form_monitoring" },
    reader: { tool: "read_hr_approvals", args: {}, figures: ["whether HR approved, sent back or rejected the form", "HR's latest note", "the sender's receipt that it went to HR", "for HR, the forms waiting and overdue"], periods: ["now"], replayCase: "nov23-hr-approval-manager-asks-has-hr-approved-it" } },
  { kind: "page", route: "/forms/templates", title: "Form templates", access: { permission: "manage_form_templates" },
    notReadable: "The template list (versions, required permission): " + NO_LOOP_READER + " propose_form uses the active templates but does not read this page." },
  { kind: "page", route: "/forms/templates/[key]", title: "Form template editor", access: { permission: "manage_form_templates" },
    notReadable: "One template's fields and versions: " + NO_LOOP_READER },

  { kind: "page", route: "/knowledge", title: "Knowledge Base", access: { permission: "view_knowledge", adminConsole: true },
    reader: { tool: "read_knowledge_documents", args: {}, figures: ["each document's title, category, status, where it came from, version and when it was last updated", "why a document failed to process", "how many documents are ready, processing, need review or failed"], periods: ["now"], replayCase: "nov27-knowledge-documents-reach-the-model" } },
  { kind: "page", route: "/knowledge/document/[id]", title: "Knowledge document", access: { permission: "view_knowledge" },
    notReadable: "The document page (its details and status): " + NO_LOOP_READER + " search_knowledge searches the document's text, under the chat's permission, not this page's." },

  { kind: "page", route: "/meetings", title: "Meetings", access: { signedIn: true, note: "redirects to the first meeting" }, reader: MEETING_NOW },
  { kind: "page", route: "/meetings/[key]", title: "Meeting", access: { signedIn: true, note: "then the meeting's own open check" }, reader: MEETING_NOW },
  { kind: "page", route: "/meetings/[key]/history", title: "Meeting history", access: { signedIn: true, note: "then the meeting's own open check" }, reader: MEETING_HISTORY },
  { kind: "page", route: "/meetings/[key]/history/[version]", title: "Meeting version", access: { signedIn: true, note: "then the meeting's own open check" }, reader: { ...MEETING_HISTORY, args: { part: "history", version: "<the version>" }, figures: ["what that saved version held: its to-dos, issues, headlines, rocks and scorecard"], periods: ["that version"] } },
  { kind: "page", route: "/meetings/[key]/past", title: "Past meetings", access: { signedIn: true, note: "then the meeting's own open check" }, reader: MEETING_PAST },
  { kind: "page", route: "/meetings/[key]/recaps", title: "Meeting recaps", access: { signedIn: true, note: "then the meeting's own open check" }, reader: MEETING_PAST },
  { kind: "page", route: "/meetings/[key]/report", title: "Meeting report", access: { signedIn: true, note: "then the meeting's own open check" }, reader: { ...MEETING_NOW, figures: ["the report's rocks, issues, scorecard and recaps, as the meeting holds them"] } },

  /* Board f039 part 2 (26 Nov 2026): the video library and the manager resources links. */
  { kind: "page", route: "/videos", title: "Videos", access: { permission: "view_videos" },
    reader: { tool: "read_videos", args: {}, figures: ["each video's title, category, length, who posted it and when", "what it is about", "the videos on a topic"], periods: ["newest first"], replayCase: "nov26-f039-videos-reach-the-model" } },
  { kind: "page", route: "/resources", title: "Manager resources", access: { permission: "view_manager_resources" },
    reader: { tool: "read_manager_resources", args: {}, figures: ["each link's name, what it is, category and link", "that none are listed yet, when the page has none"], periods: ["now"], replayCase: "nov26-f039-manager-resources-reach-the-model" } },
  /* Board f039 part 2 (26 Nov 2026): the published lessons, as a reader who is not an editor sees them. */
  { kind: "page", route: "/ai-training", title: "AI training", access: { permission: "view_ai_training" },
    reader: { tool: "read_ai_training", args: {}, figures: ["each published lesson's track, module, week, title and summary", "when each was posted", "the lessons on a topic"], periods: ["in course order"], replayCase: "nov26-f039-ai-training-reaches-the-model" } },
  { kind: "page", route: "/ai-training/[track]/[slug]", title: "AI training lesson", access: { permission: "view_ai_training" },
    reader: { tool: "read_ai_training", args: {}, figures: ["the lesson's title, summary, track, module and week (its full text stays on the page)"], periods: ["in course order"], replayCase: "nov26-f039-ai-training-reaches-the-model" } },
  { kind: "page", route: "/ai-training/manage", title: "Manage AI training", access: { permission: "view_ai_training" }, notReadable: TRAINING_EDITOR },
  { kind: "page", route: "/ai-training/manage/lessons/[id]", title: "Edit AI training lesson", access: { permission: "view_ai_training" }, notReadable: TRAINING_EDITOR },

  /* QA, 24 Nov 2026: this list, shown to admins in the app (generated from it, so it cannot drift). */
  { kind: "page", route: "/admin/ai-readable-pages", title: "AI-readable pages", access: { permission: "view_ai_usage", adminConsole: true },
    notReadable: ADMIN + "this list of pages itself; the AI is given it as its rules book's page line and its tools' descriptions, not as a page to read." },
  { kind: "page", route: "/admin/ai-usage", title: "AI usage", access: { permission: "view_ai_usage" }, notReadable: ADMIN + "AI usage and spend figures; " + NO_LOOP_READER },
  { kind: "page", route: "/admin/analytics", title: "Analytics", access: { permission: "view_analytics" }, notReadable: ADMIN + "chat analytics figures; " + NO_LOOP_READER },
  { kind: "page", route: "/admin/analytics/[view]", title: "Analytics view", access: { permission: "view_analytics" }, notReadable: ADMIN + "chat analytics figures; " + NO_LOOP_READER },
  { kind: "page", route: "/admin/integrations", title: "Integrations", access: { permission: "manage_integrations" }, notReadable: ADMIN + "integration settings and status; no figures." },
  { kind: "page", route: "/admin/integrations/google-reviews", title: "Google Reviews integration", access: { permission: "manage_integrations" }, notReadable: ADMIN + "the Google Reviews sync settings and status; no figures." },
  { kind: "page", route: "/admin/integrations/woven", title: "Woven integration", access: { permission: "manage_integrations" }, notReadable: ADMIN + "the Woven sync settings and status; " + NO_LOOP_READER },
  { kind: "page", route: "/admin/integrations/woven/[view]", title: "Woven integration view", access: { permission: "manage_integrations" }, notReadable: ADMIN + "the Woven sync's views; " + NO_LOOP_READER },
  { kind: "page", route: "/admin/integrations/woven-knowledge", title: "Woven knowledge sync", access: { permission: "manage_integrations" }, notReadable: ADMIN + "the Woven knowledge sync's status; " + NO_LOOP_READER },
  { kind: "page", route: "/admin/users", title: "Users", access: { permission: "manage_users" }, notReadable: ADMIN + "user accounts and roles; " + NO_LOOP_READER },

  /* An API route with report figures and no page: the Leadership Hub's assistant reads the Google Reviews page's figures. */
  { kind: "api", route: "/api/partner/hub-reviews", title: "Google Reviews for the Leadership Hub", access: { signedRequest: "verifyHubReviewsRequest" }, reader: REVIEWS_READER },
];

/** The pages (not API routes) a tool reads, once each by title. */
function pagesReadBy(pages: readonly AiReadablePage[], tool?: PageReaderTool): AiReadablePage[] {
  const seen = new Set<string>();
  return pages.filter((page) => {
    if (page.kind !== "page" || !page.reader || (tool && page.reader.tool !== tool) || seen.has(page.title)) return false;
    seen.add(page.title);
    return true;
  });
}

/** One line for a tool's description: the pages it reads, their figures and periods (empty when it reads none). */
export function pagesToolLine(pages: readonly AiReadablePage[] | undefined, tool: PageReaderTool): string {
  const read = pagesReadBy(pages ?? [], tool).filter((page) => !page.route.includes("["));
  if (read.length === 0) return "";
  return " Pages it reads: " + read.map((page) => `${page.title} (${page.reader!.figures.join(", ")}; periods: ${page.reader!.periods.join(", ")})`).join("; ") + ".";
}

/** The rules book's Business data line: every page the AI can read, and the tool that reads it (null when none). */
export function readablePagesLine(pages: readonly AiReadablePage[] | undefined): string | null {
  const read = pagesReadBy(pages ?? []).filter((page) => !page.route.includes("["));
  if (read.length === 0) return null;
  return "The app pages you can read, each only through its tool: " + read.map((page) => `${page.title} (${page.reader!.tool})`).join(", ") + ".";
}
