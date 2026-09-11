import type { ReactNode } from "react";

import { cn } from "@/lib/utils/cn";
import { ReportTabs } from "./report-tabs";
import type { ReportRoute } from "./reports-routes";

/**
 * The chrome every report in the section shares: the band, the tab strip, the
 * filter row, and the work below them.
 *
 * ONE FRAME RATHER THAN ONE PER PAGE, because the two report pages had begun
 * with the same `PageShell` + `PageHeader` pair and would each have needed the
 * tab strip added. Two copies of a layout drift — one grows a tab strip, one
 * does not, and the section stops feeling like one place. The heading text
 * comes from `REPORTS`, so a report's name is written once and appears
 * identically in its tab and its title.
 *
 * A server component rendering a client child (`ReportTabs` needs the
 * pathname). That is the correct direction: the frame stays server-rendered and
 * only the part that must know the current URL ships to the browser.
 *
 * Used by the reports' loading and unavailable states too, so a report that
 * cannot render its data still looks like a report and can still be navigated
 * away from — a dead end with no tabs is how somebody concludes the section is
 * broken.
 *
 * ============================================================================
 * THE BAND GOES ON A DIET
 * ============================================================================
 *
 * The current Marquee Reports artifact replaces the light `PageHeader` this
 * frame used with a near-black strip, and it argues the change rather than just
 * drawing it: "this tab is the one screen where a district manager comes to
 * read rather than to act, so the band goes on a diet... it drops to a single
 * strip so the data gets the room."
 *
 * One strip, four things in it: the title, the sub-line, the provenance chips,
 * and the report-scoped Ask Sunny bar. No greeting and no shortcuts row — those
 * belong to the Overview's full-height band. The measured claim the artifact
 * makes for this is that the first real number starts 180px down the page
 * instead of 400px, and that is the whole point of the treatment.
 *
 * FULL-BLEED, NOT INSIDE A MAX-WIDTH SHELL. The band, the tab strip and the
 * filter row each run the width of the main column with their own 26px gutter,
 * exactly as the artifact draws them; a centred 1400px band on a 1920px screen
 * reads as a floating panel rather than as the page's own header. The work
 * below keeps the same gutter so the content lines up with the title above it.
 */
export function ReportFrame({
  report,
  action,
  provenance,
  filters,
  children,
}: {
  report: ReportRoute;
  /**
   * The report-level action, which in practice is "Ask Sunny about this
   * report".
   *
   * A SLOT RATHER THAN THE COMPONENT ITSELF, because the frame does not know
   * the filter state and must not learn it. Every page has already resolved its
   * own period, window and selection server-side; the frame's job is to put the
   * control in the same place on all five so a manager finds it without
   * looking, and each page's job is to say what the reader is looking at.
   *
   * OMITTED ON THE LOADING AND UNAVAILABLE STATES, deliberately. Those render
   * through this frame too, and a control offering to discuss a report that
   * failed to load would send the manager to a conversation about nothing.
   */
  action?: ReactNode;
  /**
   * The provenance chips, as `ProvenanceChips` + `ProvenanceChip`.
   *
   * A SLOT for the same reason `action` is one: the three report families keep
   * provenance in three different shapes, and the frame has no business
   * learning any of them. What the frame guarantees is the POSITION — top
   * right of the band, beside the title — so "15 of 252 salons chain-wide" is
   * in the same place on every tab.
   *
   * The artifact's argument for hoisting these out of the page body: "they are
   * the reason anyone trusts a number they are about to quote in an L10."
   */
  provenance?: ReactNode;
  /**
   * The filter row, on its own strip under the tabs.
   *
   * ONE ROW, AND NEVER STICKY. Both halves of that are the artifact's: the
   * controls show their current values on the chips so the slice is readable
   * without opening anything, and on a phone the row scrolls away with the page
   * rather than pinning and eating a third of the screen.
   */
  filters?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="min-w-0">
      <ReportBand
        title={report.label}
        description={report.summary}
        provenance={provenance}
        action={action}
      />
      <ReportTabs />
      {filters ? (
        <div className="flex flex-wrap items-center gap-2 border-b border-border bg-background px-5 py-3.5 sm:px-6">
          {filters}
        </div>
      ) : null}
      <div className="flex min-w-0 flex-col gap-5 px-5 py-5 pb-7 sm:px-6 sm:py-5.5">
        {children}
      </div>
    </div>
  );
}

/**
 * THE NEAR-BLACK STRIP AT THE TOP OF A REPORT.
 *
 * Its four committed properties, each from the artifact and each doing a job:
 *
 *   the near-black ground        so the yellow and the coral below it read at
 *                                full strength rather than floating on peach
 *   the 4px yellow bottom edge   the brand, as an edge rather than a filled
 *                                block — the direction caps fills at two a screen
 *   the red corner glow          the one sanctioned appearance of the red-light
 *                                red, run a step quieter here than on the
 *                                Overview because this strip is a third as tall
 *   the LAST WORD IN YELLOW      "Salon *Performance*" — one yellow accent in
 *                                the title, so the heading carries the brand
 *                                without a second filled object
 */
export function ReportBand({
  title,
  description,
  provenance,
  action,
  className,
}: {
  title: string;
  description?: string;
  provenance?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  const { lead, accent } = splitTitle(title);

  return (
    <div
      className={cn(
        "border-b-4 border-brand-yellow bg-band bg-[image:var(--band-glow-slim)] px-5 pt-4 pb-5 sm:px-6",
        className,
      )}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end sm:gap-4">
        <div className="min-w-0">
          <h1 className="display text-[24px] tracking-[0.012em] text-band-foreground sm:text-[28px]">
            {lead ? `${lead} ` : ""}
            <span className="text-brand-yellow">{accent}</span>
          </h1>
          {description ? (
            <p className="mt-1.5 text-[11.5px] leading-snug text-band-muted-foreground">
              {description}
            </p>
          ) : null}
        </div>
        {provenance}
      </div>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

/**
 * A REPORT TITLE, SPLIT SO THE LAST WORD CAN TAKE THE YELLOW.
 *
 * Derived rather than authored per report. Writing the split into `REPORTS`
 * would mean five more strings to keep in step with five labels, and the tab
 * strip needs the plain label anyway — so the one place the two could disagree
 * is removed by not storing it twice.
 *
 * A single-word title is all accent, which is correct: there is no lead to
 * separate it from, and rendering the whole of "Overview" in yellow is the same
 * treatment one step smaller rather than a different one.
 */
export function splitTitle(title: string): { lead: string; accent: string } {
  const trimmed = title.trim();
  const cut = trimmed.lastIndexOf(" ");
  if (cut === -1) return { lead: "", accent: trimmed };
  return { lead: trimmed.slice(0, cut), accent: trimmed.slice(cut + 1) };
}
