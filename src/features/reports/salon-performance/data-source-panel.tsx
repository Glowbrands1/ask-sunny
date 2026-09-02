import type { ReportScope, ReportSourceQuality } from "@/lib/reporting/read/types";

/**
 * DATA SOURCE & QUALITY.
 *
 * Provenance, kept out of the manager's way. A `<details>` element, closed:
 * no client JavaScript, keyboard-operable and announced for free, and — the
 * point — invisible until somebody asks. This information matters to whoever
 * has to answer "is this number right", and it is noise to everybody else.
 *
 * WHAT IS DELIBERATELY NOT HERE, because this panel is rendered into a page
 * that a stakeholder-review password can reach:
 *
 *   The Supabase secret key, and any other credential. Never read here.
 *   The storage bucket and object key. Knowing where a private object lives is
 *   of no use to a reviewer and is a step towards fetching it.
 *   Any signed download URL. One can be minted server-side on demand elsewhere;
 *   a URL printed into a page is a bearer token with a long tail.
 *   The review password, or any Vercel value.
 *
 * The file digest IS here, abbreviated to twelve hex characters. That is enough
 * to confirm two people are looking at the same workbook and far short of
 * anything usable: it identifies the artifact, it does not grant access to it.
 *
 * "NOT RECORDED" IS NEVER "0". The skipped-row count is the live example: the
 * parser counts skipped rows, the ingestion row does not persist them. Zero
 * would assert that nothing was skipped, which nobody has established. Every
 * field here follows the same rule.
 */

function Row({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 py-1.5">
      <dt className="text-xs text-subtle-foreground">
        {label}
        {hint ? <span className="block text-[11px] text-subtle-foreground/80">{hint}</span> : null}
      </dt>
      <dd className="text-xs text-foreground break-all">{value}</dd>
    </div>
  );
}

/** A timestamp in UTC, or the fact that none was recorded. */
function stamp(value: string | null): string {
  if (!value) return "Not recorded";
  return `${new Date(value).toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  })} UTC`;
}

/**
 * Parser warning codes as an operator would say them.
 *
 * The stored codes are the parser's own vocabulary. Left raw, a panel reading
 * `stale_header_excluded ×7` invites the reading that seven figures are wrong;
 * the sentence says what actually happened, which is that seven columns were
 * left out on purpose.
 */
const WARNING_LABELS: Record<string, string> = {
  stale_header: "Columns excluded because their header did not match the reviewed mapping",
  stale_header_excluded:
    "Columns excluded because their header did not match the reviewed mapping",
  duplicate_column: "Duplicate columns for the same measure, excluded to avoid double counting",
  duplicate_metric: "Duplicate columns for the same measure, excluded to avoid double counting",
  ambiguous_metric: "Columns whose measure could not be identified without guessing",
  unmapped_column: "Columns present in the sheet but not part of the reviewed mapping",
  missing_basis_year: "Comparison columns with no baseline figures to compare against",
};

function warningSentence(code: string): string {
  return WARNING_LABELS[code] ?? code.replace(/_/g, " ");
}

export function DataSourcePanel({
  scope,
  quality,
  /** The sheet the figures on this page were read from. */
  activeSheet,
  /** The source column of the measure currently on screen, when there is one. */
  displayedMetric,
}: {
  scope: ReportScope;
  /** Null when no ingestion row could be matched to the active sheet. */
  quality: ReportSourceQuality | null;
  activeSheet: string | null;
  displayedMetric: {
    label: string;
    sourceSheet: string | null;
    sourceColumn: string | null;
    basisYears: number[];
  } | null;
}) {
  return (
    <details className="group rounded-[var(--radius-lg)] border border-border bg-surface-muted">
      <summary className="cursor-pointer list-none rounded-[var(--radius-lg)] px-4 py-3 text-[13px] font-medium text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/40 [&::-webkit-details-marker]:hidden">
        <span className="flex items-center justify-between gap-3">
          Data source &amp; quality
          <span className="text-[11px] font-normal text-subtle-foreground">
            <span className="group-open:hidden">Show</span>
            <span className="hidden group-open:inline">Hide</span>
          </span>
        </span>
      </summary>

      <div className="space-y-4 border-t border-border px-4 py-3">
        <p className="text-[11px] leading-relaxed text-subtle-foreground">
          Where the figures on this page came from, and what the parser left out. Shown
          from what the ingestion actually persisted — a field that was not recorded says
          so rather than showing a zero.
        </p>

        <section>
          <h3 className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Reporting period
          </h3>
          <dl className="mt-1 divide-y divide-border/60">
            <Row label="Period" value={`${scope.periodLabel} (${scope.grain.toUpperCase()})`} />
            <Row
              label="Covers"
              value={`${scope.periodStart} to ${scope.periodEnd}`}
              hint="As the workbook stated it"
            />
            <Row label="Fiscal year" value={String(scope.fiscalYear)} />
            <Row
              label="Salons in this report"
              value={String(scope.salonCount)}
              hint="Counted from the live facts, not read from a summary column"
            />
            <Row label="Live figures" value={String(scope.factCount)} />
            <Row label="Measures" value={String(scope.metricCount)} />
          </dl>
        </section>

        <section>
          <h3 className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Source report
          </h3>
          <dl className="mt-1 divide-y divide-border/60">
            <Row
              label="Filename"
              value={quality?.originalFilename ?? "Not recorded"}
            />
            <Row
              label="File digest"
              value={
                quality?.fileSha256
                  ? `sha256 ${quality.fileSha256.slice(0, 12)}…`
                  : "Not recorded"
              }
              hint="Abbreviated. Enough to confirm two people hold the same workbook"
            />
            <Row
              label="Sheet on this page"
              value={activeSheet ?? "Not recorded"}
              hint="Which workbook tab the figures above were read from"
            />
            <Row
              label="Sheets in this ingestion"
              value={
                quality && quality.sourceSheetNames.length > 0
                  ? quality.sourceSheetNames.join(", ")
                  : "Not recorded"
              }
            />
            <Row label="Source" value={quality?.sourceName ?? "Not recorded"} />
            <Row label="Report family" value={quality?.reportFamily ?? "Not recorded"} />
          </dl>
        </section>

        {displayedMetric ? (
          <section>
            <h3 className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Displayed measure
            </h3>
            <dl className="mt-1 divide-y divide-border/60">
              <Row label="Measure" value={displayedMetric.label} />
              <Row
                label="Source column"
                value={
                  displayedMetric.sourceColumn
                    ? `${displayedMetric.sourceSheet ?? activeSheet ?? "sheet"} · column ${displayedMetric.sourceColumn}`
                    : "Not recorded"
                }
              />
              <Row
                label="Basis years available"
                value={
                  displayedMetric.basisYears.length > 0
                    ? displayedMetric.basisYears.join(", ")
                    : "None — this measure carries no year comparison"
                }
              />
            </dl>
          </section>
        ) : null}

        <section>
          <h3 className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Ingestion
          </h3>
          <dl className="mt-1 divide-y divide-border/60">
            <Row
              label="Status"
              value="Completed — these figures are the current ones for this period"
              hint="Superseded figures from an earlier run of the same sheet are excluded"
            />
            <Row label="Received" value={stamp(quality?.receivedAt ?? null)} />
            <Row label="Loaded" value={stamp(quality?.ingestedAt ?? scope.ingestedAt)} />
            <Row
              label="Parser"
              value={
                /*
                  The parser behind THIS SHEET, not the period's most recent
                  one. A month-to-date period holds two ingestions of the same
                  workbook, so naming the scope's parser here would credit the
                  rolling mapping for figures the year-comparison mapping read.
                */
                quality
                  ? `${quality.parserKey} v${quality.parserVersion}`
                  : `${scope.parserKey} v${scope.parserVersion}`
              }
              hint="Which reviewed mapping read this sheet"
            />
          </dl>
        </section>

        <section>
          <h3 className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            What the parser excluded
          </h3>
          {quality === null ? (
            <p className="mt-1 text-xs text-muted-foreground">Not recorded.</p>
          ) : quality.warningCount === 0 ? (
            <p className="mt-1 text-xs text-muted-foreground">
              Nothing was excluded from this sheet.
            </p>
          ) : (
            <ul className="mt-1 space-y-1.5">
              {quality.warningsByCode.map((group) => (
                <li key={group.code} className="text-xs">
                  <span className="font-medium tabular-nums text-foreground">
                    {group.count}
                  </span>{" "}
                  <span className="text-muted-foreground">{warningSentence(group.code)}</span>
                  {/*
                    The individual messages name the columns. Useful to whoever
                    has to reconcile against the workbook, and one level further
                    down so the counts stay readable.
                  */}
                  <details className="mt-0.5">
                    <summary className="cursor-pointer list-none text-[11px] text-subtle-foreground outline-none hover:text-muted-foreground focus-visible:ring-2 focus-visible:ring-primary/40 [&::-webkit-details-marker]:hidden">
                      Which columns
                    </summary>
                    <ul className="mt-1 space-y-0.5 border-l border-border pl-2.5">
                      {group.messages.map((message, index) => (
                        <li
                          key={`${group.code}-${index}`}
                          className="text-[11px] leading-relaxed text-subtle-foreground"
                        >
                          {message}
                        </li>
                      ))}
                    </ul>
                  </details>
                </li>
              ))}
            </ul>
          )}

          <dl className="mt-2 divide-y divide-border/60">
            <Row
              label="Rows skipped"
              value={
                quality?.skippedRowsByReason === null || quality === null
                  ? "Not recorded"
                  : quality.skippedRowsByReason
                      .map((entry) => `${entry.count} ${entry.reason}`)
                      .join(", ")
              }
              hint="The parser counts these; this schema version does not store them, so the count is not available rather than zero"
            />
          </dl>
        </section>
      </div>
    </details>
  );
}
