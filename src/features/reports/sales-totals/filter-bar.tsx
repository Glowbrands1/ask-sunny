import Link from "next/link";

import { cn } from "@/lib/utils/cn";
import type { SalesTotalsDateOption, SalesTotalsSubject } from "@/lib/reporting/read/sales-totals-read";
import {
  SALES_TOTALS_WINDOWS,
  type SalesTotalsWindow,
} from "@/lib/reporting/sales-totals/metric-map";

export interface SalesTotalsFilters {
  readonly reportDate: string;
  readonly window: SalesTotalsWindow;
  readonly scope: string;
  readonly salon: string | null;
  readonly metric: string;
}

/** Builds a link that changes one filter and keeps the rest. */
function hrefWith(
  base: string,
  filters: SalesTotalsFilters,
  change: Partial<SalesTotalsFilters>,
): string {
  const next = { ...filters, ...change };
  const params = new URLSearchParams();
  params.set("date", next.reportDate);
  params.set("window", next.window);
  params.set("scope", next.scope);
  params.set("metric", next.metric);
  if (next.salon) params.set("salon", next.salon);
  return `${base}?${params.toString()}`;
}

/**
 * THE FILTERS, AS LINKS.
 *
 * Server-rendered anchors rather than a client-side control, for the same
 * reason the Salon Performance bar works this way: every filter lives in the
 * URL, so Back, refresh and a shared link all behave, and the page needs no
 * JavaScript to be usable. Each control is a real navigation.
 *
 * WINDOW IS FIRST AND IS NOT A DROPDOWN. It is the one choice that changes
 * what every number on the page means — previous day against month to date —
 * so it is a visible pair of options with both always in view, rather than a
 * collapsed control whose current value has to be remembered.
 */
export function SalesTotalsFilterBar({
  base,
  filters,
  dates,
  scopes,
  salons,
  metrics,
}: {
  base: string;
  filters: SalesTotalsFilters;
  dates: readonly SalesTotalsDateOption[];
  scopes: readonly SalesTotalsSubject[];
  salons: readonly SalesTotalsSubject[];
  metrics: readonly { code: string; label: string }[];
}) {
  return (
    <div className="space-y-3 rounded-[var(--radius-md)] border border-border bg-surface-raised p-3">
      {/* Window — the choice that changes what everything means. */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="eyebrow shrink-0">Window</span>
        <div className="flex gap-1">
          {SALES_TOTALS_WINDOWS.map((option) => {
            const active = option.id === filters.window;
            return (
              <Link
                key={option.id}
                href={hrefWith(base, filters, { window: option.id })}
                aria-current={active ? "true" : undefined}
                title={option.description}
                className={cn(
                  "rounded-[var(--radius-sm)] px-3 py-1.5 text-[13px] font-medium transition-colors",
                  active
                    ? "bg-primary text-primary-foreground"
                    : "bg-surface-muted text-muted-foreground hover:text-foreground",
                )}
              >
                {option.label}
              </Link>
            );
          })}
        </div>
      </div>

      <div className="flex flex-wrap items-start gap-x-6 gap-y-3 border-t border-border pt-3">
        <FilterGroup
          label="Report date"
          // Newest first. Ordered by the DATE THE REPORT COVERS, not by when it
          // was ingested, so a late backfill slots into history.
          options={dates.map((date) => ({
            key: date.reportDate,
            label: date.label,
            href: hrefWith(base, filters, { reportDate: date.reportDate }),
            active: date.reportDate === filters.reportDate,
          }))}
        />

        <FilterGroup
          label="Company / scope"
          options={scopes.map((scope) => ({
            key: scope.key,
            label: scope.label,
            href: hrefWith(base, filters, { scope: scope.key, salon: null }),
            active: scope.key === filters.scope && !filters.salon,
          }))}
        />

        <FilterGroup
          label="Metric"
          options={metrics.map((metric) => ({
            key: metric.code,
            label: metric.label,
            href: hrefWith(base, filters, { metric: metric.code }),
            active: metric.code === filters.metric,
          }))}
        />
      </div>

      {/* Salon is a longer list, so it gets its own row. */}
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 border-t border-border pt-3">
        <span className="eyebrow mr-1 shrink-0">Salon</span>
        <Link
          href={hrefWith(base, filters, { salon: null })}
          className={cn(
            "rounded-[var(--radius-sm)] px-2 py-1 text-[12px] transition-colors",
            filters.salon
              ? "text-muted-foreground hover:text-foreground"
              : "bg-surface-muted font-medium text-foreground",
          )}
        >
          All {salons.length}
        </Link>
        {salons.map((salon) => (
          <Link
            key={salon.key}
            href={hrefWith(base, filters, { salon: salon.key })}
            className={cn(
              "rounded-[var(--radius-sm)] px-2 py-1 text-[12px] transition-colors",
              filters.salon === salon.key
                ? "bg-surface-muted font-medium text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {salon.label}
          </Link>
        ))}
      </div>
    </div>
  );
}

function FilterGroup({
  label,
  options,
}: {
  label: string;
  options: readonly { key: string; label: string; href: string; active: boolean }[];
}) {
  return (
    <div className="min-w-0">
      <p className="eyebrow mb-1.5">{label}</p>
      <div className="flex flex-wrap gap-1">
        {options.map((option) => (
          <Link
            key={option.key}
            href={option.href}
            aria-current={option.active ? "true" : undefined}
            className={cn(
              "rounded-[var(--radius-sm)] px-2.5 py-1 text-[12px] transition-colors",
              option.active
                ? "bg-surface-muted font-medium text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {option.label}
          </Link>
        ))}
      </div>
    </div>
  );
}
