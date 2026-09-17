import { Star } from "lucide-react";

import { EmptyState } from "@/components/ui/feedback";
import { ScrollTable } from "@/components/ui/layout";
import { cn } from "@/lib/utils/cn";
import { formatNumber } from "@/lib/utils/format";
import { CATEGORY_LABEL, SURFACE_LABEL } from "@/lib/analytics/taxonomy";
import { changeAgainst } from "@/lib/analytics/queries";
import type {
  ExtractionRow,
  SurfaceRow,
  TopicRow,
  WhenRow,
} from "@/lib/analytics/feedback-queries";
import type { Insight } from "@/lib/analytics/insights";

/* ====================================================== what the numbers say */

/**
 * The derived insights, as cards.
 *
 * EVERY SENTENCE IS ARITHMETIC over figures already on this page — see
 * `lib/analytics/insights.ts`. No model is asked to summarise a dashboard,
 * because the summary could be wrong about the numbers printed above it and
 * would differ on every load, so nobody could quote it twice.
 */
export function InsightCards({ insights }: { insights: Insight[] }) {
  if (insights.length === 0) return null;

  return (
    <ul className="space-y-3">
      {insights.map((insight) => (
        <li
          key={insight.key}
          className="flex gap-3.5 rounded-[var(--radius-lg)] border border-border bg-surface p-4"
        >
          <span className="grid h-fit shrink-0 place-items-center rounded-lg bg-measure-positive-soft px-2.5 py-1.5 text-[13px] font-black text-measure-positive-foreground tabular-nums">
            {insight.value}
          </span>
          <div className="min-w-0">
            <p className="text-[13.5px] font-bold text-foreground">
              {insight.question}
            </p>
            <p className="mt-1 text-[12.5px] leading-relaxed text-body-foreground">
              {insight.detail}
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}

/* ============================================================ when it's used */

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

/**
 * MOST ACTIVE DAY and BUSIEST HOURS, in the business timezone.
 *
 * ONE PANEL FOR BOTH, because they answer one question — when should we put a
 * training nudge in front of people — and reading it means comparing a day
 * against an hour. Two cards would put a scroll between them.
 *
 * THE CALENDAR IS FILLED, NOT JUST THE BUCKETS THAT HAVE DATA. The query
 * returns only rows with activity, so a Sunday nobody used Ask Sunny is absent
 * rather than zero. Rendering the response as-is would silently drop Sunday
 * from the chart and shift every other bar left — which reads as a week with
 * six days in it.
 */
export function WhenPanel({
  rows,
  timezoneLabel,
}: {
  rows: WhenRow[];
  timezoneLabel: string;
}) {
  const total = rows.reduce((sum, row) => sum + row.events, 0);
  if (total === 0) {
    return (
      <EmptyState
        compact
        title="No data yet"
        description="Nothing was recorded in this window, so there is no rhythm to describe."
      />
    );
  }

  const byDay = new Array<number>(7).fill(0);
  const byHour = new Array<number>(24).fill(0);
  for (const row of rows) {
    if (row.dayOfWeek >= 0 && row.dayOfWeek < 7) byDay[row.dayOfWeek] += row.events;
    if (row.hourOfDay >= 0 && row.hourOfDay < 24) byHour[row.hourOfDay] += row.events;
  }

  const peakDay = Math.max(...byDay);
  const peakHour = Math.max(...byHour);
  const busiestDay = byDay.indexOf(peakDay);

  return (
    <div className="space-y-5">
      <div>
        <p className="eyebrow mb-2.5">Most active day</p>
        <div className="flex items-end gap-1.5" role="img"
          aria-label={`Activity by day of week. Busiest is ${DAY_LABELS[busiestDay]} with ${peakDay} events.`}
        >
          {byDay.map((count, day) => (
            <div key={day} className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
              <span className="text-[10.5px] text-muted-foreground tabular-nums">
                {count > 0 ? formatNumber(count) : ""}
              </span>
              <div
                className={cn(
                  "w-full rounded-t-[3px]",
                  /*
                    ONE COLOUR, AND THE PEAK IS THE EXCEPTION. Colouring every
                    bar differently would teach a code that says nothing —
                    height already carries the whole comparison — so only the
                    answer to "which day" is picked out.
                  */
                  day === busiestDay ? "bg-brand-yellow" : "bg-surface-muted",
                )}
                style={{
                  height: `${Math.max(4, peakDay > 0 ? (count / peakDay) * 80 : 0)}px`,
                }}
                aria-hidden
              />
              <span className="text-[10.5px] text-muted-foreground">
                {DAY_LABELS[day]}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div>
        <p className="eyebrow mb-2.5">Busiest hours ({timezoneLabel})</p>
        <div className="flex items-end gap-[2px]" role="img"
          aria-label={`Activity by hour of day in ${timezoneLabel}.`}
        >
          {byHour.map((count, hour) => (
            <div
              key={hour}
              title={`${clock(hour)} — ${formatNumber(count)}`}
              className="min-w-0 flex-1 rounded-[2px] bg-brand-yellow"
              style={{
                /*
                  OPACITY CARRIES THE VALUE AND EVERY BAR KEEPS ITS FULL HEIGHT,
                  so the 24 columns read as a strip of a day rather than as a
                  jagged line — and an hour with no activity is still a visible
                  slot rather than a gap the eye closes up.
                */
                height: "26px",
                opacity: peakHour > 0 ? 0.12 + (count / peakHour) * 0.88 : 0.12,
              }}
              aria-hidden
            />
          ))}
        </div>
        <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
          <span>12am</span>
          <span>6am</span>
          <span>12pm</span>
          <span>6pm</span>
          <span>11pm</span>
        </div>
      </div>
    </div>
  );
}

/* ================================================================= surfaces */

/**
 * WHERE ASK SUNNY IS BEING USED.
 *
 * The question the product could not answer before this release: nine surfaces
 * draw an ask bar and every one of them wrote an identical event.
 *
 * ROWS WITH NO SURFACE ARE NOT SHOWN AS A SURFACE. Events recorded before
 * tracking shipped carry a null and the query excludes them, so this panel
 * describes what it can and the totals elsewhere stay whole.
 */
export function SurfacesPanel({ rows }: { rows: SurfaceRow[] }) {
  if (rows.length === 0) {
    return (
      <EmptyState
        compact
        title="No data yet"
        description="Surface tracking begins with this release. Questions asked before it shipped were recorded without one, so this fills from today rather than being backfilled with a guess."
      />
    );
  }

  const largest = Math.max(...rows.map((row) => row.events), 1);
  const total = rows.reduce((sum, row) => sum + row.events, 0);

  return (
    <ScrollTable>
      <table className="data-table min-w-[620px]">
        <caption className="sr-only">
          Ask Sunny usage by surface, with the rating each surface earned.
        </caption>
        <thead>
          <tr>
            <th scope="col" className="pr-3">Surface</th>
            <th scope="col" data-align="right" className="pr-3">Inquiries</th>
            <th scope="col" className="w-[30%] pr-3">Share</th>
            <th scope="col" data-align="right" className="pr-3">Leaders</th>
            <th scope="col" data-align="right" className="pr-3">Rated</th>
            <th scope="col" data-align="right" className="pr-3">Avg rating</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.surface}>
              <th scope="row" className="pr-3 text-left font-medium">
                {SURFACE_LABEL[row.surface]}
              </th>
              <td data-align="right" className="pr-3 tabular-nums">
                {formatNumber(row.events)}
              </td>
              <td className="pr-3">
                <div className="flex items-center gap-2">
                  <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-muted">
                    <span
                      className="block h-full rounded-full bg-brand-yellow"
                      style={{ width: `${(row.events / largest) * 100}%` }}
                    />
                  </span>
                  <span className="w-9 shrink-0 text-right text-[11.5px] text-muted-foreground tabular-nums">
                    {total > 0 ? Math.round((row.events / total) * 100) : 0}%
                  </span>
                </div>
              </td>
              <td data-align="right" className="pr-3 tabular-nums">
                {formatNumber(row.activeUsers)}
              </td>
              <td data-align="right" className="pr-3 tabular-nums">
                {formatNumber(row.rated)}
              </td>
              <td data-align="right" className="pr-3 tabular-nums">
                {/*
                  "No data yet" RATHER THAN A DASH OR A ZERO. A surface nobody
                  has rated has no average, and 0.0 would read as the worst
                  score on the page.
                */}
                {row.averageRating !== null ? (
                  <span className="inline-flex items-center gap-1">
                    {row.averageRating.toFixed(1)}
                    <Star className="size-3 fill-brand-yellow text-brand-yellow" aria-hidden />
                  </span>
                ) : (
                  <span className="text-muted-foreground">No data yet</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </ScrollTable>
  );
}

/* =================================================================== topics */

/**
 * WHAT LEADERS ASK ABOUT.
 *
 * ============================================================================
 * THERE IS NO "LATEST EXAMPLE" COLUMN, AND THAT IS NOT AN OMISSION
 * ============================================================================
 *
 * The dashboard this is modelled on prints a verbatim question beside each
 * topic. Ask Sunny cannot, and will not: `activity_events` has no column for a
 * prompt, an answer or an excerpt, because managers ask Ask Sunny about named
 * employees' attendance and performance. An adoption dashboard needs to know
 * THAT somebody asked and what it was about, never what they typed.
 *
 * `Last asked` is what replaces it, and it is the better column anyway — the
 * example was being read for "is this still happening?", which a timestamp
 * answers without putting an HR conversation on an admin screen.
 *
 * ============================================================================
 * ACKNOWLEDGEMENTS ARE COUNTED SEPARATELY, NOT AS TOPICS
 * ============================================================================
 *
 * "yes", "yes please" and "thank you" are the three most common things anybody
 * types at an assistant, and they are not inquiries about anything. Counted as
 * topics they sit at the top of this table and push what leaders actually
 * needed down the page. They are classified in memory, stored as one enum
 * value, and shown here as their own column so the exclusion is visible rather
 * than silent.
 */
export function TopicsPanel({
  rows,
  previousRows,
}: {
  rows: TopicRow[];
  previousRows: TopicRow[];
}) {
  if (rows.length === 0) {
    return (
      <EmptyState
        compact
        title="No data yet"
        description="No substantive questions were recorded in this window."
      />
    );
  }

  const previousByKey = new Map(previousRows.map((row) => [row.category, row.events]));
  const total = rows.reduce((sum, row) => sum + row.events, 0);
  const largest = Math.max(...rows.map((row) => row.events), 1);
  const acknowledgements = rows.reduce((sum, row) => sum + row.acknowledgements, 0);

  return (
    <div className="space-y-2.5">
      <ScrollTable>
        <table className="data-table min-w-[700px]">
          <caption className="sr-only">
            Topics leaders asked about, with share of total, change against the
            prior period and when each was last asked.
          </caption>
          <thead>
            <tr>
              <th scope="col" className="pr-3">Topic</th>
              <th scope="col" data-align="right" className="pr-3">Inquiries</th>
              <th scope="col" className="w-[26%] pr-3">Share</th>
              <th scope="col" data-align="right" className="pr-3">Leaders</th>
              <th scope="col" data-align="right" className="pr-3">vs prior</th>
              <th scope="col" data-align="right" className="pr-3">Last asked</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const change = changeAgainst(
                row.events,
                previousByKey.get(row.category) ?? 0,
              );
              return (
                <tr key={row.category}>
                  <th scope="row" className="pr-3 text-left font-medium">
                    {CATEGORY_LABEL[row.category]}
                  </th>
                  <td data-align="right" className="pr-3 tabular-nums">
                    {formatNumber(row.events)}
                  </td>
                  <td className="pr-3">
                    <div className="flex items-center gap-2">
                      <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-muted">
                        <span
                          className="block h-full rounded-full bg-brand-yellow"
                          style={{ width: `${(row.events / largest) * 100}%` }}
                        />
                      </span>
                      <span className="w-9 shrink-0 text-right text-[11.5px] text-muted-foreground tabular-nums">
                        {total > 0 ? Math.round((row.events / total) * 100) : 0}%
                      </span>
                    </div>
                  </td>
                  <td data-align="right" className="pr-3 tabular-nums">
                    {formatNumber(row.activeUsers)}
                  </td>
                  <td data-align="right" className="pr-3 tabular-nums">
                    {/*
                      NULL WHEN THE PRIOR PERIOD HAD NONE. "New" rather than a
                      percentage: going from 0 to 7 is not +700%, it is a
                      beginning, and dividing by zero to say otherwise turns it
                      into a fake trend.
                    */}
                    {change === null ? (
                      <span className="text-muted-foreground">New</span>
                    ) : (
                      <span
                        className={cn(
                          change > 0 && "text-measure-positive-foreground",
                          change < 0 && "text-measure-flagged-foreground",
                        )}
                      >
                        {change > 0 ? "+" : ""}
                        {Math.round(change)}%
                      </span>
                    )}
                  </td>
                  <td data-align="right" className="pr-3 text-muted-foreground">
                    {row.lastAsked ? shortDate(row.lastAsked) : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </ScrollTable>

      <p className="text-[11.5px] leading-relaxed text-muted-foreground">
        No question text is stored anywhere in Ask Sunny, so there is no verbatim
        example column — “Last asked” answers the same question without putting a
        manager’s HR conversation on this screen.
        {acknowledgements > 0 ? (
          <>
            {" "}
            {formatNumber(acknowledgements)} further{" "}
            {acknowledgements === 1 ? "turn was" : "turns were"} an
            acknowledgement — “yes”, “thanks”, “today” — and {acknowledgements === 1 ? "is" : "are"}{" "}
            excluded from these counts.
          </>
        ) : null}
      </p>
    </div>
  );
}

/* =============================================================== extraction */

/**
 * REPORT EXTRACTION — runs and outcomes, and deliberately no accuracy rating.
 *
 * THE REFERENCE DASHBOARD SHOWS A STAR RATING PER EXTRACTION ENGINE, collected
 * from managers approving extracted stats in a chat. Ask Sunny has no such flow
 * and no such column: ingestion is machine work behind a credential, and nobody
 * is asked to grade it.
 *
 * So this shows what is actually known — runs per parser, how many succeeded,
 * how many raised warnings, how many facts they produced — and says plainly
 * that no accuracy rating exists. Relabelling "succeeded" as "accurate" would
 * turn a liveness measure into a quality one: a parse can succeed and still
 * read the wrong column, which is exactly the failure warnings exist to catch.
 */
export function ExtractionPanel({ rows }: { rows: ExtractionRow[] }) {
  if (rows.length === 0) {
    return (
      <EmptyState
        compact
        title="No data yet"
        description="No report was ingested in this window."
      />
    );
  }

  return (
    <div className="space-y-2.5">
      <ScrollTable>
        <table className="data-table min-w-[660px]">
          <caption className="sr-only">
            Report ingestion runs per parser, with outcomes and volumes.
          </caption>
          <thead>
            <tr>
              <th scope="col" className="pr-3">Parser</th>
              <th scope="col" data-align="right" className="pr-3">Runs</th>
              <th scope="col" data-align="right" className="pr-3">Succeeded</th>
              <th scope="col" data-align="right" className="pr-3">Failed</th>
              <th scope="col" data-align="right" className="pr-3">With warnings</th>
              <th scope="col" data-align="right" className="pr-3">Facts</th>
              <th scope="col" data-align="right" className="pr-3">Last run</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.parserKey}>
                <th scope="row" className="pr-3 text-left font-medium">
                  <code className="text-[12px]">{row.parserKey}</code>
                </th>
                <td data-align="right" className="pr-3 tabular-nums">
                  {formatNumber(row.runs)}
                </td>
                <td data-align="right" className="pr-3 tabular-nums">
                  {formatNumber(row.succeeded)}
                </td>
                <td
                  data-align="right"
                  className={cn(
                    "pr-3 tabular-nums",
                    row.failed > 0 && "text-measure-flagged-foreground",
                  )}
                >
                  {formatNumber(row.failed)}
                </td>
                <td data-align="right" className="pr-3 tabular-nums">
                  {formatNumber(row.withWarnings)}
                </td>
                <td data-align="right" className="pr-3 tabular-nums">
                  {formatNumber(row.facts)}
                </td>
                <td data-align="right" className="pr-3 text-muted-foreground">
                  {row.lastRun ? shortDate(row.lastRun) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollTable>

      <p className="text-[11.5px] leading-relaxed text-muted-foreground">
        <strong className="font-bold text-foreground">
          No accuracy rating: no data yet.
        </strong>{" "}
        Nothing in Ask Sunny asks a person to grade an extraction, so there is
        none to report. A run that succeeded is a run that completed — not a run
        that read the right column — and presenting the success rate as accuracy
        would claim a measure this product does not collect.
      </p>
    </div>
  );
}

function shortDate(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** "10am" — the hour a column stands for, shown on hover. */
function clock(hour: number): string {
  const suffix = hour < 12 ? "am" : "pm";
  const twelve = hour % 12 === 0 ? 12 : hour % 12;
  return `${twelve}${suffix}`;
}
