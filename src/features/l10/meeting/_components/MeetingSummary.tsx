// Copied from the Leadership Hub (src/app/meetings/_components/MeetingSummary.tsx); keep in step with it. See src/features/l10/README.md.
import { MentionText } from "@/features/l10/ui/Mentions";
import { durationLabel, initials, mmddyyyy } from "@/features/l10/lib/bloom";
import type { PastMeeting } from "@/features/l10/lib/past";
import type { Person } from "@/features/l10/lib/mentions";

/*
 * A past meeting's summary, laid out like Bloom Growth's "Summary for <date>" (the owner's requests, 15 Nov 2026): the
 * stats, FEEDBACK, TO-DOS and ISSUES SOLVED by owner, NOTES and the cascading message. Used by the Conclude page before a
 * meeting starts and by each row of the Past meetings / recaps list, so the two look the same. Read-only, and safe to
 * render from a server page.
 */

export const SECTION = "flex flex-col gap-2 rounded-[10px] border border-line bg-white p-4 shadow-card";
export const LABEL = "m-0 text-xs font-bold tracking-[0.06em] text-muted";
const NOT_RECORDED = "Not recorded";

/** A rating chip and the person's name; a missing rating shows a dash. */
export function RatingChip({ name, rating }: { name: string; rating: number | null }) {
  return (
    <li className="flex items-center gap-2 text-sm">
      <span className={`flex h-7 min-w-9 items-center justify-center rounded-full px-2 font-mono text-xs font-bold ${rating === null ? "bg-cream text-muted" : rating >= 8 ? "bg-ok text-ink" : rating >= 6 ? "bg-cream text-ink" : "bg-warn text-warn-ink"}`}>
        {rating ?? "–"}
      </span>
      <span className="min-w-0 truncate">{name}</span>
    </li>
  );
}

/** Groups items by owner, keeping the first-seen order; an empty owner is "Unassigned". */
export function byOwner<T>(items: T[], ownerOf: (t: T) => string): [string, T[]][] {
  const groups = new Map<string, T[]>();
  for (const t of items) {
    const o = ownerOf(t).trim() || "Unassigned";
    groups.set(o, [...(groups.get(o) ?? []), t]);
  }
  return [...groups];
}

export function OwnerHeading({ name }: { name: string }) {
  return (
    <div className="flex items-center gap-2 text-sm font-semibold">
      <span aria-hidden title={name} className="flex size-7 flex-none items-center justify-center rounded-full bg-cream text-[10px] font-bold">
        {initials(name)}
      </span>
      <span title={name}>{name}</span>
    </div>
  );
}

const Muted = ({ children }: { children: string }) => <p className="m-0 text-sm text-muted">{children}</p>;

/** The summary itself. `people` turns @-mentions into names (otherwise the page's mention roster is used). */
export function MeetingSummary({ meeting: m, people, label = "Meeting" }: { meeting: PastMeeting; people?: readonly Person[]; label?: string }) {
  const stats: [string, string][] = [
    ["Meeting rating", m.ratingAvg === null ? "—" : String(m.ratingAvg)],
    ["To-dos completed", m.todosCompletedPct === null ? "—" : `${m.todosCompletedPct}%`],
    ["Issues solved", String(m.issuesSolved)],
    ["Total time", durationLabel(m.durationSeconds)],
  ];
  const text = (t: string) => <MentionText text={t} people={people} />;
  return (
    <div className="flex flex-col gap-4" data-testid="meeting-summary">
      <dl aria-label={`${label} stats`} className="m-0 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {stats.map(([name, value]) => (
          <div key={name} className="rounded-[10px] border border-line bg-white px-3 py-2 shadow-card">
            <dt className="text-xs text-muted">{name}</dt>
            <dd className="m-0 font-mono text-lg font-bold" title={name === "To-dos completed" && value === "—" ? "Not recorded on this meeting" : undefined}>
              {value}
            </dd>
          </div>
        ))}
      </dl>
      <div className={SECTION}>
        <h3 className={LABEL}>FEEDBACK</h3>
        {m.attendees.length === 0 ? (
          <Muted>No ratings were recorded.</Muted>
        ) : (
          <ul aria-label="Feedback" className="m-0 grid list-none grid-cols-1 gap-1.5 p-0 sm:grid-cols-2 lg:grid-cols-3">
            {m.attendees.map((a) => (
              <RatingChip key={a.name} name={a.name} rating={a.rating} />
            ))}
          </ul>
        )}
      </div>
      <div className={SECTION}>
        <h3 className={LABEL}>TO-DOS</h3>
        {!m.recorded.todos ? (
          <Muted>{NOT_RECORDED}</Muted>
        ) : m.openTodos.length === 0 ? (
          <Muted>{m.source === "l10" ? "No open to-dos were carried forward." : "No to-dos."}</Muted>
        ) : (
          <div aria-label="To-dos by owner" role="group" className="flex flex-col gap-3">
            {byOwner(m.openTodos, (t) => t.owner).map(([owner, todos]) => (
              <div key={owner} className="flex flex-col gap-1">
                <OwnerHeading name={owner} />
                <ul className="m-0 flex list-none flex-col gap-1 p-0 pl-9">
                  {todos.map((t, i) => (
                    <li key={i} className="flex items-baseline justify-between gap-3 text-sm">
                      <span className="min-w-0">{text(t.text)}</span>
                      {t.due && <span className="flex-none font-mono text-xs text-muted">{mmddyyyy(t.due) || t.due}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className={SECTION}>
        <h3 className={LABEL}>ISSUES SOLVED</h3>
        {!m.recorded.issues ? (
          <Muted>{m.issuesSolved > 0 ? `${NOT_RECORDED} (${m.issuesSolved} solved)` : NOT_RECORDED}</Muted>
        ) : m.solvedIssues.length === 0 ? (
          <Muted>No issues were solved.</Muted>
        ) : (
          <div aria-label="Issues solved by owner" role="group" className="flex flex-col gap-3">
            {byOwner(m.solvedIssues, (s) => s.owner).map(([owner, issues]) => (
              <div key={owner} className="flex flex-col gap-1">
                <OwnerHeading name={owner} />
                <ul className="m-0 list-disc pl-14 text-sm">
                  {issues.map((s, i) => (
                    <li key={i}>{text(s.title)}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className={SECTION}>
        <h3 className={LABEL}>NOTES</h3>
        {!m.recorded.notes ? <Muted>{NOT_RECORDED}</Muted> : m.notes ? <p className="m-0 text-sm whitespace-pre-wrap">{text(m.notes)}</p> : <Muted>No notes.</Muted>}
      </div>
      {m.cascade && (
        <div className={SECTION}>
          <h3 className={LABEL}>CASCADING MESSAGE</h3>
          <p className="m-0 text-sm whitespace-pre-wrap">{text(m.cascade)}</p>
        </div>
      )}
    </div>
  );
}

/**
 * One row of the Past meetings / recaps list opens its summary, as Bloom's "Summary for <date>". A native <details>: a
 * click, Enter or Space on "Summary for …" opens and closes it, with no script, and it is read-only.
 */
export function PastMeetingDetails({ meeting, people }: { meeting: PastMeeting; people?: readonly Person[] }) {
  const title = `Summary for ${mmddyyyy(meeting.heldAt)}`;
  return (
    <details className="group" data-testid="past-meeting-details">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-lg px-1 text-sm font-semibold text-bronze-deep hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bronze [&::-webkit-details-marker]:hidden">
        <span aria-hidden className="text-xs transition-transform group-open:rotate-90">
          ▶
        </span>
        {title}
      </summary>
      <div className="mt-3">
        <MeetingSummary meeting={meeting} people={people} label={title} />
      </div>
    </details>
  );
}
