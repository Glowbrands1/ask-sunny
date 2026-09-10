import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { BandChip, ReportBand } from "@/components/ui/marquee";

import type { ReportScope } from "@/lib/reporting/read/types";
import { salonDescriptorEntries } from "@/lib/reporting/read/salon-detail";
import type { SalonPeriodDescriptors } from "@/lib/reporting/read/types";

/**
 * WHO THIS SALON IS, AND UNDER WHICH REPORT.
 *
 * The header answers the two questions a manager arriving from the dashboard
 * has: am I looking at the right salon, and is this the period I was just
 * looking at. Both have to be answerable without scrolling, because everything
 * below is a number that means something different under a different period.
 *
 * THE SALON NUMBER IS TEXT. `0468` is the schema's own key and the workbook's;
 * it is never coerced to a number on the way in, on the way out, or here — a
 * header reading `468` is a different salon as far as anyone reading it is
 * concerned.
 *
 * DESCRIPTORS ARE OPTIONAL AND ARE DROPPED WHEN ABSENT rather than printed
 * empty. District and region hold MANAGER NAMES in this source: descriptive
 * history the report happens to carry, not an identity claim, and not presented
 * as people.
 */
export function SalonHeader({
  salon,
  scope,
  backHref,
}: {
  salon: SalonPeriodDescriptors;
  scope: ReportScope;
  /** Back to the dashboard, carrying the filters this page was reached with. */
  backHref: string;
}) {
  const descriptors = salonDescriptorEntries(salon);

  return (
    <ReportBand
      eyebrow="Salon detail"
      /*
       * THE STORE NAME IS THE TITLE; THE NUMBER IS A CHIP.
       *
       * It was the other way round — a 26px tabular salon number as the page's
       * h1 with the name beside it at 19px. A manager knows their salons by
       * name, and reading a four-digit identifier as the loudest thing on the
       * page is how a report starts feeling like a database. The number is
       * still here, first among the chips.
       */
      title={salon.storeName}
      description={
        <>
          {/*
            The period is stated as the WORKBOOK stated it, and the grain with
            it. A date alone does not identify a period here: `report_periods`
            is keyed on (grain, period_end), so 31 July can name both a
            month-to-date report and a year-to-date one.
          */}
          {scope.periodLabel} · {scope.grain.toUpperCase()} · comparable-store
          (same-store) sales as reported for this salon
        </>
      }
      chips={
        <>
          <BandChip tone="brand">Salon {salon.salonNumber}</BandChip>
          {descriptors.map((entry) => (
            <BandChip key={entry.label}>
              {entry.label} · {entry.value}
            </BandChip>
          ))}
          {salon.revenueRank !== null ? (
            /*
              Said out loud because it is the one figure here that is NOT about
              the salons in this report: rank and quintile are reported by the
              source against the whole chain, and neither is ever recomputed
              from this copy.
            */
            <BandChip>Rank #{salon.revenueRank} · as reported, chain-wide</BandChip>
          ) : null}
          {salon.quintileGroup ? (
            <BandChip>Quintile · {salon.quintileGroup}</BandChip>
          ) : null}
          {salon.isCompSalon !== null ? (
            <BandChip>Comp salon · {salon.isCompSalon ? "Yes" : "No"}</BandChip>
          ) : null}
        </>
      }
    >
      <Link
        href={backHref}
        className="eyebrow inline-flex items-center gap-1.5 !text-band-muted-foreground outline-none transition-colors hover:!text-brand-yellow focus-visible:!text-brand-yellow"
      >
        <ArrowLeft aria-hidden className="size-3" />
        Back to Salon Performance
      </Link>
    </ReportBand>
  );
}
