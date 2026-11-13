// Ask Sunny only (not copied from the Leadership Hub): the DM L10's "Past meetings" list. See src/features/l10/README.md.
import Link from "next/link";

import { formatDuration } from "@/features/l10/lib/doc";
import type { PastMeeting } from "@/features/l10/lib/past";
import { formatCentral } from "@/features/l10/lib/when";
import { Card, PageHeader } from "@/features/l10/ui/ui";

const SOURCE: Record<PastMeeting["source"], string> = { l10: "Held here", "bloom-growth": "From Bloom Growth" };

/** Every past meeting, newest first, times in Central. A new meeting is started from the live meeting page. */
export function PastMeetings({ meetingKey, meetingName, meetings }: { meetingKey: string; meetingName: string; meetings: PastMeeting[] }) {
  const button = "inline-flex min-h-11 items-center rounded-lg border border-line bg-white px-3 text-sm font-semibold hover:bg-cream";
  return (
    <>
      <PageHeader eyebrow="L10 MEETINGS" title={`${meetingName}: past meetings`}>
        <Link href={`/meetings/${meetingKey}`} className="text-[13px] font-semibold text-bronze-deep hover:underline">
          ← Back to the meeting
        </Link>
      </PageHeader>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="m-0 text-sm text-muted">Every meeting held, newest first. Times are Central (CT). A meeting shows here once someone presses End meeting.</p>
        <Link href={`/meetings/${meetingKey}`} className={button} data-testid="start-new-meeting">
          Start this week&rsquo;s meeting
        </Link>
      </div>
      {meetings.length === 0 ? (
        <Card>
          <p className="m-0 text-sm">No past meetings yet.</p>
        </Card>
      ) : (
        <ol className="m-0 flex list-none flex-col gap-3 p-0" aria-label="Past meetings">
          {meetings.map((m) => {
            const rated = m.attendees.filter((a) => a.rating !== null);
            return (
              <li key={m.key}>
                <Card aria-label={`Meeting on ${formatCentral(m.heldAt)}`} className="flex flex-col gap-2">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h2 className="m-0 text-base font-bold">{formatCentral(m.heldAt)}</h2>
                    <span className="rounded-full bg-cream px-2 py-0.5 text-[11px] font-bold text-muted">{SOURCE[m.source]}</span>
                  </div>
                  <dl className="m-0 grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
                    <div>
                      <dt className="text-xs text-muted">Length</dt>
                      <dd className="m-0 font-semibold">{m.durationSeconds ? formatDuration(m.durationSeconds) : "—"}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted">Average rating</dt>
                      <dd className="m-0 font-semibold">{m.ratingAvg !== null ? m.ratingAvg.toFixed(1) : "Not rated"}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted">Issues solved</dt>
                      <dd className="m-0 font-semibold">{m.issuesSolved}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted">Rated</dt>
                      <dd className="m-0 font-semibold">
                        {rated.length} of {m.attendees.length}
                      </dd>
                    </div>
                  </dl>
                  {m.attendees.length > 0 && (
                    <p className="m-0 text-sm" data-testid="past-attendees">
                      {m.attendees.map((a) => `${a.name} (${a.rating ?? "—"})`).join(" · ")}
                    </p>
                  )}
                  {m.solvedTitles.length > 0 && (
                    <div className="text-sm">
                      <span className="text-xs text-muted">Solved:</span>
                      <ul className="m-0 mt-1 pl-5">
                        {m.solvedTitles.map((t, n) => (
                          <li key={n}>{t}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {m.cascade && (
                    <p className="m-0 text-sm">
                      <span className="text-xs text-muted">Cascading message: </span>
                      {m.cascade}
                    </p>
                  )}
                </Card>
              </li>
            );
          })}
        </ol>
      )}
    </>
  );
}
