import { Suspense } from "react";
import type { Metadata } from "next";

import {
  OverviewScreen,
  type OverviewFollowUp,
  type OverviewFollowUps,
} from "@/features/dashboard/overview";
import {
  PerformanceOverview,
  PerformanceOverviewSkeleton,
  PerformanceStrip,
  PerformanceStripSkeleton,
} from "@/features/dashboard/performance-overview";
import {
  ReviewsBlock,
  ReviewsBlockSkeleton,
} from "@/features/dashboard/reviews-block";
import { businessToday } from "@/lib/business-date";
import { followUpState } from "@/lib/forms/follow-up";
import { readFollowUpQueue } from "@/lib/forms/follow-up-queue";
import { pageFormsAccess } from "@/lib/forms/page-scope";
import { pageCan, requirePagePermission } from "@/lib/auth/page";
import { asdNoFormMonitoringEnabled } from "@/lib/permissions";
import {
  scopeAreaLabel,
} from "@/lib/reporting/scope/authorized-salons";
import { HrOverviewCard } from "@/features/forms/hr-approval-lists";
import { hrQueueSummary } from "@/lib/forms/hr-approval";

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
  const identity = await requirePagePermission("view_overview");

  /*
   * WHETHER THE GOOGLE REVIEWS BLOCK IS READ AT ALL, DECIDED ON THE SERVER.
   *
   * The screen already gates the section on the browser's own role, which is
   * what keeps a heading from standing over nothing. This is the other half:
   * an account that may not see Google Reviews does not cause the estate's
   * review counts to be read in the first place.
   */
  const canViewReviews = await pageCan("view_google_reviews");

  const today = businessToday();
  let followUps: OverviewFollowUps = {
    attention: { overdue: 0, dueThisWeek: 0, needsAttention: 0 },
    items: [],
    today,
    failure: null,
    excluded: 0,
    scopeLabel: null,
  };

  try {
    /*
     * THE QUEUE IS NARROWED TO THE READER'S OWN SALONS, IN THE QUERY.
     *
     * The review found a restricted account shown "the same 11 overdue records
     * labelled 'Across every salon you cover'" — the whole estate's work under
     * a heading claiming it was theirs.
     */
    /*
      THE SAME AUTHORITY THE REPORTS USE. `resolveScopeFor` asks reporting for a
      district or region's membership rather than the checked-in roster, so the
      Overview's queue cannot disagree with a report page about which salons a
      person covers. See `scope/server.ts`.
    */
    // ASD_NO_FORM_MONITORING: a reader without Form Monitoring is handed no follow-ups (the Overview draws none).
    if (asdNoFormMonitoringEnabled() && !(await pageCan("view_form_monitoring"))) throw new NoFormMonitoring();
    const access = await pageFormsAccess(identity);
    const locationIds = access.locationIds;
    // Exit forms only for readers who may create them — see `withoutUnreadable`.
    const readsExit = await pageCan("create_exit_form");
    /*
     * THE ONE QUEUE (QA, 24 Nov 2026: the Overview, the rail and the banner said 19 overdue, Form Monitoring's
     * Overdue pill 8). `readFollowUpQueue` is what all of them count: every outstanding follow-up this reader may
     * open, read without a cap, with NON-PRODUCTION RECORDS HELD BACK, NOT DELETED. The review found "Jordan Vance
     * (test)", "suzy sunshine", "Ace Test" and a salon called Maple Crossing in this queue; they are still in Form
     * Monitoring, where an administrator can review and archive them. See `lib/forms/production-records.ts`.
     */
    const queue = await readFollowUpQueue(access, { readsExit, today });
    const production = queue.forms;

    const items: OverviewFollowUp[] = production.map((instance) => ({
      id: instance.id,
      employeeName: instance.employeeName,
      templateName: instance.templateName,
      locationName: instance.locationName,
      // The queue selects on `follow_up_date is not null`, so
      // this is never null in practice; the fallback keeps the type honest
      // rather than asserting.
      followUpDate: instance.followUpDate ?? today,
      overdue: followUpState(instance, today) === "overdue",
    }));

    followUps = {
      /*
       * COUNTED OVER THE SAME ROWS THE LIST SHOWS. Summarising `outstanding`
       * while listing `production` is precisely how a card comes to state a
       * total its own list does not add up to.
       */
      attention: queue.attention,
      items,
      today,
      failure: null,
      excluded: queue.excluded,
      scopeLabel:
        locationIds === null
          ? null
          : scopeAreaLabel({ level: "salon", primaryAreaId: locationIds.length === 1 ? locationIds[0]! : null, alsoCoversAreaIds: [] }),
    };
  } catch (error) {
    if (!(error instanceof NoFormMonitoring)) followUps = { ...followUps, failure: (error as Error).message };
  }

  /*
   * THE PERFORMANCE OVERVIEW CARD, RENDERED HERE AND PASSED DOWN.
   *
   * This replaces the Daily Stats read that used to sit at this point. That
   * read deliberately fetched only the newest delivery's DATE, because — as its
   * comment said — the four figures the seeded card asked for are not measures
   * any ingested report carries, and choosing real ones was left as a separate
   * decision. This is that decision, made: the card now shows four measures the
   * reports do carry, each under its own period, read through the same
   * functions the report pages call.
   *
   * NOT AWAITED HERE. It is its own async server component behind `<Suspense>`,
   * so a slow reporting query cannot hold up the follow-up card or the rest of
   * the page — the shell streams first and the figures arrive behind a skeleton
   * that holds the card's dimensions.
   */
  /* HR APPROVAL: the approver's count of forms waiting for them, overdue marked. Nobody else gets the card. */
  const hrSummary = await hrQueueSummary((await pageFormsAccess(identity)).actor).catch(() => null);

  return (
    <OverviewScreen
      followUps={followUps}
      hrApprovalCard={hrSummary ? <HrOverviewCard pending={hrSummary.pending} overdue={hrSummary.overdue} /> : undefined}
      performanceOverview={
        <Suspense fallback={<PerformanceOverviewSkeleton />}>
          <PerformanceOverview />
        </Suspense>
      }
      /*
       * THE SAME SNAPSHOT AGAIN, FOR THE COLLAPSED STRIP. Rendered here rather
       * than derived in the client screen for the reason above — the read layer
       * is `server-only` — and reading through the same `cache`d call as the
       * card, so the strip and the panel cannot state different revenue on one
       * screen. Its own `<Suspense>` so neither waits on the other's boundary.
       */
      performanceStrip={
        <Suspense fallback={<PerformanceStripSkeleton />}>
          <PerformanceStrip />
        </Suspense>
      }
      /*
       * THE GOOGLE REVIEWS WEEK, ON THE SAME PATTERN AND FOR THE SAME REASON.
       *
       * `lib/reviews/queries.ts` is `server-only` — a client component
       * importing it is a build failure — so the block is rendered here and
       * handed down. Its own `<Suspense>`, so the review read and the reporting
       * read stream independently and neither waits on the other's boundary.
       *
       * ONE READ, THE TAB'S OWN. `loadReviewsOverviewBlock` calls
       * `loadRatingDistribution` and `countReviewLocations`, which are the
       * functions the Google Reviews page itself calls for its rating card and
       * its salons chip; the Overview adds no query and no second arithmetic.
       */
      googleReviews={
        canViewReviews ? (
          <Suspense fallback={<ReviewsBlockSkeleton />}>
            <ReviewsBlock />
          </Suspense>
        ) : null
      }
    />
  );
}

/** The reader holds no Form Monitoring: the follow-ups stay empty, without a failure. */
class NoFormMonitoring extends Error {}
