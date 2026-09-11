import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { ScrollTable } from "@/components/ui/layout";
import { ROLE_LABEL } from "@/lib/permissions";
import { categoryLabel } from "@/lib/analytics/taxonomy";
import { serializeFilters, type AnalyticsFilters } from "@/lib/analytics/filters";
import { formatDate } from "@/lib/utils/date";
import { formatNumber } from "@/lib/utils/format";
import type { LeaderRow, LocationRow } from "@/lib/analytics/queries";
import type { Role } from "@/types";

/**
 * THE TWO ADOPTION TABLES.
 *
 * BOTH LIST THE SILENT ROWS, and that is the single most useful thing on this
 * page. Knowing MO Kansas City Wornall filed seven forms is mildly interesting;
 * knowing NE Kearney filed none is the row somebody acts on. The database
 * functions LEFT JOIN from the directories precisely so a salon or a leader with
 * no activity comes back with zeros instead of disappearing, and these tables
 * show them rather than filtering them back out.
 *
 * INACTIVE ROWS ARE MARKED, NEVER COLOURED RED. Nothing is behind plan here —
 * a salon that has not used a tool is a fact, not a failure, and this system
 * reserves the coral flag for a measure short of a target the business has set.
 * The mark is a word.
 */

function inactiveBadge(events: number) {
  return events === 0 ? (
    <Badge tone="outline" size="sm">
      No activity
    </Badge>
  ) : null;
}

function lastActiveCell(value: string | null) {
  /*
   * A DASH, NOT "NEVER". This window is filtered, so an empty cell means "not
   * in this period" and not "not ever" — and the two are different findings. A
   * dash invites the reader to widen the period; "Never" would assert something
   * the query never asked.
   */
  return value ? formatDate(value) : "—";
}

export function LocationsTable({
  rows,
  filters,
  base,
  limit,
  compact,
}: {
  rows: LocationRow[];
  filters: AnalyticsFilters;
  base: string;
  limit?: number;
  /**
   * FOUR COLUMNS INSTEAD OF SEVEN, for the two side-by-side cards on Overview.
   *
   * The full table is 860px wide and those cards are about 550px, so the full
   * column set scrolled sideways inside its own card — the figures a reader came
   * for were off the right edge until they dragged. Overview keeps the ranking
   * columns and sends the rest to the full view behind "View all".
   */
  compact?: boolean;
}) {
  const shown = limit ? rows.slice(0, limit) : rows;

  if (shown.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        No locations match these filters.
      </p>
    );
  }

  return (
    <ScrollTable>
      <table className={compact ? "data-table min-w-[380px]" : "data-table min-w-[860px]"}>
        <caption className="sr-only">
          Ask Sunny adoption by location, including locations with no activity.
        </caption>
        <thead>
          <tr>
            <th scope="col" className="pr-3">Location</th>
            {compact ? null : <th scope="col" className="pr-3">District</th>}
            <th scope="col" data-align="right" className="pr-3">Activity</th>
            <th scope="col" data-align="right" className="pr-3">Leaders</th>
            {compact ? null : (
              <>
                <th scope="col" data-align="right" className="pr-3">Forms</th>
                <th scope="col" className="pr-3">Top use</th>
                <th scope="col" className="pr-3">Last active</th>
              </>
            )}
          </tr>
        </thead>
        <tbody>
          {shown.map((row) => (
            <tr key={row.salonId}>
              <th scope="row" className="pr-3 text-left font-normal">
                {/*
                  CLICKING A LOCATION FILTERS THE WHOLE SECTION TO IT, carrying
                  every other filter along. A link rather than a click handler so
                  it opens in a new tab like anything else on the page.
                */}
                <Link
                  href={`${base}?${serializeFilters({ ...filters, salonId: row.salonId })}`}
                  className="font-medium underline-offset-2 hover:underline"
                >
                  {row.storeName}
                </Link>
                <span className="ml-2">{inactiveBadge(row.events)}</span>
              </th>
              {compact ? null : (
                <td className="pr-3 text-muted-foreground">
                  {row.district ?? "—"}
                </td>
              )}
              <td data-align="right" className="pr-3 tabular-nums">
                {formatNumber(row.events)}
              </td>
              <td data-align="right" className="pr-3 tabular-nums">
                {/*
                  ACTIVE OUT OF ASSIGNED. "3" alone cannot be read; "3 / 5" says
                  two people at this salon have not touched it, which is the
                  actionable half.
                */}
                {formatNumber(row.activeLeaders)}
                <span className="text-muted-foreground">
                  {" / "}
                  {formatNumber(row.assignedLeaders)}
                </span>
              </td>
              {compact ? null : (
                <>
                  <td data-align="right" className="pr-3 tabular-nums">
                    {formatNumber(row.forms)}
                  </td>
                  <td className="pr-3 text-muted-foreground">
                    {row.topCategory ? categoryLabel(row.topCategory) : "—"}
                  </td>
                  <td className="pr-3 text-muted-foreground">
                    {lastActiveCell(row.lastActive)}
                  </td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </ScrollTable>
  );
}

export function LeadersTable({
  rows,
  filters,
  base,
  limit,
  compact,
}: {
  rows: LeaderRow[];
  filters: AnalyticsFilters;
  base: string;
  limit?: number;
  /** Four columns for the Overview card. See LocationsTable. */
  compact?: boolean;
}) {
  const shown = limit ? rows.slice(0, limit) : rows;

  if (shown.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        No leaders match these filters.
      </p>
    );
  }

  return (
    <ScrollTable>
      <table className={compact ? "data-table min-w-[380px]" : "data-table min-w-[900px]"}>
        <caption className="sr-only">
          Ask Sunny adoption by leader, including leaders with no activity.
        </caption>
        <thead>
          <tr>
            <th scope="col" className="pr-3">Leader</th>
            <th scope="col" className="pr-3">Role</th>
            {compact ? null : <th scope="col" className="pr-3">Location</th>}
            <th scope="col" data-align="right" className="pr-3">Activity</th>
            {compact ? null : (
              <>
                <th scope="col" data-align="right" className="pr-3">Forms</th>
                <th scope="col" data-align="right" className="pr-3">Questions</th>
                <th scope="col" className="pr-3">Top use</th>
                <th scope="col" className="pr-3">Last active</th>
              </>
            )}
          </tr>
        </thead>
        <tbody>
          {shown.map((row) => (
            <tr key={row.userId}>
              <th scope="row" className="pr-3 text-left font-normal">
                <Link
                  href={`${base}?${serializeFilters({ ...filters, actorId: row.userId })}`}
                  className="font-medium underline-offset-2 hover:underline"
                >
                  {row.displayName}
                </Link>
                <span className="ml-2">{inactiveBadge(row.events)}</span>
                {/*
                  An invited account has never signed in, so "no activity" on it
                  is not an adoption problem — it is an onboarding one, and the
                  distinction decides who gets chased and about what.
                */}
                {row.status === "invited" ? (
                  <span className="ml-1.5">
                    <Badge tone="processing" size="sm">
                      Invited
                    </Badge>
                  </span>
                ) : null}
              </th>
              <td className="pr-3 text-muted-foreground">
                {ROLE_LABEL[row.role as Role] ?? row.role}
              </td>
              {compact ? null : (
                <td className="pr-3 text-muted-foreground">
                  {row.storeName ?? "—"}
                </td>
              )}
              <td data-align="right" className="pr-3 tabular-nums">
                {formatNumber(row.events)}
              </td>
              {compact ? null : (
                <>
                  <td data-align="right" className="pr-3 tabular-nums">
                    {formatNumber(row.forms)}
                  </td>
                  <td data-align="right" className="pr-3 tabular-nums">
                    {formatNumber(row.chatEvents)}
                  </td>
                  <td className="pr-3 text-muted-foreground">
                    {row.topCategory ? categoryLabel(row.topCategory) : "—"}
                  </td>
                  <td className="pr-3 text-muted-foreground">
                    {lastActiveCell(row.lastActive)}
                  </td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </ScrollTable>
  );
}
