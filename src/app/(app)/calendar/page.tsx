import type { Metadata } from "next";

import { PageHeader } from "@/components/ui/layout";
import { Notice } from "@/components/ui/feedback";
import { CalendarView } from "@/features/calendar/calendar-view";
import { requirePagePermission } from "@/lib/auth/page";
import { loadCalendarFor } from "@/lib/calendar/load.server";
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
  const result = identity ? await loadCalendarFor(identity, { from, to }, { origin: "", includeHub: true }) : null;
  return (
    <>
      <PageHeader title="Calendar" description="Your follow-ups, HR approvals, Google Reviews checks, reminders and L10 meetings. Times are Central." />
      {result?.ok ? (
        <CalendarView key={month} view={result.view} month={month} today={today} />
      ) : (
        <Notice tone="attention">Your calendar could not be loaded. Sign in again, or try again in a minute.</Notice>
      )}
    </>
  );
}
