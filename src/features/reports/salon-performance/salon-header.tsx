import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { Badge } from "@/components/ui/badge";
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
    <div className="space-y-3">
      <Link
        href={backHref}
        className="inline-flex items-center gap-1.5 text-[13px] font-medium text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:text-foreground"
      >
        <ArrowLeft aria-hidden className="size-3.5" />
        Back to Salon Performance
      </Link>

      <div className="space-y-1.5">
        <p className="eyebrow">Salon detail</p>
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="text-[26px] leading-tight font-semibold tabular-nums text-foreground">
            {salon.salonNumber}
          </h1>
          <p className="text-[19px] leading-tight font-medium text-foreground">
            {salon.storeName}
          </p>
        </div>
        <p className="text-[13px] leading-relaxed text-muted-foreground">
          {/*
            The period is stated as the WORKBOOK stated it, and the grain with
            it. A date alone does not identify a period here: `report_periods`
            is keyed on (grain, period_end), so 31 July can name both a
            month-to-date report and a year-to-date one.
          */}
          {scope.periodLabel} · {scope.grain.toUpperCase()} · comparable-store
          (same-store) sales as reported for this salon
        </p>
      </div>

      {descriptors.length > 0 || salon.quintileGroup || salon.revenueRank !== null ? (
        <dl className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs">
          {descriptors.map((entry) => (
            <div key={entry.label} className="flex items-baseline gap-1.5">
              <dt className="text-subtle-foreground">{entry.label}</dt>
              <dd className="font-medium text-foreground">{entry.value}</dd>
            </div>
          ))}
          {salon.revenueRank !== null ? (
            <div className="flex items-baseline gap-1.5">
              <dt className="text-subtle-foreground">Revenue rank</dt>
              <dd className="font-medium tabular-nums text-foreground">
                #{salon.revenueRank}
                {/*
                  Said out loud because it is the one figure here that is NOT
                  about the fifteen salons in this report: rank and quintile are
                  reported by the source against the whole chain, and neither is
                  ever recomputed from this copy.
                */}
                <span className="ml-1 font-normal text-subtle-foreground">
                  as reported, chain-wide
                </span>
              </dd>
            </div>
          ) : null}
          {salon.quintileGroup ? (
            <div className="flex items-baseline gap-1.5">
              <dt className="text-subtle-foreground">Quintile</dt>
              <dd>
                <Badge tone="neutral">{salon.quintileGroup}</Badge>
              </dd>
            </div>
          ) : null}
          {salon.isCompSalon !== null ? (
            <div className="flex items-baseline gap-1.5">
              <dt className="text-subtle-foreground">Comp salon</dt>
              <dd className="font-medium text-foreground">
                {salon.isCompSalon ? "Yes" : "No"}
              </dd>
            </div>
          ) : null}
        </dl>
      ) : null}
    </div>
  );
}
