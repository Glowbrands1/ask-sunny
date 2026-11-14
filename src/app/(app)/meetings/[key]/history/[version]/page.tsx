import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { L10Frame, hubMeetingUrl } from "@/features/l10/L10Frame";
import { getVersion, listHistory, openMeeting } from "@/features/l10/data.server";
import { isMeetingKey } from "@/features/l10/lib/config";
import { businessDate } from "@/features/l10/lib/dueStatus";
import { formatCentral } from "@/features/l10/lib/when";
import { MeetingView } from "@/features/l10/meeting/MeetingView";
import { Card } from "@/features/l10/ui/ui";
import { requireAuthenticatedPage } from "@/lib/auth/page";

export const metadata: Metadata = { title: "Version history" };
export const dynamic = "force-dynamic";

/** One old version, read only (the Hub's page, read from the Hub). */
export default async function VersionPage({ params }: { params: Promise<{ key: string; version: string }> }) {
  await requireAuthenticatedPage();
  const { key, version: raw } = await params;
  if (!isMeetingKey(key) || !/^\d{1,9}$/.test(raw) || Number(raw) < 1) notFound();
  const version = Number(raw);
  // Same gate as the meeting itself.
  const opened = await openMeeting(key);
  if (!opened.ok && opened.reason === "forbidden") notFound();
  const [old, row] = opened.ok ? await Promise.all([getVersion(key, version), listHistory(key, 1, version + 1)]) : [null, null];
  if (!opened.ok || !old?.ok || !row?.ok) {
    return (
      <L10Frame meetingKey={key} assistant={false}>
        <Card>
          <p className="m-0 text-sm">This version could not be loaded just now. Please try again in a minute.</p>
        </Card>
      </L10Frame>
    );
  }
  if (!old.doc) notFound();
  const m = opened.meeting;
  const savedAt = row.rows.find((r) => r.version === version)?.savedAt;
  return (
    <L10Frame meetingKey={key} assistant={false}>
      <MeetingView
        mentionPeople={m.people}
        info={m.info}
        initial={{ version, updatedAt: savedAt ?? null, doc: old.doc }}
        viewer={m.viewer}
        roster={m.roster}
        hubMeetingUrl={hubMeetingUrl(key)}
        pollMs={0}
        // Overdue / due soon are judged as of the day that version was saved, so an old version reads as it did then.
        today={businessDate(savedAt ? new Date(savedAt) : new Date())}
        readOnly={{ version, savedAtLabel: formatCentral(savedAt), historyHref: `/meetings/${key}/history` }}
      />
    </L10Frame>
  );
}
