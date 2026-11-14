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
import { businessDate, todoState } from "@/features/l10/lib/dueStatus";
import { DeleteRecapButton } from "@/features/l10/meeting/_components/DeleteRecapButton";
import { PrintButton } from "@/features/l10/meeting/_components/PrintButton";
import { MentionText } from "@/features/l10/ui/Mentions";
import { StatusBadge } from "@/features/l10/ui/StatusBadge";
import { Card, PageHeader } from "@/features/l10/ui/ui";
import { requireAuthenticatedPage } from "@/lib/auth/page";

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
  if (!opened.ok && opened.reason === "forbidden") notFound();
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
  const today = businessDate();
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
            <dl className="m-0 grid grid-cols-3 gap-3 text-sm max-[500px]:grid-cols-1">
              <div>
                <dt className="text-[11px] font-bold tracking-wide text-muted uppercase">Overall rating</dt>
                <dd className="m-0 text-3xl font-bold">{r.rating_avg != null ? Number(r.rating_avg).toFixed(1) : "—"}</dd>
              </div>
              <div>
                <dt className="text-[11px] font-bold tracking-wide text-muted uppercase">Issues solved</dt>
                <dd className="m-0 text-3xl font-bold">{r.resolved_issues?.length ?? 0}</dd>
              </div>
              <div>
                <dt className="text-[11px] font-bold tracking-wide text-muted uppercase">Attendees</dt>
                <dd className="m-0">
                  {(r.attendees ?? []).map((a) => (
                    <span key={a.name} className="mr-1.5 inline-block text-xs">
                      {a.name}
                      {a.rating != null ? ` · ${a.rating}` : ""}
                    </span>
                  ))}
                </dd>
              </div>
            </dl>
            {(r.open_todos?.length ?? 0) > 0 && (
              <div>
                <h3 className="m-0 mb-1 text-sm font-bold">Outstanding to-dos</h3>
                <ul className="m-0 list-disc pl-5 text-sm">
                  {r.open_todos.map((t, i) => (
                    <li key={i}>
                      <MentionText text={t.text ?? ""} people={people} /> <span className="text-muted">· {t.owner} · {t.dueDate ?? t.due}</span>
                      {todoState({ done: false, dueDate: t.dueDate }, today) !== "none" && <StatusBadge className="ml-2 align-middle" state={todoState({ done: false, dueDate: t.dueDate }, today) as "overdue" | "soon"} />}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {(r.resolved_issues?.length ?? 0) > 0 && (
              <div>
                <h3 className="m-0 mb-1 text-sm font-bold">Issues solved</h3>
                <ul className="m-0 list-disc pl-5 text-sm">
                  {r.resolved_issues.map((t, i) => (
                    <li key={i}>
                      <MentionText text={t} people={people} />
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {r.cascade && (
              <div>
                <h3 className="m-0 mb-1 text-sm font-bold">Cascading message</h3>
                <p className="m-0 text-sm">
                  <MentionText text={r.cascade} people={people} />
                </p>
              </div>
            )}
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
