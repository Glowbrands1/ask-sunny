import type { Metadata } from "next";

import { PageHeader } from "@/components/ui/layout";
import { Notice } from "@/components/ui/feedback";
import { CalendarView } from "@/features/calendar/calendar-view";
import { requirePagePermission } from "@/lib/auth/page";
import { meetingDetailsFromHub } from "@/lib/calendar/hub";
import { loadCalendarFor } from "@/lib/calendar/load.server";
import { leadershipHubUrl } from "@/lib/config/app-switcher";
import { centralToday, isMonth, monthGrid, monthOf } from "@/lib/calendar/range";

export const metadata: Metadata = { title: "Calendar" };
export const dynamic = "force-dynamic";

/**
 * THE CALENDAR (Pau, 26 Nov 2026): this person's form follow-ups, HR approvals, weekly Google Reviews checks and
 * reminders from this app, plus their L10 meetings from the Leadership Hub, a month at a time (?month=YYYY-MM).
 * Gated like the Overview (`view_overview`): managers, DMs, RMs and admins. Each source is read as this person, with
 * the same scope as its own page. Never time off.
 */
export default async function CalendarPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const identity = await requirePagePermission("view_overview");
  const sp = await searchParams;
  const today = centralToday();
  const month = isMonth(sp.month) ? sp.month : monthOf(today);
  const { from, to } = monthGrid(month);
  const [result, details] = identity
    ? await Promise.all([loadCalendarFor(identity, { from, to }, { origin: "", includeHub: true, includeHolidays: true }), meetingDetailsFromHub(identity.email)])
    : [null, null];
  // The meeting panel and "No day set" need the Hub's details; without them, meetings still show and open the L10.
  const meetings = details?.state === "ok" ? details.meetings : [];
  const hub = leadershipHubUrl();
  return (
    <>
      <PageHeader title="Calendar" description="Your follow-ups, HR approvals, Google Reviews checks, reminders and L10 meetings. Times are Central." />
      {result?.ok ? (
        <CalendarView
          key={month}
          view={result.view}
          month={month}
          today={today}
          meetings={meetings}
          hubUrl={hub}
          // Every meeting the Hub lists for this person is one they attend or, as an admin, may open: they may change its
          // time (the owner, 27 Nov 2026). The Hub checks it again on save.
          canEditSchedules={Boolean(identity?.verified)}
        />
      ) : (
        <Notice tone="attention">Your calendar could not be loaded. Sign in again, or try again in a minute.</Notice>
      )}
    </>
  );
}
