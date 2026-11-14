import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { L10Frame } from "@/features/l10/L10Frame";
import { listRecaps, openMeeting } from "@/features/l10/data.server";
import { isMeetingKey } from "@/features/l10/lib/config";
import { pastMeetings } from "@/features/l10/lib/past";
import { PastMeetings } from "@/features/l10/meeting/_components/PastMeetings";
import { Card } from "@/features/l10/ui/ui";
import { requireAuthenticatedPage } from "@/lib/auth/page";

export const metadata: Metadata = { title: "Past meetings" };
export const dynamic = "force-dynamic";

/** Every past DM L10: recaps saved by End meeting (here or in the Hub) and the meetings imported from Bloom Growth. */
export default async function PastMeetingsPage({ params }: { params: Promise<{ key: string }> }) {
  await requireAuthenticatedPage();
  const { key } = await params;
  if (!isMeetingKey(key)) notFound();
  // Same gate as the meeting itself: a meeting you cannot open here has no past meetings page either.
  const opened = await openMeeting(key);
  if (!opened.ok && opened.reason === "forbidden") notFound();
  const recaps = opened.ok ? await listRecaps(key) : null;
  if (!opened.ok || !recaps?.ok) {
    return (
      <L10Frame meetingKey={key} assistant={false}>
        <Card>
          <p className="m-0 text-sm">The past meetings could not be loaded just now. Please try again in a minute.</p>
        </Card>
      </L10Frame>
    );
  }
  const { info, loaded } = opened.meeting;
  return (
    <L10Frame meetingKey={key} assistant={false}>
      <PastMeetings meetingKey={key} meetingName={info.name} meetings={pastMeetings(recaps.recaps, loaded.doc ?? {})} />
    </L10Frame>
  );
}
