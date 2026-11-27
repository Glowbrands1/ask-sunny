// Copied from the Leadership Hub (src/app/meetings/recaps/page.tsx); keep in step with it. See src/features/l10/README.md.
// Ask Sunny opens one meeting, so this is that meeting's recaps (the Hub's ?meeting=<key> view) at /meetings/<key>/recaps.
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { L10Frame } from "@/features/l10/L10Frame";
import { listRecaps, openMeeting } from "@/features/l10/data.server";
import { AUTO_SAVED_LABEL } from "@/features/l10/lib/autosave";
import { isMeetingKey } from "@/features/l10/lib/config";
import { formatDuration, formatHeld } from "@/features/l10/lib/doc";
import { recapToPast } from "@/features/l10/lib/past";
import { PastMeetingDetails } from "@/features/l10/meeting/_components/MeetingSummary";
import { DeleteRecapButton } from "@/features/l10/meeting/_components/DeleteRecapButton";
import { PrintButton } from "@/features/l10/meeting/_components/PrintButton";
import { Card, PageHeader } from "@/features/l10/ui/ui";
import { requireAuthenticatedPage } from "@/lib/auth/page";
import { NotAttendee } from "@/features/l10/NotAttendee";

export const metadata: Metadata = { title: "Meeting recaps" };
export const dynamic = "force-dynamic";

/**
 * Every concluded meeting: open to-dos, solved issues, cascading message, rating. Export PDF prints these recaps.
 * Delete shows for Hub admins only, as in the Hub; the Hub's database refuses anyone else.
 */
export default async function RecapsPage({ params, searchParams }: { params: Promise<{ key: string }>; searchParams: Promise<{ deleted?: string | string[] }> }) {
  await requireAuthenticatedPage();
  const { key } = await params;
  if (!isMeetingKey(key)) notFound();
  // Same gate as the meeting itself: a meeting you cannot open here has no recaps page either.
  const opened = await openMeeting(key);
  // Only its attendees (and admins) open a meeting; the Hub refused this person (src/features/l10/lib/access.ts).
  if (!opened.ok && opened.reason === "forbidden") return <NotAttendee />;
  const all = opened.ok ? await listRecaps(key) : null;
  if (!opened.ok || !all?.ok) {
    return (
      <Frame meetingKey={key}>
        <Card>
          <p className="m-0 text-sm">The recaps could not be loaded just now. Please try again in a minute.</p>
        </Card>
      </Frame>
    );
  }
  const { info, people, viewer } = opened.meeting;
  const isAdmin = viewer.isHubAdmin;
  const recaps = all.recaps.filter((r) => r.meeting_key === key && !r.deleted_at);
  const sp = await searchParams;
  const deletedNote =
    sp.deleted === "1" ? (
      <p role="status" data-testid="recap-deleted" className="m-0 rounded-lg bg-sunny px-4 py-2 text-sm print:hidden">
        Recap deleted. An admin can restore it.
      </p>
    ) : null;
  const picker = (
    <div className="flex flex-wrap items-center gap-2 print:hidden">
      <PrintButton label={`Export PDF: ${info.name} recaps`} />
      <Link href={`/meetings/${key}/report`} className="inline-flex min-h-11 items-center px-2 text-[13px] font-semibold text-bronze-deep hover:underline">
        {`${info.name} report`}
      </Link>
    </div>
  );
  if (recaps.length === 0) {
    return (
      <Frame meetingKey={key}>
        {picker}
        {deletedNote}
        <Card>
          <p className="m-0 text-sm">{`No ${info.name} recaps yet.`} A recap is saved when a meeting ends.</p>
        </Card>
      </Frame>
    );
  }
  return (
    <Frame meetingKey={key}>
      {picker}
      {deletedNote}
      <p className="m-0 hidden text-lg font-bold print:block">{`${info.name} recaps`}</p>
      <ul className="m-0 flex list-none flex-col gap-4 p-0">
      {recaps.map((r) => (
        <li key={r.id}>
          <Card aria-label={`${info.name} recap ${formatHeld(r.held_at)}`} className="flex flex-col gap-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="m-0 text-lg font-bold">{info.name}</h2>
              <span className="flex flex-wrap items-center gap-3 text-sm text-muted">
                {formatHeld(r.held_at)} · {formatDuration(r.duration_seconds)}
                {isAdmin && <DeleteRecapButton id={r.id} label={`${info.name} recap from ${formatHeld(r.held_at)}`} />}
              </span>
            </div>
            {r.auto_saved && (
              <p data-testid="recap-auto-saved" className="m-0 self-start rounded-full bg-warn px-3 py-1 text-xs font-bold text-warn-ink">
                {AUTO_SAVED_LABEL}. Nobody pressed End, so ratings and the cascading message may be incomplete.
              </p>
            )}
            {(() => {
              const m = recapToPast(r);
              const rated = m.attendees.filter((x) => x.rating !== null).length;
              return (
                <>
                  <p className="m-0 text-sm">
                    Rating {m.ratingAvg !== null ? Number(m.ratingAvg).toFixed(1) : "—"} · {m.issuesSolved} issues solved
                    {m.todosCompletedPct !== null && ` · ${m.todosCompletedPct}% to-dos completed`} · {rated} of {m.attendees.length} rated
                  </p>
                  {/* Each row opens its full summary, as Bloom's "Summary for <date>" (the owner's request, 15 Nov 2026). */}
                  <PastMeetingDetails meeting={m} people={people} />
                </>
              );
            })()}
          </Card>
        </li>
      ))}
      </ul>
    </Frame>
  );
}

function Frame({ meetingKey, children }: { meetingKey: string; children: ReactNode }) {
  return (
    <L10Frame meetingKey={meetingKey} assistant={false}>
      <PageHeader eyebrow="L10 MEETINGS" title="Meeting recaps">
        <Link href={`/meetings/${meetingKey}`} className="text-[13px] font-semibold text-bronze-deep hover:underline print:hidden">
          ← Back to the meeting
        </Link>
      </PageHeader>
      {children}
    </L10Frame>
  );
}
