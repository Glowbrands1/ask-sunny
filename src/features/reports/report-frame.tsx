import type { ReactNode } from "react";

import { PageHeader, PageShell } from "@/components/ui/layout";
import { ReportTabs } from "./report-tabs";
import type { ReportRoute } from "./reports-routes";

/**
 * The chrome every report in the section shares: heading, tab strip, content.
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
  children,
}: {
  report: ReportRoute;
  children: ReactNode;
}) {
  return (
    <PageShell className="space-y-6">
      <PageHeader eyebrow="Reporting" title={report.label} description={report.summary} />
      <ReportTabs />
      {children}
    </PageShell>
  );
}
