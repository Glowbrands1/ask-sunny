import { Badge } from "@/components/ui/badge";
import { Notice } from "@/components/ui/feedback";
import {
  formatBedSpaDate,
  GRAIN_SENTENCE,
  type BedSpaPeriodOption,
} from "@/lib/reporting/read/bed-spa/period-token";
import type { BedSpaProvenance } from "@/lib/reporting/read/bed-spa/types";

import { formatCount } from "./format";
import { ReportFreshnessLine } from "../freshness-line";
import type { ReportCadence } from "@/lib/reporting/read/freshness-line";

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

/*
 * ============================================================================
 * `provenanceSentence`, `coverageSentence`, `ProvenanceLine` AND
 * `CoverageBanner` ARE GONE
 * ============================================================================
 *
 * Between them they said "Loaded <time> UTC" and "Recipient slice — not
 * company-wide", both of which the 14 September review asked to be removed:
 * "'Loaded' reads like a system event, while 'Refreshed' tells a manager how
 * current the information is", and "That is internal language and will not mean
 * anything to a Salon Director."
 *
 * Nothing rendered them by then — the tabs had moved these facts into the band
 * — so they are deleted rather than reworded. A reworded copy of a component
 * nobody mounts is somewhere for the old phrasing to come back from.
 *
 * EVERY FACT THEY CARRIED IS ON `BedSpaProvenanceChips` BELOW, which is now the
 * shared freshness line: the data-through date, the refresh instant in Central
 * Time, the salon count, the cadence, and — where the delivery genuinely
 * covered more than the reader sees — how many salons that was.
 */

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
    {
      label: "Reporting period",
      /*
       * The window and the span it covers. The REFRESH instant is not repeated
       * here — it is the second segment of the freshness line at the top of
       * every tab, in Central Time, and stating it twice in two formats is how
       * two timestamps come to disagree.
       */
      value: `${GRAIN_SENTENCE[provenance.period.grain] ?? provenance.period.grain.toUpperCase()} ${
        provenance.period.grain === "ltm"
          ? `${formatBedSpaDate(provenance.period.periodStart)} – ${formatBedSpaDate(provenance.period.periodEnd)}`
          : `through ${formatBedSpaDate(provenance.period.periodEnd)}`
      }`,
    },
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
  cadence,
  scopeLabel = null,
}: {
  provenance: BedSpaProvenance;
  cadence: ReportCadence;
  /** The reader's assignment, when the figures were narrowed to it. */
  scopeLabel?: string | null;
}) {
  const { period } = provenance;
  const wider =
    provenance.sourceSalonCount !== null &&
    provenance.sourceSalonCount > provenance.salonCount;

  return (
    <ReportFreshnessLine
      facts={{
        /*
         * THE PERIOD'S END IS THE DATA-THROUGH DATE. For an LTM window that is
         * still the right answer — the figures cover the twelve months ENDING
         * there — and the window itself is named in the detail line below,
         * because "Data through 31 Aug" over a twelve-month total would
         * otherwise read as one month.
         */
        dataThrough: period.periodEnd || null,
        refreshedAt: provenance.ingestedAt,
        salonCount: provenance.salonCount,
        cadence,
        scopeLabel,
      }}
      detail={
        /*
         * THE WIDER DELIVERY, IN WORDS A MANAGER USES. This is what the
         * "Recipient slice — not company-wide" chip was for, and the review is
         * blunt about that phrasing: "That is internal language and will not
         * mean anything to a Salon Director."
         *
         * Named only when the delivery ACTUALLY covered more than is shown.
         * "15 of 15" is noise; "15 of 252" is the whole point.
         */
        [
          `${GRAIN_SENTENCE[period.grain] ?? period.grain.toUpperCase()} window`,
          wider
            ? `this delivery covered ${formatCount(provenance.sourceSalonCount!)} salons across the chain`
            : null,
        ]
          .filter(Boolean)
          .join(" · ")
      }
    />
  );
}
