import Link from "next/link";

import { ScrollTable } from "@/components/ui/layout";
import { cn } from "@/lib/utils/cn";
import type { SalesTotalsSubject } from "@/lib/reporting/read/sales-totals-read";

import { formatSalesTotalsValue } from "./format";

export type SalonSortField = "label" | string;

/**
 * EVERY SALON IN THE DELIVERY, SORTABLE.
 *
 * Sorting is a link, not a click handler: the sort lives in the URL alongside
 * the filters, so a manager can send somebody "the salons ranked by EFTs" and
 * have it arrive that way.
 *
 * NO TOTALS ROW, and that is deliberate rather than an omission. The columns
 * hold two kinds of number that must not be added:
 *
 *   * PPTA is money per transaction. Summing it across salons is meaningless,
 *     and averaging the averages is not the average either — it would need the
 *     transaction counts, which this report does not carry.
 *   * The other five DO sum across salons, but the sum would describe the
 *     recipient's 15 salons only, while the summary block above describes all
 *     249. Two numbers of the same name meaning different populations on one
 *     screen is exactly how somebody quotes the wrong one.
 *
 * The scope cards carry the estate figures, as reported. This table carries the
 * salons, as reported. Neither is derived from the other.
 */
export function SalesTotalsSalonTable({
  salons,
  metrics,
  sortField,
  sortHref,
  activeSalon,
}: {
  salons: readonly SalesTotalsSubject[];
  metrics: readonly { code: string; label: string; unit: "currency" | "count" }[];
  sortField: SalonSortField;
  /** Builds the href that sorts by a given field. */
  sortHref: (field: SalonSortField) => string;
  activeSalon: string | null;
}) {
  if (salons.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        This delivery reported no salon rows.
      </p>
    );
  }

  return (
    <ScrollTable>
      <table className="w-full min-w-[720px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-border">
            <th className="px-3 py-2 text-left">
              <SortLink field="label" active={sortField === "label"} href={sortHref("label")}>
                Salon
              </SortLink>
            </th>
            {metrics.map((metric) => (
              <th key={metric.code} className="px-3 py-2 text-right">
                <SortLink
                  field={metric.code}
                  active={sortField === metric.code}
                  href={sortHref(metric.code)}
                >
                  {metric.label}
                </SortLink>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {salons.map((salon) => (
            <tr
              key={salon.key}
              className={cn(
                "border-b border-border last:border-0",
                // The salon the filter is pinned to, so it stays findable in a
                // long list rather than the filter appearing to do nothing.
                activeSalon === salon.key && "bg-surface-muted",
              )}
            >
              <td className="px-3 py-2 whitespace-nowrap">
                <span className="text-foreground">{salon.label}</span>
                {salon.salonNumber ? (
                  <span className="ml-2 text-[11px] text-muted-foreground tabular-nums">
                    {salon.salonNumber}
                  </span>
                ) : null}
              </td>
              {metrics.map((metric) => {
                const figure = salon.figures.find((entry) => entry.metricCode === metric.code);
                return (
                  <td
                    key={metric.code}
                    className={cn(
                      "px-3 py-2 text-right tabular-nums",
                      figure?.value == null ? "text-muted-foreground" : "text-foreground",
                    )}
                  >
                    {figure?.value == null
                      ? "Unavailable"
                      : formatSalesTotalsValue(figure.value, metric.unit)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </ScrollTable>
  );
}

function SortLink({
  field,
  active,
  href,
  children,
}: {
  field: SalonSortField;
  active: boolean;
  href: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-sort={active ? "descending" : undefined}
      className={cn(
        "eyebrow inline-flex items-center gap-1 transition-colors hover:text-foreground",
        active ? "text-foreground" : "text-muted-foreground",
      )}
    >
      {children}
      <span aria-hidden className={cn("text-[9px]", !active && "opacity-0")}>
        ▼
      </span>
      <span className="sr-only">{active ? ", sorted descending" : `, sort by ${field}`}</span>
    </Link>
  );
}
