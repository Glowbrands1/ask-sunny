"use client";
// Copied from the Leadership Hub (src/app/meetings/_components/BloomSections.tsx); keep in step with it. See src/features/l10/README.md.

import { MentionField } from "@/features/l10/ui/Mentions";
import { mmddyyyy } from "@/features/l10/lib/bloom";
import { LABEL, MeetingSummary, RatingChip, SECTION } from "./MeetingSummary";
import type { PastMeeting } from "@/features/l10/lib/past";

/*
 * Segue and Conclude on a Bloom-style meeting (the DM L10s; the owner's request, 15 Nov 2026), laid out like Bloom
 * Growth's pages in the Hub's own look. The round-robin list and the Conclude steps are the existing ones.
 */



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



/** Conclude before the meeting starts: the last meeting's summary, as Bloom shows it (the same summary as Past meetings). */
export function LastMeetingConclusion({ last }: { last: PastMeeting | null }) {
  if (!last) {
    return (
      <section aria-label="Last meeting" className={SECTION}>
        <p className="m-0 text-sm text-muted">No past meeting yet. Once a meeting is ended, its summary shows here until the next one starts.</p>
      </section>
    );
  }
  return (
    <section aria-label="Last meeting" className="flex flex-col gap-4" data-testid="last-meeting-conclusion">
      <p className="m-0 text-sm text-muted">
        The last meeting, held {mmddyyyy(last.heldAt)}. Start the meeting to rate this one and save its recap.
      </p>
      <MeetingSummary meeting={last} label="Last meeting" />
    </section>
  );
}
