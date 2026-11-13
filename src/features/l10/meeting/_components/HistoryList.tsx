// Copied from the Leadership Hub (src/app/meetings/_components/HistoryList.tsx); keep in step with it. See src/features/l10/README.md.
import Link from "next/link";
import { Card, PageHeader } from "@/features/l10/ui/ui";
import type { HistoryRow } from "@/features/l10/data.server";

export interface HistoryEntry {
  row: HistoryRow;
  /** What changed versus the previous version, in words ("" for an import, which has its own label). */
  summary: string;
  /** The saved time, already formatted in Central. */
  when: string;
}

/** Who (or what) made a version. */
export function saverLabel(r: HistoryRow): string {
  if (r.isImport) return r.source === "lovable-starter-data" ? "Starter data from Lovable" : "Imported from Lovable";
  return r.savedByName ? `Saved by ${r.savedByName}` : "Saved by an administrator or the system";
}

/** Every saved version of a meeting, newest first. */
export function HistoryList({ meetingKey, meetingName, entries, olderBefore, hubHistoryHref }: { meetingKey: string; meetingName: string; entries: HistoryEntry[]; olderBefore: number | null; /** Restoring a version is a Hub admin action, done in the Leadership Hub. */ hubHistoryHref: string }) {
  const button = "inline-flex min-h-11 items-center rounded-lg border border-line bg-white px-3 text-sm font-semibold hover:bg-cream";
  return (
    <>
      <PageHeader eyebrow="L10 MEETINGS" title={`${meetingName}: version history`}>
        <Link href={`/meetings/${meetingKey}`} className="text-[13px] font-semibold text-bronze-deep hover:underline">
          ← Back to the meeting
        </Link>
      </PageHeader>
      <p className="m-0 text-sm text-muted">
        Every saved version, newest first. Viewing an old version changes nothing. Times are Central. Restoring a version is done by a Hub admin in the{" "}
        <a href={hubHistoryHref} target="_blank" rel="noopener noreferrer" className="font-semibold text-bronze-deep underline">
          Leadership Hub ↗
        </a>
        .
      </p>
      <ol className="m-0 flex list-none flex-col gap-3 p-0" aria-label="Saved versions">
        {entries.map(({ row: r, summary, when }) => (
          <li key={r.version}>
            <Card aria-label={`Version ${r.version}`} className="flex flex-col gap-2">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="m-0 text-base font-bold">
                  Version {r.version}
                  {r.isCurrent && <span className="ml-2 rounded-full bg-ink px-2 py-0.5 text-[11px] font-bold text-gold">Current</span>}
                </h2>
                <span className="text-sm text-muted">{when}</span>
              </div>
              <p className="m-0 text-sm font-semibold">{saverLabel(r)}</p>
              {summary && (
                <p className="m-0 text-sm" data-testid="change-summary">
                  {summary}
                </p>
              )}
              <div className="flex flex-wrap items-center gap-2">
                {r.isCurrent ? (
                  <Link href={`/meetings/${meetingKey}`} className={button}>
                    Open the live meeting
                  </Link>
                ) : (
                  <Link href={`/meetings/${meetingKey}/history/${r.version}`} aria-label={`View version ${r.version}`} className={button}>
                    View
                  </Link>
                )}
              </div>
            </Card>
          </li>
        ))}
      </ol>
      {olderBefore !== null && (
        <Link href={`/meetings/${meetingKey}/history?before=${olderBefore}`} className="self-start text-sm font-semibold text-bronze-deep hover:underline">
          Older versions →
        </Link>
      )}
    </>
  );
}
