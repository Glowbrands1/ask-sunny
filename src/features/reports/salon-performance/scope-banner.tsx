import { ShieldAlert } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Notice } from "@/components/ui/feedback";
import type { ReportScope } from "@/lib/reporting/read";

/**
 * THE SCOPE BANNER.
 *
 * Present on every Salon Performance view, and not a decoration. This workbook
 * is one recipient's filtered copy of a 116-slot template — fifteen salons of
 * it — so any figure on the page is a figure about those fifteen. A reader who
 * misses that will read a revenue total as the chain's revenue, and there is no
 * way to recover from that mistake downstream.
 *
 * EVERY NUMBER IN THE SENTENCE COMES FROM THE DATABASE. The salon count and the
 * period are read from `comp_sales_report_scope`, which counts them from the
 * live facts rather than from a stored summary. Hard-coding "15 salons" would
 * make the banner a claim that could quietly stop being true; counting it makes
 * the banner a measurement that cannot.
 */

/** `2026-08-30` -> `Aug 30, 2026`, in UTC so the date never shifts. */
export function formatPeriodEnd(periodEnd: string): string {
  const [year, month, day] = periodEnd.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

const GRAIN_LABELS: Record<ReportScope["grain"], string> = {
  mtd: "MTD",
  ytd: "YTD",
};

/** The approved sentence, assembled from measured values. */
export function scopeSentence(scope: ReportScope): string {
  const salons = `${scope.salonCount} ${scope.salonCount === 1 ? "salon" : "salons"} included in this report`;
  const period = `${GRAIN_LABELS[scope.grain]} ending ${formatPeriodEnd(scope.periodEnd)}`;
  return `${salons} · ${period} · Recipient slice — not company-wide`;
}

export function ScopeBanner({
  scope,
  className,
}: {
  scope: ReportScope;
  className?: string;
}) {
  return (
    <Notice
      tone="attention"
      icon={<ShieldAlert aria-hidden className="size-4" />}
      className={className}
    >
      <span className="font-medium">{scopeSentence(scope)}</span>
    </Notice>
  );
}

/**
 * Freshness and source, kept deliberately compact.
 *
 * WHAT IS NOT HERE MATTERS AS MUCH AS WHAT IS. The parser key and version used
 * to sit in this line, in the manager-facing header, where they answered a
 * question no manager was asking and pushed the first real number further down
 * the page. Digest, storage path, parser warnings, excluded columns and parser
 * identity all belong in the "Data source & quality" panel; a manager needs to
 * know which period they are looking at and how fresh it is.
 */
export function SourceFreshness({
  scope,
  ingestedLabel,
}: {
  scope: ReportScope;
  /** Pre-formatted on the server so the markup does not depend on the clock. */
  ingestedLabel: string;
}) {
  /**
   * NO WORKBOOK SHEET NAME HERE.
   *
   * A "Report view: MTD Rolling" badge used to sit in this line, naming a
   * spreadsheet tab in the manager-facing header. The comparison a manager
   * selected is already on the Window control, in their language; which tab of
   * the source it happens to be a column of is lineage, and lineage belongs in
   * the "Data source & quality" panel with the digest and the parser identity.
   */
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
      <Badge tone="neutral">{scope.periodLabel}</Badge>
      <span>Loaded {ingestedLabel}</span>
    </div>
  );
}
