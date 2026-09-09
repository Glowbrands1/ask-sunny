import type { Metadata } from "next";

import {
  OverviewScreen,
  type OverviewDailyStats,
  type OverviewFollowUp,
  type OverviewFollowUps,
} from "@/features/dashboard/overview";
import { businessToday } from "@/lib/business-date";
import { isDemoMode } from "@/lib/config/runtime";
import { attentionSummary, followUpState } from "@/lib/forms/follow-up";
import { listOutstandingFollowUps } from "@/lib/forms/instances";
import { requirePagePermission } from "@/lib/auth/page";
import { listSalesTotalsDates } from "@/lib/reporting/read/sales-totals-read";

export const metadata: Metadata = {
  title: "Overview",
};

/**
 * THE HOME PAGE READS THE FORMS DATABASE.
 *
 * It used to be a purely client-rendered screen whose follow-up card derived
 * everything from a browser-side demo store. That store is not the system of
 * record, so the Overview and Form Monitoring could — and did — state different
 * numbers about the same salon. Fetching here, on the server, through the same
 * module Form Monitoring uses, is what makes them one answer.
 *
 * `force-dynamic` IS THE "LIVE" MECHANISM, and deliberately the whole of it.
 * Every navigation to this page and every `router.refresh()` after a write
 * re-reads Supabase, so marking a follow-up done on Form Monitoring and
 * clicking Overview shows the new count. No Supabase Realtime subscription is
 * used: this app has none anywhere, a socket would be a new failure mode on the
 * app's landing page, and nothing here needs to change while nobody is looking
 * at it.
 *
 * A FAILED READ MUST NOT TAKE THE HOME PAGE DOWN. Everything else on this
 * screen still works without the Forms database, so a failure becomes an empty
 * card with a sentence rather than an error boundary.
 */
export const dynamic = "force-dynamic";

export default async function OverviewPage() {
  await requirePagePermission("view_overview");

  const today = businessToday();
  let followUps: OverviewFollowUps = {
    attention: { overdue: 0, dueThisWeek: 0, needsAttention: 0 },
    items: [],
    today,
    failure: null,
  };

  try {
    const outstanding = await listOutstandingFollowUps();
    const items: OverviewFollowUp[] = outstanding.map((instance) => ({
      id: instance.id,
      employeeName: instance.employeeName,
      templateName: instance.templateName,
      locationName: instance.locationName,
      // `listOutstandingFollowUps` selects on `follow_up_date is not null`, so
      // this is never null in practice; the fallback keeps the type honest
      // rather than asserting.
      followUpDate: instance.followUpDate ?? today,
      overdue: followUpState(instance, today) === "overdue",
    }));

    followUps = {
      attention: attentionSummary(outstanding, today),
      items,
      today,
      failure: null,
    };
  } catch (error) {
    followUps = { ...followUps, failure: (error as Error).message };
  }

  /*
   * THE NEWEST SALES TOTALS DELIVERY, AS METADATA ONLY.
   *
   * The Daily Stats card used to render `DAILY_STATS_METRICS` — four seeded
   * figures — in every mode, under a note admitting they were seeded. On a live
   * deployment with real deliveries ingested that is a fabricated operational
   * number on the landing page, which is the same class of problem as a stale
   * figure reading as current.
   *
   * SO THE SERVER READS THE DATE AND NOT THE FIGURES. One cheap listing, no
   * measure, no aggregation, no second implementation of a total: the card
   * states which delivery is newest and sends the manager to Reporting, where
   * the dashboard's own analytics produce every figure. Wiring real measures
   * into this card is a separate decision, because the four the card asked for
   * — guests served, membership conversion, average ticket, upgrades — are not
   * measures any ingested report carries.
   *
   * DEMO MODE DOES NOT READ AT ALL. There is no Supabase to read, and the card
   * keeps its seeded figures and its note, which are honest there.
   */
  let dailyStats: OverviewDailyStats = { reportDate: null, label: null, failure: null };
  if (!isDemoMode()) {
    try {
      const dates = await listSalesTotalsDates();
      const newest = dates[0] ?? null;
      dailyStats = {
        reportDate: newest?.reportDate ?? null,
        label: newest?.label ?? null,
        failure: null,
      };
    } catch (error) {
      // Same posture as the follow-up read above: the home page still renders.
      dailyStats = { reportDate: null, label: null, failure: (error as Error).message };
    }
  }

  return <OverviewScreen followUps={followUps} dailyStats={dailyStats} />;
}
