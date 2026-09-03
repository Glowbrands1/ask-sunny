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
import { useSession } from "@/lib/session/session-context";
import { useAppStore } from "@/lib/store/app-store";
import { cn } from "@/lib/utils/cn";
import {
  daysFromNow,
  demoNow,
  formatDate,
  greetingForHour,
  relativeDay,
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

export function OverviewScreen() {
  const { user, role, can, primaryLocationName } = useSession();
  const { forms, documents, videos } = useAppStore();

  // Salon accounts are shared by the salon team, so greet the team rather than
  // addressing the salon itself as a person.
  const greetingName = user.isSalonAccount
    ? `${user.name} team`
    : (user.name.split(" ")[0] ?? user.name);

  const greeting = greetingForHour(demoNow().getUTCHours());

  const followUps = useMemo(() => {
    return forms
      .filter(
        (form) =>
          !form.archived &&
          form.followUpDate &&
          (form.status === "overdue" ||
            form.status === "due_soon" ||
            form.status === "open"),
      )
      .map((form) => ({ form, days: daysFromNow(form.followUpDate as string) }))
      .sort((a, b) => a.days - b.days);
  }, [forms]);

  const needsAttention = followUps.filter((entry) => entry.days <= 3);

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

        {/* Follow-ups due */}
        <Card>
          <CardHeader className="flex items-start justify-between gap-3">
            <div>
              <CardTitle>Follow-ups due</CardTitle>
              {/*
                CURT'S EXPLICIT EXAMPLE: "4 follow-ups need attention".
                The follow-up colour appears here and on the icon ONLY when
                something actually needs a person — a count of zero stays
                muted, because a permanent pink badge saying "nothing needs
                attention" teaches a reader to ignore the colour.
              */}
              <p
                className={cn(
                  "mt-1 text-[13px]",
                  needsAttention.length > 0
                    ? "font-medium text-followup-attention-soft-foreground"
                    : "text-muted-foreground",
                )}
              >
                {needsAttention.length > 0
                  ? `${needsAttention.length} ${pluralize(needsAttention.length, "follow-up")} ${needsAttention.length === 1 ? "needs" : "need"} attention`
                  : "Nothing needs attention today"}
              </p>
            </div>
            <span
              className={cn(
                "flex size-8 items-center justify-center rounded-[var(--radius-sm)]",
                needsAttention.length > 0
                  ? "bg-followup-attention-soft text-followup-attention-soft-foreground"
                  : "bg-surface-muted text-muted-foreground",
              )}
            >
              <FileClock className="size-4" aria-hidden />
            </span>
          </CardHeader>
          <CardContent className="pt-0">
            <ul className="space-y-2.5">
              {followUps.slice(0, 3).map(({ form, days }) => (
                <li key={form.id}>
                  <Link
                    href={`/forms/monitoring?form=${form.id}`}
                    className="flex items-center gap-3 rounded-[var(--radius-sm)] border border-border px-3 py-2.5 transition-colors hover:bg-surface-muted"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium text-foreground">
                        {form.employeeName}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {form.templateName}
                      </span>
                    </span>
                    <Badge
                      tone={days < 0 ? "attention" : days <= 3 ? "primary" : "neutral"}
                      size="sm"
                    >
                      {relativeDay(form.followUpDate)}
                    </Badge>
                  </Link>
                </li>
              ))}
            </ul>
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
            <div className="grid grid-cols-3 gap-3">
              {[
                {
                  label: "Overdue",
                  value: forms.filter((form) => form.status === "overdue").length,
                },
                {
                  label: "Due soon",
                  value: forms.filter((form) => form.status === "due_soon").length,
                },
                {
                  label: "Open",
                  value: forms.filter((form) => form.status === "open").length,
                },
              ].map((entry) => (
                <div
                  key={entry.label}
                  className="rounded-[var(--radius-sm)] border border-border bg-surface-muted px-3 py-2.5"
                >
                  <p className="text-[20px] leading-none font-semibold text-foreground tabular-nums">
                    {formatNumber(entry.value)}
                  </p>
                  <p className="mt-1.5 text-xs text-muted-foreground">{entry.label}</p>
                </div>
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
