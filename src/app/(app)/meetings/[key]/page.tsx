import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { L10Frame, hubMeetingUrl } from "@/features/l10/L10Frame";
import { endMeetingAction, loadMeetingAction, saveMeetingAction } from "@/features/l10/actions";
import { L10_TAB_LABELS, listRecaps, openMeeting } from "@/features/l10/data.server";
import { loadLeadershipOwnerNames } from "@/features/l10/owners.server";
import { bloomStyle, hasReference, isMeetingKey, isStcSd } from "@/features/l10/lib/config";
import { businessDate } from "@/features/l10/lib/dueStatus";
import { MeetingView } from "@/features/l10/meeting/MeetingView";
import { Card } from "@/features/l10/ui/ui";
import { requireAuthenticatedPage } from "@/lib/auth/page";
import { noteAppUsage } from "@/lib/analytics/app-usage";
import { NotAttendee } from "@/features/l10/NotAttendee";

/** The page title: the tab's name ("DM L10"), or "SD L10" for the three district meetings (the Hub names each). */
const titleFor = (key: string) => L10_TAB_LABELS[key] ?? (isStcSd(key) ? "SD L10" : "L10");

export async function generateMetadata({ params }: { params: Promise<{ key: string }> }): Promise<Metadata> {
  const { key } = await params;
  return { title: titleFor(key) };
}
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
  const identity = await requireAuthenticatedPage();
  const { key } = await params;
  if (!isMeetingKey(key)) notFound();
  const asked = (await searchParams).view;
  const initialView = asked === "accountability" || asked === "business-plan" ? asked : undefined;
  // A meeting without the Reference views (the STC DM L10) refuses a link to one, like a missing page.
  if (initialView && !hasReference(key)) notFound();

  const opened = await openMeeting(key);
  // Only its attendees (and admins) open a meeting; the Hub refused this person (src/features/l10/lib/access.ts).
  if (!opened.ok && opened.reason === "forbidden") return <NotAttendee />;
  if (!opened.ok) {
    return (
      <L10Frame meetingKey={key} assistant={false}>
        <Card>
          <p className="m-0 text-sm">
            {opened.reason === "not-configured" ? `The ${titleFor(key)} is not connected to the Leadership Hub in this environment.` : "The meeting could not be loaded just now. Please try again in a minute."}
          </p>
        </Card>
      </L10Frame>
    );
  }
  const m = opened.meeting;
  // A day of use of this L10 meeting, for Analytics (Pau, 28 Nov 2026): only once the Hub let this attendee in.
  noteAppUsage(identity, "l10", key);
  // A Bloom-style meeting shows "Last meeting's summary". A side load that fails leaves its part empty, and the page says
  // so ("Couldn't load ... refresh to try again") instead of looking like there is nothing (24 Nov 2026).
  const [recaps, owners] = await Promise.all([bloomStyle(key) ? listRecaps(key) : Promise.resolve(null), loadLeadershipOwnerNames()]);
  const loadProblems = [...(recaps && !recaps.ok ? ["the last meeting"] : []), ...(owners.ok ? [] : ["the owner names"])];
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
        recaps={recaps?.ok ? recaps.recaps : []}
        ownerPeople={owners.names}
        loadProblems={loadProblems}
      />
    </L10Frame>
  );
}
