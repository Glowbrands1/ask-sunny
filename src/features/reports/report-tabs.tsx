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
      className={cn("flex items-center gap-1 border-b border-border", className)}
    >
      {REPORTS.map((report) => {
        const current = active?.key === report.key;
        return (
          <Link
            key={report.key}
            href={report.path}
            aria-current={current ? "page" : undefined}
            className={cn(
              // The underline sits on the element itself rather than on a
              // pseudo-element so it lines up with the container's border.
              "-mb-px border-b-2 px-3 py-2 text-[13px] font-medium transition-colors",
              current
                ? "border-selected text-foreground"
                : "border-transparent text-muted-foreground hover:border-border hover:text-foreground",
            )}
          >
            {report.label}
          </Link>
        );
      })}
    </nav>
  );
}
