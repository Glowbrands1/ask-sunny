import Link from "next/link";
import { Search } from "lucide-react";

import { Badge, StatusDot, type BadgeTone } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/feedback";
import { ScrollTable } from "@/components/ui/layout";
import {
  DIRECTORY_FILTERS,
  type DirectoryFilter,
  type DirectoryPage,
  type DirectoryQuery,
  type DirectoryRow,
} from "@/lib/employees/woven/view-types";
import { changeLabel, employeeName } from "@/lib/employees/woven/views";
import { cn } from "@/lib/utils/cn";
import { day, label, when } from "./format";

/**
 * THE EMPLOYEE DIRECTORY — every Woven employee on file, active and terminated.
 *
 * A plain GET form and links, so every filtered view is a URL: the search, the
 * status, the location and position, and each filter chip. Status is Woven's
 * normalised employment status — never inferred from a termination date. Filtering runs on the server in
 * `views.ts`, the same function for real and sample data.
 *
 * NAMES AND EMAILS APPEAR HERE, which is why the page needs Manage users.
 */

const BASE = "/admin/integrations/woven/directory";

export function directoryHref(query: DirectoryQuery, change: Partial<DirectoryQuery>): string {
  const next = { ...query, ...change };
  const params = new URLSearchParams();
  if (next.search) params.set("q", next.search);
  if (next.status) params.set("status", next.status);
  for (const f of next.filters) params.append("filter", f);
  if (next.locationId) params.set("location", next.locationId);
  if (next.positionId) params.set("position", next.positionId);
  if (next.page > 1) params.set("page", String(next.page));
  const qs = params.toString();
  return qs ? `${BASE}?${qs}` : BASE;
}

function toggled(filters: DirectoryFilter[], f: DirectoryFilter): DirectoryFilter[] {
  return filters.includes(f) ? filters.filter((x) => x !== f) : [...filters, f];
}

const STATUS_TONE: Record<DirectoryRow["employmentStatus"], BadgeTone> = {
  active: "ready",
  terminated: "neutral",
  unknown: "attention",
};

function MappingBadge({ row }: { row: DirectoryRow }) {
  if (row.emailAddress === null) return <Badge tone="failed" size="sm">Missing email</Badge>;
  const positionMapped = row.positionMappingStatus === "mapped" || row.positionMappingStatus === "ignored";
  if (positionMapped && !row.hasUnmappedLocation) return <Badge tone="ready" size="sm">Mapped</Badge>;
  if (!positionMapped && row.hasUnmappedLocation) return <Badge tone="attention" size="sm">Position + location</Badge>;
  return <Badge tone="attention" size="sm">{positionMapped ? "Location unmapped" : "Position unmapped"}</Badge>;
}

function Locations({ list, expiring }: { list: DirectoryRow["additionalLocations"]; expiring?: boolean }) {
  if (list.length === 0) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="block min-w-40 whitespace-normal">
      {list
        .map((l) => `${l.name ?? l.wovenLocationId}${expiring && l.expiresOn ? ` · expires ${day(l.expiresOn)}` : ""}`)
        .join("; ")}
    </span>
  );
}

export function DirectoryTable({ page, query, sample }: { page: DirectoryPage; query: DirectoryQuery; sample: boolean }) {
  const lastPage = Math.max(1, Math.ceil(page.total / page.pageSize));

  return (
    <section aria-label="Employee Directory" className="flex flex-col gap-4">
      <form method="get" action={BASE} className="flex flex-wrap items-end gap-2" role="search">
        {query.filters.map((f) => (
          <input key={f} type="hidden" name="filter" value={f} />
        ))}
        <label className="flex min-w-56 flex-1 flex-col gap-1 text-[12px] font-semibold text-muted-foreground">
          Search
          <input
            name="q"
            defaultValue={query.search}
            placeholder="Name, email or Woven ID"
            className="h-9 rounded-[var(--radius-sm)] border border-border bg-surface px-3 text-[13px] font-normal text-foreground"
          />
        </label>
        <label className="flex flex-col gap-1 text-[12px] font-semibold text-muted-foreground">
          Status
          <select
            name="status"
            defaultValue={query.status ?? ""}
            className="h-9 max-w-48 rounded-[var(--radius-sm)] border border-border bg-surface px-2 text-[13px] font-normal text-foreground"
          >
            <option value="">All statuses ({page.statusCounts.active + page.statusCounts.terminated + page.statusCounts.unknown})</option>
            <option value="active">Active ({page.statusCounts.active})</option>
            <option value="terminated">Terminated ({page.statusCounts.terminated})</option>
            <option value="unknown">Unknown ({page.statusCounts.unknown})</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[12px] font-semibold text-muted-foreground">
          Location
          <select
            name="location"
            defaultValue={query.locationId ?? ""}
            className="h-9 max-w-64 rounded-[var(--radius-sm)] border border-border bg-surface px-2 text-[13px] font-normal text-foreground"
          >
            <option value="">All locations</option>
            {page.locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[12px] font-semibold text-muted-foreground">
          Position
          <select
            name="position"
            defaultValue={query.positionId ?? ""}
            className="h-9 max-w-64 rounded-[var(--radius-sm)] border border-border bg-surface px-2 text-[13px] font-normal text-foreground"
          >
            <option value="">All positions</option>
            {page.positions.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          className="inline-flex h-9 items-center gap-1.5 rounded-[var(--radius-sm)] bg-primary px-3 text-[13px] font-semibold text-primary-foreground"
        >
          <Search className="size-3.5" />
          Search
        </button>
      </form>

      <ul className="flex flex-wrap gap-1.5" aria-label="Filters">
        {DIRECTORY_FILTERS.map((f) => {
          const on = query.filters.includes(f.key);
          return (
            <li key={f.key}>
              <Link
                href={directoryHref(query, { filters: toggled(query.filters, f.key), page: 1 })}
                aria-pressed={on}
                className={cn(
                  "inline-flex items-center gap-1 rounded-full border px-3 py-1 text-[12px] font-semibold",
                  on ? "border-foreground bg-foreground text-background" : "border-border bg-surface text-foreground",
                )}
              >
                {f.label}
                <span className={cn("tabular-nums font-normal", on ? "opacity-80" : "text-muted-foreground")}>
                  {page.filterCounts[f.key]}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>

      {page.rows.length === 0 ? (
        <EmptyState
          title={page.total === 0 && query.filters.length === 0 && !query.search ? "No employees on file yet" : "No employees match"}
          description={
            page.total === 0 && query.filters.length === 0 && !query.search
              ? "The directory fills on the first successful sync."
              : "Clear a filter or change the search."
          }
        />
      ) : (
        <ScrollTable>
          <table className="w-full text-left text-[12.5px]">
            <thead className="bg-surface-muted text-[11px] tracking-wide text-muted-foreground uppercase">
              <tr>
                {[
                  "Woven ID",
                  "Name",
                  "Work email",
                  "Status",
                  "Position",
                  "Position ID",
                  "Primary location",
                  "Additional locations",
                  "Temporary or expiring access",
                  "Hire date",
                  "Termination date",
                  "Last seen in Woven",
                  "Last synced",
                  "Last change",
                  "Mapping",
                ].map((h) => (
                  <th key={h} scope="col" className="px-3 py-2 font-semibold whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {page.rows.map((row) => (
                <tr key={row.id} className="align-top whitespace-nowrap">
                  <td className="px-3 py-2 font-mono text-[11.5px] text-muted-foreground">{row.externalEmployeeId}</td>
                  <td className="px-3 py-2 font-semibold text-foreground">{employeeName(row)}</td>
                  <td className="px-3 py-2">
                    {row.emailAddress ?? <Badge tone="failed" size="sm">missing</Badge>}
                  </td>
                  <td className="px-3 py-2">
                    <Badge tone={STATUS_TONE[row.employmentStatus]} size="sm">
                      <StatusDot />
                      {row.employmentStatus}
                    </Badge>
                  </td>
                  <td className="px-3 py-2">{row.positionName ?? "—"}</td>
                  <td className="px-3 py-2 font-mono text-[11.5px] text-muted-foreground">{row.positionId ?? "—"}</td>
                  <td className="px-3 py-2">
                    {row.primarySalonNumber ? `${row.primarySalonNumber} · ` : ""}
                    {row.primaryLocationName ?? row.primaryLocationId ?? "—"}
                  </td>
                  <td className="px-3 py-2">
                    <Locations list={row.additionalLocations} />
                    {row.hasAllLocationAccess ? <Badge tone="outline" size="sm">all-location access</Badge> : null}
                  </td>
                  <td className="px-3 py-2">
                    <Locations list={row.temporaryOrExpiringLocations} expiring />
                  </td>
                  <td className="px-3 py-2 tabular-nums">{day(row.hireDate)}</td>
                  <td className="px-3 py-2 tabular-nums">{day(row.terminationDate)}</td>
                  <td className="px-3 py-2 text-muted-foreground tabular-nums">{when(row.lastSeenAt)}</td>
                  <td className="px-3 py-2 text-muted-foreground tabular-nums">{when(row.lastSyncedAt)}</td>
                  <td className="px-3 py-2">
                    {row.lastChangeKind ? (
                      <span title={row.lastChangeClassification ? `${row.lastChangeKind} · ${row.lastChangeClassification}` : row.lastChangeKind}>
                        {changeLabel(row.lastChangeKind, row.lastChangeClassification)}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <MappingBadge row={row} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollTable>
      )}

      <nav aria-label="Pages" className="flex flex-wrap items-center justify-between gap-2 text-[12px] text-muted-foreground">
        <span>
          {page.total} employee{page.total === 1 ? "" : "s"}
          {sample ? " (sample)" : ""} · page {page.page} of {lastPage}
        </span>
        <span className="flex gap-3">
          {page.page > 1 ? <Link href={directoryHref(query, { page: page.page - 1 })}>Previous</Link> : null}
          {page.page < lastPage ? <Link href={directoryHref(query, { page: page.page + 1 })}>Next</Link> : null}
        </span>
      </nav>
      <p className="text-[12px] text-muted-foreground">
        Data issues are codes, never text: {label("missing_email")}, {label("unmapped_position")}, {label("unmapped_location")},{" "}
        {label("duplicate_email")}, {label("unknown_status")}. Email is shown as Woven provides it; whether an address may sign in is a
        separate rule.
      </p>
    </section>
  );
}
