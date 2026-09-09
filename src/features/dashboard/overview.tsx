"use client";

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  ArrowUpRight,
  FileClock,
  FilePlus2,
  MessageCircle,
  PlayCircle,
  Sparkles,
  Star,
  Upload,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DemoDataNote } from "@/components/ui/feedback";
import { isDemoMode } from "@/lib/config/runtime";
import { PageShell, SectionHeader } from "@/components/ui/layout";
import { AskBand } from "./ask-band";
import { OverviewStrip } from "./overview-strip";
import { ReviewsBar } from "./reviews-bar";
import {
  AlarmBar,
  BareList,
  BareRow,
  CountTiles,
  Provenance,
  SectionRule,
} from "@/components/ui/marquee";
import { DEMO_RECENT_ACTIVITY } from "@/data/demo/dashboard";
import { DEMO_REVIEW_METRICS } from "@/data/demo/reviews";
import type { AttentionSummary } from "@/lib/forms/follow-up";
import { relativeBusinessDay } from "@/lib/forms/follow-up";
import { useSession } from "@/lib/session/session-context";
import { useAppStore } from "@/lib/store/app-store";
import { cn } from "@/lib/utils/cn";
import {
  formatDate,
  relativeTime,
} from "@/lib/utils/date";
import { formatDuration, formatNumber, pluralize } from "@/lib/utils/format";


const ACTIVITY_ICONS: Record<string, LucideIcon> = {
  question: MessageCircle,
  form: FilePlus2,
  upload: Upload,
  video: PlayCircle,
  review: Star,
};

/**
 * ONE OUTSTANDING FOLLOW-UP, as the Overview needs it.
 *
 * Deliberately a flat, small shape rather than a whole form instance: the card
 * shows a name, a form, a salon and how late it is, and passing the entire
 * record would invite the next screen to grow its own opinions about what a
 * follow-up means.
 */
export interface OverviewFollowUp {
  id: string;
  employeeName: string;
  templateName: string;
  locationName: string | null;
  followUpDate: string;
  overdue: boolean;
}

/**
 * WHAT THE FOLLOW-UPS CARD IS GIVEN, AND WHY IT IS GIVEN ANYTHING AT ALL.
 *
 * This card used to derive follow-ups from `useAppStore().forms` — a
 * client-side demo collection, seeded in the browser, carrying its own
 * `overdue` / `due_soon` statuses. That was the desync: Form Monitoring moved
 * to Supabase and the Overview kept reading the store, so the home page and the
 * system of record could state different numbers about the same salon on the
 * same morning.
 *
 * So the Overview now READS THE DATABASE, on the server, through the same
 * module Form Monitoring uses, and hands the result down as props. The store is
 * still the source for unrelated demo areas of this screen (documents, videos)
 * — this checkpoint replaces the follow-up portion only.
 */
export interface OverviewFollowUps {
  attention: AttentionSummary;
  /** Soonest first. Already excludes archived, untracked and completed forms. */
  items: OverviewFollowUp[];
  /** Today's business date, resolved on the server. */
  today: string;
  /** Set when the read failed — the home page still renders. */
  failure: string | null;
}

export function OverviewScreen({
  followUps: followUpData,
  performanceOverview,
  performanceStrip,
}: {
  followUps: OverviewFollowUps;
  /**
   * The Performance Overview card, rendered on the SERVER and passed in.
   *
   * This screen is a client component and the reporting read layer is
   * `server-only`, so the figures cannot be fetched from here. The page renders
   * the card and hands it over as a node — one data path, shared with Reports &
   * Analytics, and no homepage-only endpoint to keep in step with it.
   */
  performanceOverview: ReactNode;
  /**
   * The same snapshot as the collapsed strip's figures, also server-rendered.
   *
   * Two nodes rather than one shared component because the two presentations
   * differ — the panel gives each figure its period on a line of its own, the
   * strip puts it on a tooltip — but they read through one `cache`d call, so
   * they cannot state different numbers on the same screen.
   */
  performanceStrip: ReactNode;
}) {
  const { role, can } = useSession();

  /*
   * SEEDED CONTENT IS DEMO-MODE CONTENT. `isDemoMode()` reads
   * NEXT_PUBLIC_DEMO_MODE, which is inlined into this bundle, so the client can
   * decide without a round trip and without a prop that could disagree with the
   * server. Used below to keep an invented activity feed off a live deployment.
   */
  const live = !isDemoMode();
  const { documents, videos } = useAppStore();

  /*
   * No derivation here any more, and that is the point: the server already
   * decided what is outstanding and what needs attention, using the persisted
   * follow-up fields and the business date. A second calculation in the browser
   * is exactly how the two screens came to disagree.
   */
  const { attention, items: followUps, today: businessDay } = followUpData;

  /*
   * Whether an inline answer is open. The band owns the conversation; the page
   * only needs to know that it should stand down to a strip.
   */
  const [askActive, setAskActive] = useState(false);

  /*
   * The alarm's second line, built from the same counts the card below it
   * shows. Only the parts that are non-zero are named, so it never reads
   * "0 overdue".
   */
  const alarmDetail = [
    attention.overdue > 0 ? `${attention.overdue} overdue` : null,
    attention.dueThisWeek > 0 ? `${attention.dueThisWeek} due this week` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const reviewTotals = useMemo(() => {
    const gained = DEMO_REVIEW_METRICS.reduce(
      (sum, metric) => sum + metric.reviewsGainedThisWeek,
      0,
    );
    const lastWeek = DEMO_REVIEW_METRICS.reduce(
      (sum, metric) => sum + metric.reviewsGainedLastWeek,
      0,
    );
    const goal = DEMO_REVIEW_METRICS.reduce(
      (sum, metric) => sum + metric.weeklyGoal,
      0,
    );
    const rating =
      DEMO_REVIEW_METRICS.reduce((sum, metric) => sum + metric.averageRating, 0) /
      DEMO_REVIEW_METRICS.length;
    return { gained, lastWeek, goal, rating };
  }, []);

  const latestDocuments = useMemo(
    () =>
      [...documents]
        .sort(
          (a, b) =>
            new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime(),
        )
        .slice(0, 4),
    [documents],
  );

  const recommendedVideos = useMemo(
    () => videos.filter((video) => ["vid-04", "vid-07", "vid-10"].includes(video.id)),
    [videos],
  );

  return (
    <>
      {/*
        THE BAND. Ask Sunny is no longer a card in the middle of the page — it
        is the lit surface across the top with a real input, and the greeting
        lives inside it. Full-bleed, so it reads as a surface with area rather
        than as another panel on the canvas.
      */}
      <AskBand onActiveChange={setAskActive} />

      {/*
        THE OVERVIEW COLLAPSES BEHIND AN ANSWER. One strip keeps the figures and
        the overdue badge on screen instead of the whole dashboard being pushed
        away, which is what makes an inline answer feel like the wrong page.
      */}
      {askActive ? (
        <OverviewStrip
          figures={performanceStrip}
          alert={
            attention.needsAttention > 0
              ? `${attention.needsAttention} ${pluralize(attention.needsAttention, "follow-up")} ${attention.needsAttention === 1 ? "needs" : "need"} attention`
              : undefined
          }
          onExpand={() => setAskActive(false)}
        />
      ) : null}

      <PageShell className={cn(askActive && "hidden")}>
      {/* ============================ PERFORMANCE ============================ */}
      <SectionRule
        label="Performance"
        action={{ label: "Open Reports & Analytics", href: "/reports" }}
        className="mb-4"
      />
      {/*
        RENDERED ON THE SERVER AND HANDED IN. This was a seeded four-figure grid
        under the heading "Daily Stats · yesterday" — 486 guests, 24.6%
        conversion, all invented. The reporting read layer is `server-only`, so
        the page renders the real card and passes it as a node: one data path,
        shared with Reports & Analytics.

        The LOOK is unchanged — the card itself now draws the hairline panel
        with the display figures, each naming its own period, over a provenance
        line. Only the numbers became real.
      */}
      {can("view_daily_stats") ? performanceOverview : null}

      {/* ============================ FOLLOW-UPS ============================= */}
      <SectionRule
        label="Follow-ups"
        action={{ label: "Open Form Monitoring", href: "/forms/monitoring" }}
        className="mt-9 mb-4"
      />

      {/*
        THE ALARM BAR HEADS THE FORMS BLOCK, so the alert is attached to the
        thing it refers to. It renders ONLY when something actually needs a
        person — a permanent bar saying nothing is wrong teaches a reader to
        ignore the colour.
      */}
      {attention.needsAttention > 0 ? (
        <AlarmBar
          className="mb-5"
          title={`${attention.needsAttention} ${pluralize(attention.needsAttention, "follow-up")} ${attention.needsAttention === 1 ? "needs" : "need"} attention`}
          detail={alarmDetail}
          action={{ label: "Open form monitoring", href: "/forms/monitoring" }}
        />
      ) : null}

      {/*
        Follow-ups leads and the counters sit beside it, at the direction's
        ratio — the list is what a manager acts on, the counters are the same
        number broken out.
      */}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1.45fr_1fr]">
        {/* Follow-ups — live, from the Forms database */}
        <Card>
          <CardHeader className="flex items-start justify-between gap-3">
            <div>
              <span className="flex items-center gap-2.5">
                <CardTitle>Follow-ups</CardTitle>
                {/*
                  THE COUNT IS A CARD TAG, not a repeat of the alert.
                  The alarm bar directly above already states "N follow-ups need
                  attention" — saying it twice in twelve pixels is how a warning
                  stops being read. So the card carries the outstanding total
                  the way the direction tags a card, and the sentence lives in
                  one place.
                */}
                {!followUpData.failure && followUps.length > 0 ? (
                  <span className="rounded-[4px] bg-brand-yellow px-2 py-[3px] text-[8.5px] font-black tracking-[0.08em] text-brand-yellow-foreground uppercase">
                    {formatNumber(followUps.length)} open
                  </span>
                ) : null}
              </span>
              {/*
                Every number here is counted on the server from persisted form
                instances — see OverviewFollowUps. The follow-up colour appears
                ONLY when something actually needs a person: a permanent pink
                badge saying "nothing needs attention" teaches a reader to
                ignore the colour.
              */}
              <p
                className={cn(
                  "mt-1 text-[13px]",
                  attention.needsAttention > 0
                    ? "font-medium text-followup-attention-soft-foreground"
                    : "text-muted-foreground",
                )}
              >
                {followUpData.failure
                  ? "Follow-ups could not be read"
                  : attention.needsAttention > 0
                    ? "Soonest first"
                    : "Nothing needs attention today"}
              </p>
              {attention.needsAttention > 0 ? (
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {/*
                    The two halves are links, so the number somebody is worried
                    about takes them to exactly that filter rather than to a
                    list they then have to narrow themselves.
                  */}
                  {attention.overdue > 0 ? (
                    <Link
                      href="/forms/monitoring?followup=overdue"
                      className="font-medium text-followup-attention underline-offset-4 hover:underline"
                    >
                      {attention.overdue} overdue
                    </Link>
                  ) : null}
                  {attention.overdue > 0 && attention.dueThisWeek > 0 ? " · " : null}
                  {attention.dueThisWeek > 0 ? (
                    <Link
                      href="/forms/monitoring?followup=open"
                      className="underline-offset-4 hover:text-foreground hover:underline"
                    >
                      {attention.dueThisWeek} due this week
                    </Link>
                  ) : null}
                </p>
              ) : null}
            </div>
            <span
              className={cn(
                "flex size-8 items-center justify-center rounded-[var(--radius-sm)]",
                attention.needsAttention > 0
                  ? "bg-followup-attention-soft text-followup-attention-soft-foreground"
                  : "bg-surface-muted text-muted-foreground",
              )}
            >
              <FileClock className="size-4" aria-hidden />
            </span>
          </CardHeader>
          <CardContent className="pt-0">
            {followUps.length === 0 ? (
              <p className="rounded-[var(--radius-sm)] border border-dashed border-border px-3 py-6 text-center text-[13px] text-muted-foreground">
                {followUpData.failure
                  ? "Ask Sunny could not reach the Forms record."
                  : "No follow-ups are being tracked."}
              </p>
            ) : (
              <ul className="space-y-2.5">
                {followUps.slice(0, 3).map((entry) => (
                  <li key={entry.id}>
                    <Link
                      href={`/forms/monitoring?followup=${entry.overdue ? "overdue" : "open"}`}
                      className="flex items-center gap-3 rounded-[var(--radius-sm)] border border-border px-3 py-2.5 transition-colors hover:bg-surface-muted"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-medium text-foreground">
                          {entry.employeeName}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {entry.templateName}
                          {entry.locationName ? ` · ${entry.locationName}` : ""}
                        </span>
                      </span>
                      {/*
                        Overdue takes the follow-up pink at full strength; a
                        follow-up that is merely coming up stays neutral, so the
                        late ones are the ones that catch the eye.
                      */}
                      <Badge tone={entry.overdue ? "followupStrong" : "neutral"} size="sm">
                        {relativeBusinessDay(entry.followUpDate, businessDay)}
                      </Badge>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            <Button asChild variant="ghost" size="sm" className="mt-3 w-full">
              <Link href="/forms/monitoring">
                View all follow-ups
                <ArrowUpRight />
              </Link>
            </Button>
          </CardContent>
        </Card>

        {/* Forms awaiting follow-up */}
        <Card>
          <CardHeader className="flex items-start justify-between gap-3">
            <div>
              <CardTitle>Forms awaiting follow-up</CardTitle>
              <p className="mt-1 text-[13px] text-muted-foreground">
                Across every salon you cover
              </p>
            </div>
            <span className="flex size-8 items-center justify-center rounded-[var(--radius-sm)] bg-surface-muted text-muted-foreground">
              <FileClock className="size-4" aria-hidden />
            </span>
          </CardHeader>
          <CardContent className="pt-0">
            {/*
              * THE SAME LIVE NUMBERS, counted once on the server.
              *
              * These three tiles were the other half of the desync: they read
              * `forms.filter(status === "overdue")` from the demo store, so the
              * home page could report a different pipeline than Form
              * Monitoring. They now come from `attention` and the outstanding
              * list — the same values the card above uses, so the two cards
              * cannot disagree with each other either.
              *
              * Overdue and Open partition the outstanding work; "Due this week"
              * is the subset of Open that lands before the weekend, so it is
              * shown between them rather than added to them.
              */}
            {/*
              THE COUNTERS TAKE THE DIRECTION'S TONES: coral for overdue,
              yellow for due-this-week, warm neutral for merely open — the same
              escalation the pills use in Form Monitoring, so a manager learns
              the three states once.

              The overdue tile only carries coral when it is NON-ZERO; a coral
              tile reading 0 would be the permanent alarm the palette forbids.
            */}
            <CountTiles
              tiles={[
                {
                  label: "Overdue",
                  value: formatNumber(attention.overdue),
                  tone: attention.overdue > 0 ? "overdue" : "open",
                },
                {
                  label: "Due this week",
                  value: formatNumber(attention.dueThisWeek),
                  tone: attention.dueThisWeek > 0 ? "soon" : "open",
                },
                {
                  label: "Open",
                  value: formatNumber(followUps.length - attention.overdue),
                  tone: "open",
                },
              ]}
            />
            <Button asChild variant="ghost" size="sm" className="mt-3 w-full">
              <Link href="/forms/monitoring">
                Open Form Monitoring
                <ArrowUpRight />
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* ============================= THIS WEEK ============================= */}
      {can("view_google_reviews") ? (
        <>
          <SectionRule
            label="This week"
            action={{ label: "Open Google Reviews", href: "/reviews" }}
            className="mt-9 mb-4"
          />
          <ReviewsBar
            gained={reviewTotals.gained}
            goal={reviewTotals.goal}
            vsLastWeek={reviewTotals.gained - reviewTotals.lastWeek}
            averageRating={reviewTotals.rating}
            salonCount={DEMO_REVIEW_METRICS.length}
          />
          {/*
            SHOWN, AND HONEST ABOUT NOT BEING CONNECTED YET. Every figure here
            comes from `DEMO_REVIEW_METRICS`; with no note the block read as a
            real scorecard, and hiding it was the previous answer. Saying so on
            the face of it is the better one — and the note names the missing
            integration rather than using the generic demo footnote, so it stays
            true on a live deployment too.
          */}
          <Provenance className="mt-2.5">
            Google Business Profile is not connected yet · these figures are a
            placeholder for the shape of the block, not review counts
          </Provenance>
        </>
      ) : null}

      {/* ============================= REFERENCE ============================= */}
      <SectionRule label="Reference" className="mt-9 mb-4" />

      {/*
        REFERENCE IS NOT CARDS. These are link lists, and a box around a link
        list adds an edge and removes hierarchy — so they sit as bare lists
        under one rule, which is also what keeps them the quietest thing on the
        page.
      */}
      <div className="grid grid-cols-1 gap-x-6 gap-y-7 lg:grid-cols-3">
        <BareList
          label="Latest knowledge updates"
          action={{ label: "Open knowledge base", href: "/knowledge" }}
        >
          {latestDocuments.map((document) => (
            <BareRow
              key={document.id}
              href={`/knowledge?document=${document.id}`}
              meta={formatDate(document.uploadedAt)}
            >
              {document.title}
              {document.version > 1 ? (
                <span className="ml-2 text-[10.5px] text-muted-foreground">
                  v{document.version}
                </span>
              ) : null}
            </BareRow>
          ))}
        </BareList>

        {/*
          Recommended training was a card holding three video rows. It is a link
          list like the two beside it, and the direction's argument applies
          unchanged: a box around a link list adds an edge and removes
          hierarchy. Same rule, a module the artifact did not draw.
        */}
        <BareList
          label="Recommended training"
          action={{ label: "Browse the library", href: "/videos" }}
        >
          {recommendedVideos.map((video) => (
            <BareRow
              key={video.id}
              href={`/videos?video=${video.id}`}
              meta={formatDuration(video.durationSeconds)}
            >
              {video.title}
            </BareRow>
          ))}
        </BareList>

        <BareList
          label="Manager resources"
          action={{ label: "Open manager resources", href: "/resources" }}
        >
          <div className="mt-1 flex flex-wrap gap-2">
            {["L10 Meetings", "Power BI", "Woven", "Company Policies", "HR Resources"].map(
              (name) => (
                <span
                  key={name}
                  className="rounded-full border border-border bg-surface px-3 py-1.5 text-[11px] font-bold text-foreground"
                >
                  {name}
                </span>
              ),
            )}
          </div>
        </BareList>
      </div>

      {/*
        RECENT ACTIVITY IS SEEDED IN ITS ENTIRETY — the summaries, the actors,
        the timestamps — and there is no activity log behind it. In live mode it
        attributed invented actions to named people, which is the one kind of
        fabrication on this page that could start a conversation with an
        employee.

        HIDDEN RATHER THAN EMPTIED. "No recent activity" would be its own
        falsehood: there is activity, it is simply not recorded anywhere yet.
      */}
      {live ? null : (
      <section className="mt-9">
        <SectionHeader
          title="Recent Ask Sunny activity"
          description={`What the team has been doing in ${role === "salon_director" ? "your salon" : "your area"}.`}
        />
        <Card>
          <CardContent className="p-2">
            <ul className="divide-y divide-border">
              {DEMO_RECENT_ACTIVITY.map((entry) => {
                const Icon = ACTIVITY_ICONS[entry.kind] ?? Sparkles;
                return (
                  <li key={entry.id} className="flex items-center gap-3 px-3 py-3">
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-[var(--radius-xs)] bg-surface-muted text-muted-foreground">
                      <Icon className="size-3.5" aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1 text-[13px] text-foreground">
                      {entry.summary}
                    </span>
                    <span className="hidden shrink-0 text-xs text-muted-foreground sm:block">
                      {entry.actor}
                    </span>
                    <span className="shrink-0 text-xs text-subtle-foreground">
                      {relativeTime(entry.at)}
                    </span>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
        <DemoDataNote className="mt-3" />
      </section>
      )}
      </PageShell>
    </>
  );
}
