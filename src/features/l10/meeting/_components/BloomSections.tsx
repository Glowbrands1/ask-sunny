"use client";
// Copied from the Leadership Hub (src/app/meetings/_components/BloomSections.tsx); keep in step with it. See src/features/l10/README.md.

import { cx } from "@/features/l10/ui/ui";
import { MentionField } from "@/features/l10/ui/Mentions";
import { durationLabel, initials, mmddyyyy } from "@/features/l10/lib/bloom";
import type { PastMeeting } from "@/features/l10/lib/past";

/*
 * Segue and Conclude on a Bloom-style meeting (the DM L10s; the owner's request, 15 Nov 2026), laid out like Bloom
 * Growth's pages in the Hub's own look. The round-robin list and the Conclude steps are the existing ones.
 */

const SECTION = "flex flex-col gap-2 rounded-[10px] border border-line bg-white p-4 shadow-card";
const LABEL = "m-0 text-xs font-bold tracking-[0.06em] text-muted";

/** A rating chip and the person's name; a missing rating shows a dash. */
function RatingChip({ name, rating }: { name: string; rating: number | null }) {
  return (
    <li className="flex items-center gap-2 text-sm">
      <span className={cx("flex h-7 min-w-9 items-center justify-center rounded-full px-2 font-mono text-xs font-bold", rating === null ? "bg-cream text-muted" : rating >= 8 ? "bg-ok text-ink" : rating >= 6 ? "bg-cream text-ink" : "bg-warn text-warn-ink")}>
        {rating ?? "–"}
      </span>
      <span className="min-w-0 truncate">{name}</span>
    </li>
  );
}

/** Segue: "Last week's feedback", the ratings (and cascade) people gave at the end of the last meeting. */
export function LastWeekFeedback({ last }: { last: PastMeeting | null }) {
  const rated = last ? last.attendees.filter((a) => a.rating !== null) : [];
  return (
    <section aria-label="Last week's feedback" className={SECTION}>
      <h3 className={LABEL}>LAST WEEK&apos;S FEEDBACK</h3>
      {!last || (rated.length === 0 && !last.cascade) ? (
        <p className="m-0 text-sm text-muted">Add your feedback in Conclude to see it here.</p>
      ) : (
        <>
          <p className="m-0 text-sm text-muted">
            {mmddyyyy(last.heldAt)}
            {last.ratingAvg !== null && ` · Meeting rating ${last.ratingAvg}`}
          </p>
          {rated.length > 0 && (
            <ul aria-label="Last week's ratings" className="m-0 grid list-none grid-cols-1 gap-1.5 p-0 sm:grid-cols-2">
              {last.attendees.map((a) => (
                <RatingChip key={a.name} name={a.name} rating={a.rating} />
              ))}
            </ul>
          )}
          {last.cascade && <p className="m-0 text-sm whitespace-pre-wrap">{last.cascade}</p>}
        </>
      )}
    </section>
  );
}

/** Segue: "This week's question", one shared prompt for the round-robin (stored as `segueQuestion` in the meeting document). */
export function SegueQuestion({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <section aria-label="This week's question" className={SECTION}>
      <h3 className={LABEL}>THIS WEEK&apos;S QUESTION</h3>
      <MentionField multiline aria-label="This week's question" value={value} onChange={onChange} placeholder="The question everyone answers this week…" className="min-h-16 py-2" />
    </section>
  );
}

/** Groups items by owner, keeping the first-seen order; an empty owner is "Unassigned". */
function byOwner<T>(items: T[], ownerOf: (t: T) => string): [string, T[]][] {
  const groups = new Map<string, T[]>();
  for (const t of items) {
    const o = ownerOf(t).trim() || "Unassigned";
    groups.set(o, [...(groups.get(o) ?? []), t]);
  }
  return [...groups];
}

function OwnerHeading({ name }: { name: string }) {
  return (
    <div className="flex items-center gap-2 text-sm font-semibold">
      <span aria-hidden title={name} className="flex size-7 flex-none items-center justify-center rounded-full bg-cream text-[10px] font-bold">
        {initials(name)}
      </span>
      <span title={name}>{name}</span>
    </div>
  );
}

/**
 * Conclude before the meeting starts: the last meeting's summary, as Bloom shows it. A stats row (meeting rating, to-dos
 * completed, issues solved, total time), FEEDBACK (each person's rating), the TO-DOS still open by owner with due dates,
 * ISSUES SOLVED and NOTES. A recap does not record how many to-dos were done, so that stat shows a dash.
 */
export function LastMeetingConclusion({ last }: { last: PastMeeting | null }) {
  if (!last) {
    return (
      <section aria-label="Last meeting" className={SECTION}>
        <p className="m-0 text-sm text-muted">No past meeting yet. Once a meeting is ended, its summary shows here until the next one starts.</p>
      </section>
    );
  }
  const stats: [string, string][] = [
    ["Meeting rating", last.ratingAvg === null ? "—" : String(last.ratingAvg)],
    ["To-dos completed", "—"],
    ["Issues solved", String(last.issuesSolved)],
    ["Total time", durationLabel(last.durationSeconds)],
  ];
  return (
    <section aria-label="Last meeting" className="flex flex-col gap-4" data-testid="last-meeting-conclusion">
      <p className="m-0 text-sm text-muted">
        The last meeting, held {mmddyyyy(last.heldAt)}. Start the meeting to rate this one and save its recap.
      </p>
      <dl aria-label="Last meeting stats" className="m-0 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {stats.map(([label, value]) => (
          <div key={label} className="rounded-[10px] border border-line bg-white px-3 py-2 shadow-card">
            <dt className="text-xs text-muted">{label}</dt>
            <dd className="m-0 font-mono text-lg font-bold" title={label === "To-dos completed" ? "Not recorded on the recap" : undefined}>
              {value}
            </dd>
          </div>
        ))}
      </dl>
      <div className={SECTION}>
        <h3 className={LABEL}>FEEDBACK</h3>
        {last.attendees.length === 0 ? (
          <p className="m-0 text-sm text-muted">No ratings were recorded.</p>
        ) : (
          <ul aria-label="Feedback" className="m-0 grid list-none grid-cols-1 gap-1.5 p-0 sm:grid-cols-2 lg:grid-cols-3">
            {last.attendees.map((a) => (
              <RatingChip key={a.name} name={a.name} rating={a.rating} />
            ))}
          </ul>
        )}
      </div>
      <div className={SECTION}>
        <h3 className={LABEL}>TO-DOS</h3>
        {last.openTodos.length === 0 ? (
          <p className="m-0 text-sm text-muted">No open to-dos were carried forward.</p>
        ) : (
          <div aria-label="To-dos by owner" role="group" className="flex flex-col gap-3">
            {byOwner(last.openTodos, (t) => t.owner).map(([owner, todos]) => (
              <div key={owner} className="flex flex-col gap-1">
                <OwnerHeading name={owner} />
                <ul className="m-0 flex list-none flex-col gap-1 p-0 pl-9">
                  {todos.map((t, i) => (
                    <li key={i} className="flex items-baseline justify-between gap-3 text-sm">
                      <span className="min-w-0">{t.text}</span>
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
        {last.solvedTitles.length === 0 ? (
          <p className="m-0 text-sm text-muted">{last.issuesSolved > 0 ? `${last.issuesSolved} solved (titles were not imported).` : "No issues were solved."}</p>
        ) : (
          <ul aria-label="Issues solved" className="m-0 list-disc pl-5 text-sm">
            {last.solvedTitles.map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ul>
        )}
      </div>
      <div className={SECTION}>
        <h3 className={LABEL}>NOTES</h3>
        <p className="m-0 text-sm whitespace-pre-wrap">{last.notes ?? <span className="text-muted">No notes.</span>}</p>
      </div>
    </section>
  );
}
