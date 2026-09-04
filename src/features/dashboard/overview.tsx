"use client";

import { useMemo } from "react";
import Link from "next/link";
import {
  ArrowUpRight,
  BookOpen,
  CalendarCheck,
  ExternalLink,
  FileClock,
  FilePlus2,
  LineChart,
  MessageCircle,
  PlayCircle,
  Sparkles,
  Star,
  Upload,
  Wrench,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { SunMark } from "@/components/brand-mark";
import { VideoSuggestionCard } from "@/components/video-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/controls";
import { DemoDataNote } from "@/components/ui/feedback";
import { PageShell, SectionHeader } from "@/components/ui/layout";
import { DesktopSearchLauncher } from "@/components/shell/app-shell";
import { DEMO_RECENT_ACTIVITY, DASHBOARD_QUICK_ACTIONS } from "@/data/demo/dashboard";
import { KNOWLEDGE_CATEGORY_LABEL } from "@/data/demo/knowledge";
import { DEMO_REVIEW_METRICS } from "@/data/demo/reviews";
import { DAILY_STATS_METRICS } from "@/data/demo/reports";
import type { AttentionSummary } from "@/lib/forms/follow-up";
import { relativeBusinessDay } from "@/lib/forms/follow-up";
import { useSession } from "@/lib/session/session-context";
import { useAppStore } from "@/lib/store/app-store";
import { cn } from "@/lib/utils/cn";
import {
  demoNow,
  formatDate,
  greetingForHour,
  relativeTime,
} from "@/lib/utils/date";
import { formatNumber, pluralize } from "@/lib/utils/format";

const QUICK_ACTION_ICONS: Record<string, LucideIcon> = {
  "message-circle": MessageCircle,
  "file-plus": FilePlus2,
  "line-chart": LineChart,
  upload: Upload,
  "play-circle": PlayCircle,
  "calendar-check": CalendarCheck,
};

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

export function OverviewScreen({ followUps: followUpData }: { followUps: OverviewFollowUps }) {
  const { user, role, can, primaryLocationName } = useSession();
  const { documents, videos } = useAppStore();

  // Salon accounts are shared by the salon team, so greet the team rather than
  // addressing the salon itself as a person.
  const greetingName = user.isSalonAccount
    ? `${user.name} team`
    : (user.name.split(" ")[0] ?? user.name);

  const greeting = greetingForHour(demoNow().getUTCHours());

  /*
   * No derivation here any more, and that is the point: the server already
   * decided what is outstanding and what needs attention, using the persisted
   * follow-up fields and the business date. A second calculation in the browser
   * is exactly how the two screens came to disagree.
   */
  const { attention, items: followUps, today: businessDay } = followUpData;

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
    <PageShell>
      {/* Header */}
      <header className="flex flex-col gap-5 pb-7 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <p className="eyebrow mb-2">{primaryLocationName}</p>
          <h1 className="text-[28px] leading-tight font-semibold text-foreground sm:text-[32px]">
            {greeting}, {greetingName}
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            Everything you need to run your salon, coach your team, and stay on
            top of performance.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <DesktopSearchLauncher />
          <Button asChild>
            <Link href="/chat">
              <Sparkles />
              Ask Sunny
            </Link>
          </Button>
        </div>
      </header>

      {/* Quick actions */}
      <section aria-label="Quick actions" className="mb-8">
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-6">
          {DASHBOARD_QUICK_ACTIONS.map((action) => {
            const Icon = QUICK_ACTION_ICONS[action.iconKey] ?? Sparkles;
            const content = (
              <>
                <span className="flex size-8 items-center justify-center rounded-[var(--radius-sm)] bg-primary-soft text-primary-soft-foreground">
                  <Icon className="size-4" aria-hidden />
                </span>
                <span className="text-[13px] leading-snug font-medium text-foreground">
                  {action.label}
                </span>
                {action.external ? (
                  <ExternalLink
                    className="ml-auto size-3 shrink-0 text-subtle-foreground"
                    aria-hidden
                  />
                ) : null}
              </>
            );

            const className =
              "flex h-full items-center gap-2.5 rounded-[var(--radius-md)] border border-border bg-surface p-3 text-left shadow-soft transition-[border-color,box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:border-border-strong hover:shadow-raised";

            return action.external ? (
              <a
                key={action.id}
                href={action.href}
                target="_blank"
                rel="noopener noreferrer"
                className={className}
              >
                {content}
                <span className="sr-only">(opens in a new tab)</span>
              </a>
            ) : (
              <Link key={action.id} href={action.href} className={className}>
                {content}
              </Link>
            );
          })}
        </div>
      </section>

      {/* Primary grid */}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        {/* Ask Sunny */}
        <Card className="xl:col-span-2">
          <CardContent className="flex flex-col gap-5 p-5 sm:flex-row sm:items-center">
            <div className="flex size-12 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-primary-soft">
              <SunMark className="size-6" />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-[17px] font-semibold text-foreground">
                Ask Sunny anything about running your salon
              </h2>
              <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
                Policy, coaching, operations, performance, training — answered
                from your knowledge base, with the source shown every time.
              </p>
              <div className="mt-3.5 flex flex-wrap gap-1.5">
                {[
                  "What should I focus on in today's Daily Stats?",
                  "Help me prepare for a coaching conversation.",
                ].map((prompt) => (
                  <Link
                    key={prompt}
                    href={`/chat?q=${encodeURIComponent(prompt)}`}
                    className="rounded-full border border-border bg-surface-muted px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-border-strong hover:text-foreground"
                  >
                    {prompt}
                  </Link>
                ))}
              </div>
            </div>
            <Button asChild variant="secondary" className="shrink-0">
              <Link href="/chat">
                Open
                <ArrowUpRight />
              </Link>
            </Button>
          </CardContent>
        </Card>

        {/* Follow-ups — live, from the Forms database */}
        <Card>
          <CardHeader className="flex items-start justify-between gap-3">
            <div>
              <CardTitle>Follow-ups</CardTitle>
              {/*
                CURT'S EXPLICIT EXAMPLE: "4 follow-ups need attention · 2
                overdue · 2 due this week". Every number here is counted on the
                server from persisted form instances — see OverviewFollowUps.
                The follow-up colour appears ONLY when something actually needs
                a person: a permanent pink badge saying "nothing needs
                attention" teaches a reader to ignore the colour.
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
                    ? `${attention.needsAttention} ${pluralize(attention.needsAttention, "follow-up")} ${attention.needsAttention === 1 ? "needs" : "need"} attention`
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

        {/* Google reviews */}
        {can("view_google_reviews") ? (
          <Card>
            <CardHeader className="flex items-start justify-between gap-3">
              <div>
                <CardTitle>Google reviews</CardTitle>
                <p className="mt-1 text-[13px] text-muted-foreground">
                  This week, all salons
                </p>
              </div>
              <span className="flex size-8 items-center justify-center rounded-[var(--radius-sm)] bg-gold-soft text-gold-deep">
                <Star className="size-4" aria-hidden />
              </span>
            </CardHeader>
            <CardContent className="pt-0">
              <p className="text-[32px] leading-none font-semibold tracking-tight text-foreground tabular-nums">
                +{reviewTotals.gained}
              </p>
              <p className="mt-1.5 text-[13px] text-muted-foreground">
                reviews gained this week ·{" "}
                <span className="text-status-ready">
                  {reviewTotals.gained - reviewTotals.lastWeek > 0 ? "+" : ""}
                  {reviewTotals.gained - reviewTotals.lastWeek}
                </span>{" "}
                vs last week
              </p>
              <div className="mt-4">
                <div className="mb-1.5 flex items-center justify-between text-xs text-muted-foreground">
                  <span>Weekly goal</span>
                  <span className="tabular-nums">
                    {reviewTotals.gained} / {reviewTotals.goal}
                  </span>
                </div>
                <Progress
                  value={(reviewTotals.gained / reviewTotals.goal) * 100}
                  label="Weekly review goal progress"
                />
              </div>
              <p className="mt-3.5 text-xs text-muted-foreground">
                Average rating {reviewTotals.rating.toFixed(2)} across{" "}
                {DEMO_REVIEW_METRICS.length} salons
              </p>
              <Button asChild variant="ghost" size="sm" className="mt-2 w-full">
                <Link href="/reviews">
                  Open Google Reviews
                  <ArrowUpRight />
                </Link>
              </Button>
            </CardContent>
          </Card>
        ) : null}

        {/* Daily stats */}
        {can("view_daily_stats") ? (
          <Card className="xl:col-span-2">
            <CardHeader className="flex items-start justify-between gap-3">
              <div>
                <CardTitle>Daily Stats</CardTitle>
                <p className="mt-1 text-[13px] text-muted-foreground">
                  Yesterday across all salons
                </p>
              </div>
              <Button asChild variant="ghost" size="sm">
                <Link href="/reports">
                  Open reporting
                  <ArrowUpRight />
                </Link>
              </Button>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
                {DAILY_STATS_METRICS.map((metric) => (
                  <div key={metric.id}>
                    <p className="eyebrow">{metric.label}</p>
                    <p className="mt-1.5 text-[22px] leading-none font-semibold text-foreground tabular-nums">
                      {metric.value}
                    </p>
                    <p
                      className={cn(
                        "mt-1.5 text-xs",
                        metric.trend === "down"
                          ? "text-status-attention"
                          : "text-muted-foreground",
                      )}
                    >
                      {metric.changeLabel}
                    </p>
                  </div>
                ))}
              </div>
              <DemoDataNote className="mt-4" />
            </CardContent>
          </Card>
        ) : null}

        {/* Training recommendations */}
        <Card>
          <CardHeader className="flex items-start justify-between gap-3">
            <div>
              <CardTitle>Recommended training</CardTitle>
              <p className="mt-1 text-[13px] text-muted-foreground">
                Matched to what you have been working on
              </p>
            </div>
            <span className="flex size-8 items-center justify-center rounded-[var(--radius-sm)] bg-accent-soft text-accent-soft-foreground">
              <PlayCircle className="size-4" aria-hidden />
            </span>
          </CardHeader>
          <CardContent className="space-y-2 pt-0">
            {recommendedVideos.map((video) => (
              <VideoSuggestionCard key={video.id} video={video} />
            ))}
            <Button asChild variant="ghost" size="sm" className="w-full">
              <Link href="/videos">
                Browse the library
                <ArrowUpRight />
              </Link>
            </Button>
          </CardContent>
        </Card>

        {/* Knowledge updates */}
        <Card>
          <CardHeader className="flex items-start justify-between gap-3">
            <div>
              <CardTitle>Latest knowledge updates</CardTitle>
              <p className="mt-1 text-[13px] text-muted-foreground">
                Recently added or re-uploaded
              </p>
            </div>
            <span className="flex size-8 items-center justify-center rounded-[var(--radius-sm)] bg-surface-muted text-muted-foreground">
              <BookOpen className="size-4" aria-hidden />
            </span>
          </CardHeader>
          <CardContent className="pt-0">
            <ul className="space-y-2">
              {latestDocuments.map((document) => (
                <li key={document.id}>
                  <Link
                    href={`/knowledge?document=${document.id}`}
                    className="block rounded-[var(--radius-sm)] px-2.5 py-2 transition-colors hover:bg-surface-muted"
                  >
                    <span className="flex items-start justify-between gap-3">
                      <span className="min-w-0">
                        <span className="block truncate text-[13px] font-medium text-foreground">
                          {document.title}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {KNOWLEDGE_CATEGORY_LABEL[document.category]} ·{" "}
                          {formatDate(document.uploadedAt)}
                        </span>
                      </span>
                      {document.version > 1 ? (
                        <Badge tone="neutral" size="sm" className="shrink-0">
                          v{document.version}
                        </Badge>
                      ) : null}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
            <Button asChild variant="ghost" size="sm" className="mt-2 w-full">
              <Link href="/knowledge">
                Open Knowledge Base
                <ArrowUpRight />
              </Link>
            </Button>
          </CardContent>
        </Card>

        {/* Manager resources */}
        <Card>
          <CardHeader className="flex items-start justify-between gap-3">
            <div>
              <CardTitle>Manager resources</CardTitle>
              <p className="mt-1 text-[13px] text-muted-foreground">
                The tools you would otherwise go hunting for
              </p>
            </div>
            <span className="flex size-8 items-center justify-center rounded-[var(--radius-sm)] bg-surface-muted text-muted-foreground">
              <Wrench className="size-4" aria-hidden />
            </span>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="flex flex-wrap gap-1.5">
              {["L10 Meetings", "Power BI", "Woven", "Company Policies", "HR Resources"].map(
                (name) => (
                  <span
                    key={name}
                    className="rounded-full border border-border bg-surface-muted px-2.5 py-1 text-xs text-muted-foreground"
                  >
                    {name}
                  </span>
                ),
              )}
            </div>
            <Button asChild variant="ghost" size="sm" className="mt-3.5 w-full">
              <Link href="/resources">
                Open Manager Resources
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
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: "Overdue", value: attention.overdue, filter: "overdue" },
                { label: "Due this week", value: attention.dueThisWeek, filter: "open" },
                {
                  label: "Open",
                  value: followUps.length - attention.overdue,
                  filter: "open",
                },
              ].map((entry) => (
                <Link
                  key={entry.label}
                  href={`/forms/monitoring?followup=${entry.filter}`}
                  className="rounded-[var(--radius-sm)] border border-border bg-surface-muted px-3 py-2.5 transition-colors hover:bg-hover-surface"
                >
                  <p
                    className={cn(
                      "text-[20px] leading-none font-semibold tabular-nums",
                      // Only the overdue tile carries the colour, and only when
                      // it is not zero.
                      entry.filter === "overdue" && entry.value > 0
                        ? "text-followup-attention"
                        : "text-foreground",
                    )}
                  >
                    {formatNumber(entry.value)}
                  </p>
                  <p className="mt-1.5 text-xs text-muted-foreground">{entry.label}</p>
                </Link>
              ))}
            </div>
            <Button asChild variant="ghost" size="sm" className="mt-3 w-full">
              <Link href="/forms/monitoring">
                Open Form Monitoring
                <ArrowUpRight />
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Recent activity */}
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
    </PageShell>
  );
}
