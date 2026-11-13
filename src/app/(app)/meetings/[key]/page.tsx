import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { L10Frame, hubMeetingUrl } from "@/features/l10/L10Frame";
import { endMeetingAction, loadMeetingAction, saveMeetingAction } from "@/features/l10/actions";
import { openMeeting } from "@/features/l10/data.server";
import { isMeetingKey } from "@/features/l10/lib/config";
import { businessDate } from "@/features/l10/lib/dueStatus";
import { MeetingView } from "@/features/l10/meeting/MeetingView";
import { Card } from "@/features/l10/ui/ui";
import { requireAuthenticatedPage } from "@/lib/auth/page";

export const metadata: Metadata = { title: "DM L10" };
export const dynamic = "force-dynamic";

/** "Sun, Nov 1" in the company's time zone (Central), so an evening meeting does not show tomorrow's date. */
const dateLabel = (d: Date) => new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "America/Chicago" }).format(d);

/**
 * THE DM L10 TAB: the Leadership Hub's meeting page, on the Hub's own meeting record.
 *
 * Who may open it is the Hub's decision, made by its database for the verified signed-in person: the meeting must be
 * on the Hub's partner allowlist (the STC DM L10 only) and the person's Hub account (same email) must hold its role.
 * Anyone else gets "not found", exactly as for a meeting that does not exist, so the page reveals nothing.
 */
export default async function MeetingPage({ params, searchParams }: { params: Promise<{ key: string }>; searchParams: Promise<{ view?: string | string[] }> }) {
  await requireAuthenticatedPage();
  const { key } = await params;
  if (!isMeetingKey(key)) notFound();
  const asked = (await searchParams).view;
  const initialView = asked === "accountability" || asked === "business-plan" ? asked : undefined;

  const opened = await openMeeting(key);
  if (!opened.ok && opened.reason === "forbidden") notFound();
  if (!opened.ok) {
    return (
      <L10Frame meetingKey={key} assistant={false}>
        <Card>
          <p className="m-0 text-sm">
            {opened.reason === "not-configured" ? "The DM L10 is not connected to the Leadership Hub in this environment." : "The meeting could not be loaded just now. Please try again in a minute."}
          </p>
        </Card>
      </L10Frame>
    );
  }
  const m = opened.meeting;
  return (
    <L10Frame meetingKey={key}>
      <MeetingView
        initialView={initialView}
        mentionPeople={m.people}
        info={m.info}
        initial={m.loaded}
        save={saveMeetingAction}
        end={endMeetingAction}
        load={loadMeetingAction}
        viewer={m.viewer}
        roster={m.roster}
        hubMeetingUrl={hubMeetingUrl(key)}
        dateLabel={dateLabel(new Date())}
        serverTime={new Date().getTime()}
        today={businessDate()}
      />
    </L10Frame>
  );
}
