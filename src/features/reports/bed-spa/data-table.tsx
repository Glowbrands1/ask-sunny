import Link from "next/link";

import { ScrollTable } from "@/components/ui/layout";
import { cn } from "@/lib/utils/cn";

/**
 * THE DETAIL TABLE THE THREE TABS SHARE.
 *
 * SORTING IS A LINK, NOT A CLICK HANDLER. The sort lives in the URL alongside
 * the filters, so a manager can send somebody "the salons ranked by spa
 * conversion" and have it arrive that way — and Back undoes one sort rather
 * than leaving the page.
 *
 * NO TOTALS ROW BY DEFAULT, and where one is passed it is the caller's
 * responsibility to have computed it correctly. Most columns here must not be
 * added: a per-bed figure, a conversion rate and a rank are all wrong when
 * summed, and a per-bed average of averages is not the average. `footer` takes
 * pre-formatted cells so the page that knows how to combine a column is the
 * one that does.
 *
 * A MISSING VALUE RENDERS AS `—`, never as `0`. A salon that did not report and
 * a salon that reported nothing are different facts, and the second is a
 * finding somebody would act on.
 */

export interface TableColumn<T> {
  /** Stable key, and the sort field this column offers. */
  readonly key: string;
  readonly label: string;
  /** A short line under the header, for a column whose meaning is not obvious. */
  readonly hint?: string;
  readonly align?: "left" | "right" | "center";
  /** False for a column there is no sensible order for. */
  readonly sortable?: boolean;
  render(row: T): React.ReactNode;
}

export function BedSpaDataTable<T>({
  rows,
  columns,
  rowKey,
  sort,
  direction,
  sortHref,
  footer,
  emptyMessage = "No rows match the current filters.",
  minWidth = 860,
  className,
}: {
  rows: readonly T[];
  columns: readonly TableColumn<T>[];
  rowKey: (row: T) => string;
  sort: string | null;
  direction: "asc" | "desc" | null;
  /** Builds the href that sorts by a field. */
  sortHref: (field: string) => string;
  /** Pre-formatted footer cells, keyed by column. Only where summing is valid. */
  footer?: Readonly<Record<string, React.ReactNode>>;
  emptyMessage?: string;
  minWidth?: number;
  className?: string;
}) {
  if (rows.length === 0) {
    return <p className="py-6 text-center text-sm text-muted-foreground">{emptyMessage}</p>;
  }

  return (
    <ScrollTable className={className}>
      <table className="w-full border-collapse text-sm" style={{ minWidth }}>
        <thead>
          <tr className="border-b border-border">
            {columns.map((column) => (
              <th
                key={column.key}
                className={cn(
                  "px-3 py-2 align-bottom",
                  column.align === "right"
                    ? "text-right"
                    : column.align === "center"
                      ? "text-center"
                      : "text-left",
                )}
              >
                {column.sortable === false ? (
                  <span className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                    {column.label}
                  </span>
                ) : (
                  <SortLink
                    href={sortHref(column.key)}
                    active={sort === column.key}
                    direction={direction}
                  >
                    {column.label}
                  </SortLink>
                )}
                {column.hint ? (
                  <span className="mt-0.5 block text-[10px] font-normal normal-case text-muted-foreground">
                    {column.hint}
                  </span>
                ) : null}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)} className="border-b border-border last:border-0">
              {columns.map((column) => (
                <td
                  key={column.key}
                  className={cn(
                    "px-3 py-2",
                    column.align === "right"
                      ? "text-right tabular-nums"
                      : column.align === "center"
                        ? "text-center tabular-nums"
                        : "text-left",
                  )}
                >
                  {column.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {footer ? (
          <tfoot>
            <tr className="border-t border-border-strong bg-surface-muted">
              {columns.map((column) => (
                <td
                  key={column.key}
                  className={cn(
                    "px-3 py-2 font-medium",
                    column.align === "right"
                      ? "text-right tabular-nums"
                      : column.align === "center"
                        ? "text-center tabular-nums"
                        : "text-left",
                  )}
                >
                  {footer[column.key] ?? null}
                </td>
              ))}
            </tr>
          </tfoot>
        ) : null}
      </table>
    </ScrollTable>
  );
}

function SortLink({
  href,
  active,
  direction,
  children,
}: {
  href: string;
  active: boolean;
  direction: "asc" | "desc" | null;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      scroll={false}
      aria-sort={active ? (direction === "asc" ? "ascending" : "descending") : undefined}
      className={cn(
        "inline-flex items-center gap-1 text-[11px] font-medium tracking-wide uppercase transition-colors",
        active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
      <span aria-hidden className={cn("text-[9px]", !active && "opacity-0")}>
        {direction === "asc" ? "▲" : "▼"}
      </span>
    </Link>
  );
}

/** A value or a dash. Never a zero standing in for a missing figure. */
export function orDash(value: string | null | undefined): React.ReactNode {
  return value === null || value === undefined || value === "" ? (
    <span className="text-muted-foreground">—</span>
  ) : (
    value
  );
}
