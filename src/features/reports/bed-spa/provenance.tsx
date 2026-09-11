import { ShieldAlert } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Notice } from "@/components/ui/feedback";
import { ProvenanceChip, ProvenanceChips } from "@/components/ui/marquee";
import {
  formatBedSpaDate,
  formatLoadedAt,
  GRAIN_LABEL,
  GRAIN_SENTENCE,
  monthLabel,
  type BedSpaPeriodOption,
} from "@/lib/reporting/read/bed-spa/period-token";
import type { BedSpaProvenance } from "@/lib/reporting/read/bed-spa/types";
import { cn } from "@/lib/utils/cn";

import { formatCount } from "./format";

/**
 * THE PROVENANCE LINE AND THE COVERAGE BANNER.
 *
 * Both are on every one of the three tabs, and neither is decoration.
 *
 * THE COVERAGE BANNER exists because these source workbooks are chain-wide.
 * The August 2026 Bed Usage report describes 252 salons across thirty
 * companies; fifteen of them are this recipient's. A reader who misses that
 * will read a tan total as the chain's, and there is no recovering from that
 * mistake downstream — so the banner says how many salons are in the report,
 * how many the delivery covered, and that this is a recipient slice.
 *
 * EVERY NUMBER IN IT IS MEASURED. The salon count is counted from the live
 * facts and the source count is what the parser recorded seeing. Hard-coding
 * "15 salons" would make the banner a claim that could quietly stop being true;
 * counting it makes it a measurement that cannot.
 *
 * THE PROVENANCE LINE carries the period and the STORED ingestion timestamp,
 * in UTC. Not the render clock: a "loaded" time that moves when the page is
 * refreshed is not a provenance claim.
 */

/** `Aug 2026 · Loaded Sep 8, 2026 10:24 UTC` — assembled from stored values. */
export function provenanceSentence(provenance: BedSpaProvenance): string {
  const { period } = provenance;
  const window = GRAIN_SENTENCE[period.grain] ?? period.grain.toUpperCase();
  const range =
    period.grain === "ltm"
      ? `${formatBedSpaDate(period.periodStart)} – ${formatBedSpaDate(period.periodEnd)}`
      : `through ${formatBedSpaDate(period.periodEnd)}`;
  return `${window} ${range} · Loaded ${formatLoadedAt(provenance.ingestedAt)}`;
}

/**
 * The coverage sentence.
 *
 * Names the source population only when it is WIDER than the slice. Saying
 * "15 of 15 salons" would be noise; saying "15 of 252" is the whole point.
 */
export function coverageSentence(provenance: BedSpaProvenance): string {
  const salons = `${formatCount(provenance.salonCount)} ${
    provenance.salonCount === 1 ? "salon" : "salons"
  } included in this report`;
  const wider =
    provenance.sourceSalonCount !== null &&
    provenance.sourceSalonCount > provenance.salonCount
      ? ` · the delivery covered ${formatCount(provenance.sourceSalonCount)} salons chain-wide`
      : "";
  return `${salons}${wider} · Recipient slice — not company-wide`;
}

export function CoverageBanner({
  provenance,
  className,
}: {
  provenance: BedSpaProvenance;
  className?: string;
}) {
  return (
    <Notice
      tone="attention"
      icon={<ShieldAlert aria-hidden className="size-4" />}
      className={className}
    >
      <span className="font-medium">{coverageSentence(provenance)}</span>
    </Notice>
  );
}

/**
 * Freshness and source, kept compact.
 *
 * WHAT IS NOT HERE MATTERS AS MUCH AS WHAT IS. The parser key, its version and
 * the source sheet names answer a question no manager is asking and would push
 * the first real number further down the page. They live in the source-and-
 * quality panel; a manager needs the period and how fresh it is.
 */
export function ProvenanceLine({
  provenance,
  className,
}: {
  provenance: BedSpaProvenance;
  className?: string;
}) {
  return (
    <p
      className={cn(
        "flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground",
        className,
      )}
    >
      <span className="tabular-nums">{provenanceSentence(provenance)}</span>
      {provenance.originalFilename ? (
        <>
          <span aria-hidden>·</span>
          <span className="truncate">{provenance.originalFilename}</span>
        </>
      ) : null}
    </p>
  );
}

/**
 * The source-and-quality detail, behind a summary.
 *
 * Collapsed by default because it is lineage rather than performance, and open
 * to anyone who needs to answer "where did this number come from" without
 * reopening the workbook.
 */
export function SourcePanel({
  provenance,
  extra,
  warnings = [],
}: {
  provenance: BedSpaProvenance;
  /** Family-specific rows, e.g. how many equipment cells were absent. */
  extra?: readonly { label: string; value: string }[];
  warnings?: readonly string[];
}) {
  const rows: { label: string; value: string }[] = [
    { label: "Reporting period", value: provenanceSentence(provenance) },
    /*
     * THIS DELIVERY'S OWN TITLE, not the shared period's label.
     *
     * `provenance.period.labelRaw` comes from `report_periods`, which all three
     * reports covering the same window share — so it showed the SPA Wellness
     * workbook's title on the Bed Usage tab. A wrong attribution on the row
     * that exists specifically for traceability is worse than no row.
     */
    {
      label: "This delivery's own period title",
      value: provenance.sourcePeriodLabel ?? "Not recorded",
    },
    { label: "Source file", value: provenance.originalFilename ?? "Not recorded" },
    { label: "Sheets read", value: provenance.sourceSheetNames.filter(Boolean).join(", ") || "Not recorded" },
    {
      label: "Parser",
      value: provenance.parserKey
        ? `${provenance.parserKey} v${provenance.parserVersion ?? "?"}`
        : "Not recorded",
    },
    { label: "Salons in this report", value: formatCount(provenance.salonCount) },
    {
      label: "Salons in the delivery",
      value:
        provenance.sourceSalonCount === null
          ? "Not recorded"
          : formatCount(provenance.sourceSalonCount),
    },
    ...(extra ?? []),
  ];

  return (
    <details className="rounded-[var(--radius-lg)] border border-border bg-surface">
      <summary className="cursor-pointer px-5 py-4 text-[13px] font-medium text-foreground">
        Data source &amp; quality
      </summary>
      <div className="border-t border-border px-5 py-4">
        <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
          {rows.map((row) => (
            <div key={row.label} className="flex flex-col gap-0.5">
              <dt className="text-[11px] tracking-wide text-muted-foreground uppercase">
                {row.label}
              </dt>
              <dd className="text-[13px] text-foreground">{row.value}</dd>
            </div>
          ))}
        </dl>
        {warnings.length > 0 ? (
          <div className="mt-4 border-t border-border pt-4">
            <p className="text-[11px] tracking-wide text-muted-foreground uppercase">
              Parser observations
            </p>
            <ul className="mt-2 space-y-1.5">
              {warnings.map((warning) => (
                <li key={warning} className="text-[13px] text-muted-foreground">
                  {warning}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </details>
  );
}

/**
 * Says the period control fell back, when it did.
 *
 * A stale bookmark silently showing a different month is worse than one that
 * explains itself.
 */
export function PeriodFallbackNotice({
  fellBack,
  period,
}: {
  fellBack: boolean;
  period: BedSpaPeriodOption;
}) {
  if (!fellBack) return null;
  return (
    <Notice tone="neutral">
      The reporting period this link named is not loaded. Showing{" "}
      <span className="font-medium">{period.label}</span>, the most recent one.
    </Notice>
  );
}

/** A small count chip, for a chart or a section header. */
export function CountChip({ children }: { children: React.ReactNode }) {
  return (
    <Badge tone="outline" size="sm">
      {children}
    </Badge>
  );
}

/**
 * ============================================================================
 * THE SAME PROVENANCE, AS CHIPS IN THE BAND
 * ============================================================================
 *
 * The Marquee Reports artifact hoists these four facts out of the page body and
 * into the band, and it says why: "they are the reason anyone trusts a number
 * they are about to quote in an L10." Below the first chart they are a footnote;
 * beside the title they are part of the claim.
 *
 * IT IS THE SAME DATA, READ THE SAME WAY. Every value comes off the stored
 * `BedSpaProvenance` — the period the facts were read for, the salon count
 * counted from the live rows, the source population the parser recorded, and
 * the STORED ingestion instant rather than the render clock. Nothing here is
 * newly computed and nothing is hard-coded, so a chip cannot quietly stop being
 * true. `ProvenanceLine` and `CoverageBanner` above are unchanged and still
 * available; what moved is where the reader meets these facts first.
 *
 * THE PERIOD CHIP TAKES THE YELLOW, and it is the only one that does. It is the
 * fact that changes what every other number on the screen means, and the
 * artifact spends exactly one emphasised chip per page on it.
 *
 * "RECIPIENT SLICE" IS UNCONDITIONAL. The salon-count chip only names the wider
 * population when there IS one — "15 of 15 salons" is noise, "15 of 252" is the
 * whole point — but the slice warning appears either way, because a reader who
 * misses it reads a tan total as the chain's.
 */
export function BedSpaProvenanceChips({
  provenance,
}: {
  provenance: BedSpaProvenance;
}) {
  const { period } = provenance;
  const grain = GRAIN_LABEL[period.grain] ?? period.grain.toUpperCase();
  const wider =
    provenance.sourceSalonCount !== null &&
    provenance.sourceSalonCount > provenance.salonCount;

  return (
    <ProvenanceChips>
      <ProvenanceChip emphasis>
        {grain} {monthLabel(period.periodEnd)}
      </ProvenanceChip>
      <ProvenanceChip>
        {formatCount(provenance.salonCount)} of{" "}
        {wider ? formatCount(provenance.sourceSalonCount!) : formatCount(provenance.salonCount)}{" "}
        salons{wider ? " chain-wide" : ""}
      </ProvenanceChip>
      <ProvenanceChip>Recipient slice</ProvenanceChip>
      <ProvenanceChip>Loaded {formatLoadedAt(provenance.ingestedAt)}</ProvenanceChip>
    </ProvenanceChips>
  );
}
