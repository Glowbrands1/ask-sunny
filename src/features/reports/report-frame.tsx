import type { ReactNode } from "react";

import { PageShell } from "@/components/ui/layout";
import { ReportBand } from "@/components/ui/marquee";
import { ReportTabs } from "./report-tabs";
import type { ReportRoute } from "./reports-routes";

/**
 * The chrome every report in the section shares: band, tab strip, content.
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
 */
export function ReportFrame({
  report,
  chips,
  children,
}: {
  report: ReportRoute;
  /**
   * Provenance for the band: which period, how many salons, whose copy this
   * is, when it was loaded.
   *
   * Omitted by the loading and unavailable states, which have nothing truthful
   * to say about a report they could not read — an empty band is honest there,
   * a band with stale chips is not.
   */
  chips?: ReactNode;
  children: ReactNode;
}) {
  return (
    <>
      {/*
        THE BAND AND THE TABS SIT OUTSIDE `PageShell`, flush against each other.

        That is how the Overview places its own band, and it is what lets both
        run edge to edge while the content below keeps the page's gutter. The
        artifact draws exactly this stack: near-black band, its yellow edge,
        then the report switch immediately beneath with nothing in between.
      */}
      <ReportBand
        eyebrow="Reporting"
        title={report.label}
        description={report.summary}
        chips={chips}
      />
      <ReportTabs />
      <PageShell className="space-y-6">{children}</PageShell>
    </>
  );
}
