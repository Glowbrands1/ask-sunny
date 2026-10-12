import { ReportBand } from "@/features/reports/report-frame";

/**
 * WHILE THE GOOGLE REVIEWS SNAPSHOT IS READ.
 *
 * The page reads several rollups before it can draw a figure, so a reader who
 * opens it sees the band and the shape of the page at once rather than the
 * previous screen frozen under a pending navigation. No figure is drawn here —
 * not even a zero — because a zero that later turns into 12 is a number
 * somebody already read.
 */
export default function ReviewsLoading() {
  return (
    <div className="min-w-0" aria-busy="true" aria-live="polite">
      <ReportBand title="Google Reviews" description="Loading this month's review counts…" />
      <div className="flex min-w-0 flex-col gap-4 px-5 py-5 sm:px-6">
        <span className="sr-only">Loading Google Reviews</span>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((tile) => (
            <div
              key={tile}
              aria-hidden
              className="h-[148px] animate-pulse rounded-[var(--radius-lg)] border border-border bg-surface shadow-raised motion-reduce:animate-none"
            />
          ))}
        </div>
        <div
          aria-hidden
          className="flex flex-col gap-3 rounded-[var(--radius-lg)] border border-border bg-surface p-4 shadow-raised"
        >
          {[82, 94, 71, 88, 77, 91].map((width) => (
            <span
              key={width}
              className="block h-3.5 animate-pulse rounded-[6px] bg-surface-muted motion-reduce:animate-none"
              style={{ width: `${width}%` }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
