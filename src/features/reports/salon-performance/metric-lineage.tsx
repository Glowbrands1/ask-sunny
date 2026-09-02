import type { SalonFigure } from "@/lib/reporting/read/salon-detail";

/**
 * WHERE ONE FIGURE CAME FROM.
 *
 * The chain a manager or an admin can follow from any number on this page:
 *
 *     displayed metric → basis / window → source sheet → source column → report
 *
 * A `<details>` element, closed. That is the whole reason this is not a modal
 * or a tooltip: it costs no client JavaScript, it is keyboard-operable and
 * screen-reader-announced for free, it prints, and — the point — it is INVISIBLE
 * until asked for. A page that shows every figure's column reference next to
 * the figure is a debugger, and a manager reading it stops seeing the numbers.
 *
 * NOTHING SECRET PASSES THROUGH HERE. A sheet name, a spreadsheet column and a
 * filename are what a manager would see if they opened the workbook themselves.
 * The storage bucket, the object key, the file digest and every credential stay
 * out — the digest is shown once, abbreviated, in the Data source & quality
 * panel, and never beside a figure.
 */
export function MetricLineage({
  label,
  windowLabel,
  figures,
  sourceReport,
}: {
  /** The measure as a manager knows it, not its code. */
  label: string;
  /** The basis year or trailing window these figures were read under. */
  windowLabel: string;
  /** One entry per figure shown, each with the heading it appeared under. */
  figures: { heading: string; figure: SalonFigure }[];
  /** The original filename of the report. Null when it was not recorded. */
  sourceReport: string | null;
}) {
  const traceable = figures.filter((entry) => entry.figure.sourceColumn !== null);
  if (traceable.length === 0) return null;

  return (
    <details className="group -mx-1">
      <summary className="cursor-pointer list-none rounded-[var(--radius-xs)] px-1 py-0.5 text-[11px] font-medium text-subtle-foreground outline-none transition-colors hover:text-muted-foreground focus-visible:ring-2 focus-visible:ring-primary/40 [&::-webkit-details-marker]:hidden">
        <span className="group-open:hidden">Source</span>
        <span className="hidden group-open:inline">Hide source</span>
      </summary>

      <dl className="mt-1.5 space-y-1 border-l border-border pl-2.5 text-[11px] leading-relaxed">
        <div className="flex gap-1.5">
          <dt className="text-subtle-foreground">Measure</dt>
          <dd className="text-muted-foreground">{label}</dd>
        </div>
        <div className="flex gap-1.5">
          <dt className="text-subtle-foreground">Read under</dt>
          <dd className="text-muted-foreground">{windowLabel}</dd>
        </div>
        {traceable.map((entry) => (
          <div key={entry.heading} className="flex gap-1.5">
            <dt className="text-subtle-foreground">{entry.heading}</dt>
            <dd className="text-muted-foreground">
              {/*
                Sheet AND column, together, because neither alone identifies a
                figure: both month-to-date sheets have a column H.
              */}
              {entry.figure.sourceSheet} · column {entry.figure.sourceColumn}
              {entry.figure.basisYear !== null ? (
                <span className="text-subtle-foreground">
                  {" "}
                  · basis {entry.figure.basisYear}
                </span>
              ) : null}
            </dd>
          </div>
        ))}
        <div className="flex gap-1.5">
          <dt className="text-subtle-foreground">Report</dt>
          {/* Not recorded, never "0" and never blank. */}
          <dd className="break-all text-muted-foreground">
            {sourceReport ?? "Not recorded"}
          </dd>
        </div>
      </dl>
    </details>
  );
}
