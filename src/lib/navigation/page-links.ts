import { NAV_SECTIONS, visibleNavSections, type NavSection, type NavVisibility } from "@/components/shell/navigation";
import { REPORTS, REPORTS_DEFAULT_PATH } from "@/features/reports/reports-routes";

/**
 * ============================================================================
 * THE PAGES SUNNY'S ANSWERS LINK TO (Pau, 28 Nov 2026)
 * ============================================================================
 *
 * "make sure if sunny or bubble direct them to a page, make sure its clickable". When an answer names a page of the
 * app ("open Form Monitoring", "it is on your Calendar", "Resources, then L10"), `RichText` turns the name into a link
 * to it, and a `[label](/path)` the model writes becomes a link when the path is one of these pages.
 *
 * WHICH PAGES: exactly the ones this person's own sidebar shows (`visibleNavSections`, the rail's rule), plus their
 * meeting tabs, plus the pages reached from one of those (each report tab, Woven Employee Sync). So an answer never
 * links a page the person cannot open: a Salon Director told about Integrations reads the word, with no link.
 *
 * DONE IN THE RENDERER, NOT ASKED OF THE MODEL, so it holds on every path the answer takes (the tool loop and the
 * older prompt alike) and for every way the model words it. A name links only as the sidebar spells it (case and
 * whole words), so "an overview of the week" or "training videos" stay text.
 *
 * Ask Sunny itself (`/chat`) is not linked: the answer is already in it.
 */
export interface PageLink {
  readonly href: string;
  /** The names an answer calls the page by, as the app spells them. */
  readonly names: readonly string[];
}

/** Other names an answer uses for a sidebar page. */
const ALSO_CALLED: Readonly<Record<string, readonly string[]>> = {
  "/": ["Home page", "Overview page"],
  "/ai-training": ["AI Training"],
  "/videos": ["Videos page"],
};

/** Pages reached from a sidebar entry: linked when that entry is in the person's sidebar. */
const REACHED_FROM: Readonly<Record<string, readonly PageLink[]>> = {
  [REPORTS_DEFAULT_PATH]: REPORTS.map((report) => ({ href: report.path, names: [report.label] })),
  "/admin/integrations": [{ href: "/admin/integrations/woven", names: ["Woven Employee Sync"] }],
};

/** Not linked: the chat the answer is in. */
const NOT_LINKED = new Set(["/chat"]);

export interface MeetingTab {
  readonly href: string;
  readonly label: string;
}

/** The pages this person's answers link to: their sidebar's, their meeting tabs (the first one also as "L10"), and the pages reached from them. */
export function pageLinksFor(visibility: NavVisibility, meetingTabs: readonly MeetingTab[] = [], sections: readonly NavSection[] = NAV_SECTIONS): PageLink[] {
  const links: PageLink[] = [];
  for (const section of visibleNavSections(visibility, sections)) {
    for (const item of section.items) {
      if (NOT_LINKED.has(item.href)) continue;
      links.push({ href: item.href, names: [item.label, ...(ALSO_CALLED[item.href] ?? [])] });
      links.push(...(REACHED_FROM[item.href] ?? []));
    }
  }
  meetingTabs.forEach((tab, index) => {
    // "the L10" is how answers name the DM L10; it goes to the person's first meeting, as /meetings itself does.
    links.push({ href: tab.href, names: index === 0 && /\bL10$/.test(tab.label) && tab.label !== "L10" ? [tab.label, "L10"] : [tab.label] });
  });
  return links;
}
