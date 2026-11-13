import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { L10Frame, hubMeetingUrl } from "@/features/l10/L10Frame";
import { getVersionRange, listHistory, openMeeting } from "@/features/l10/data.server";
import { summarizeChange } from "@/features/l10/lib/changes";
import { isMeetingKey } from "@/features/l10/lib/config";
import { formatCentral } from "@/features/l10/lib/when";
import { HistoryList } from "@/features/l10/meeting/_components/HistoryList";
import { Card } from "@/features/l10/ui/ui";
import { requireAuthenticatedPage } from "@/lib/auth/page";

export const metadata: Metadata = { title: "Version history" };
export const dynamic = "force-dynamic";
const PAGE = 25;

/** The meeting's version history (the Hub's page, read from the Hub). Restoring a version stays a Hub admin action in the Hub. */
export default async function HistoryPage({ params, searchParams }: { params: Promise<{ key: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAuthenticatedPage();
  const { key } = await params;
  if (!isMeetingKey(key)) notFound();
  // Same gate as the meeting itself: a meeting you cannot open here has no history page either.
  const opened = await openMeeting(key);
  if (!opened.ok && opened.reason === "forbidden") notFound();
  if (!opened.ok) return <Message meetingKey={key}>The version history could not be loaded just now. Please try again in a minute.</Message>;
  const info = opened.meeting.info;

  const sp = await searchParams;
  const raw = Array.isArray(sp.before) ? sp.before[0] : sp.before;
  const before = raw && /^\d{1,9}$/.test(raw) ? Number(raw) : undefined;
  const list = await listHistory(key, PAGE, before);
  if (!list.ok) return <Message meetingKey={key}>The version history could not be loaded just now. Please try again in a minute.</Message>;
  const rows = list.rows;
  if (rows.length === 0) return <Message meetingKey={key}>No versions have been saved yet.</Message>;

  // One call for this page's versions plus the one before the oldest, to say what changed between neighbours.
  const newest = rows[0].version;
  const oldest = rows[rows.length - 1].version;
  const range = await getVersionRange(key, Math.max(1, oldest - 1), newest);
  const docs = range.ok ? range.docs : new Map<number, Record<string, unknown>>();

  const entries = rows.map((r) => {
    const doc = docs.get(r.version);
    const prev = r.version === 1 ? undefined : docs.get(r.version - 1);
    const summary = r.isImport ? "" : doc ? summarizeChange(prev ?? (r.version === 1 ? undefined : null), doc) : "Details not available";
    return { row: r, summary, when: formatCentral(r.savedAt) };
  });
  return (
    <L10Frame meetingKey={key} assistant={false}>
      <HistoryList meetingKey={key} meetingName={info.name} entries={entries} olderBefore={oldest > 1 && rows.length === PAGE ? oldest : null} hubHistoryHref={hubMeetingUrl(key, "/history")} />
    </L10Frame>
  );
}

function Message({ meetingKey, children }: { meetingKey: string; children: string }) {
  return (
    <L10Frame meetingKey={meetingKey} assistant={false}>
      <Card>
        <p className="m-0 text-sm">{children}</p>
      </Card>
    </L10Frame>
  );
}
