"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils/cn";
import { REPORTS, reportForPath } from "./reports-routes";

/**
 * WHICH REPORT YOU ARE LOOKING AT, AND HOW TO GET TO THE OTHER ONE.
 *
 * The sidebar names the SECTION and opens its default report; this names the
 * reports within it. Two levels, because a manager who wants Sales Totals
 * should not have to know it lives under a heading called Salon Performance —
 * and the sidebar staying on one "Reports & Analytics" entry is what keeps the
 * left rail from growing a row per report as more arrive.
 *
 * ORDINARY LINKS, NOT A TAB WIDGET. Each report is a real route with its own
 * URL and its own filter state in that URL, so Back, refresh and a shared link
 * all have to work. A `role="tablist"` with client-side panel swapping would
 * break every one of those. `aria-current="page"` is the honest markup for
 * "this link is where you are".
 *
 * Rendered by the reports layout, so a report added to `REPORTS` appears here
 * without touching any page.
 */
export function ReportTabs({ className }: { className?: string }) {
  const pathname = usePathname();
  const active = reportForPath(pathname);

  // One report would make this a chooser with one choice — a click charged for
  // nothing. It appears when there is somewhere else to go.
  if (REPORTS.length < 2) return null;

  return (
    <nav
      aria-label="Reports"
      /*
       * EDGE TO EDGE UNDER THE BAND, with the band's own gutter.
       *
       * The artifact draws the band, the tab strip and the filter row as one
       * stack sharing a single gutter, with the strip's rule running the full
       * width of the content region — so it reads as the band's lower boundary
       * rather than as a line inside a panel. Laid out as a sibling of
       * `PageShell` rather than a child, which is the same way the Overview
       * places its band.
       */
      className={cn("w-full min-w-0 border-b border-border-strong", className)}
    >
      <div className="scroll-slim flex items-stretch gap-0.5 overflow-x-auto px-5 sm:px-6">
      {REPORTS.map((report) => {
        const current = active?.key === report.key;
        return (
          <Link
            key={report.key}
            href={report.path}
            aria-current={current ? "page" : undefined}
            className={cn(
              /*
               * THE ACTIVE REPORT TAKES A 3px BRAND-YELLOW UNDERLINE, and the
               * label is an uppercase micro-label rather than 13px prose.
               *
               * This is the second of the two selected states the direction
               * spends yellow on — the rail pill says which SECTION you are
               * in, this says which report inside it — and it reads as "which
               * level of the page am I on" precisely because nothing else in
               * the daylight half is allowed to be yellow. Navy was already
               * carrying generic selection on filters and segmented controls,
               * so a navy tab strip made the two levels look alike.
               *
               * The underline sits on the element itself rather than on a
               * pseudo-element so it lines up with the container's border.
               */
              "eyebrow -mb-px border-b-[3px] px-3.5 py-3 transition-colors",
              current
                ? "border-brand-yellow text-foreground"
                : "border-transparent hover:text-foreground",
            )}
          >
            {report.label}
          </Link>
        );
      })}
      </div>
    </nav>
  );
}
