import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/feedback";
import { PageHeader, PageShell } from "@/components/ui/layout";
import type { WhatsNewRelease } from "@/config/whats-new";

/** "2026-11-26" → "Nov 26, 2026" (a calendar day, so read at noon UTC: no time zone moves it). */
export function whatsNewDate(date: string): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));
}

/** What's New: releases newest first, each with its summary; each entry tagged, in Before / Now / How to use it. */
export function WhatsNewScreen({ releases, appName }: { releases: readonly WhatsNewRelease[]; appName: string }) {
  return (
    <PageShell>
      <PageHeader eyebrow="Updates" title="What's New" description={`Recent updates and new features in ${appName}, newest first.`} />
      {releases.length === 0 ? (
        <EmptyState title="Nothing new yet" description="New features will be listed here as they arrive." />
      ) : (
        <div className="flex max-w-3xl flex-col gap-8">
          {releases.map((release) => (
            <section key={release.date} aria-labelledby={`release-${release.date}`} className="flex flex-col gap-3">
              <header>
                <h2 id={`release-${release.date}`} className="text-lg font-semibold text-foreground">
                  <time dateTime={release.date}>{whatsNewDate(release.date)}</time>
                </h2>
                <p className="text-sm text-muted-foreground">{release.summary}</p>
              </header>
              <ol className="flex flex-col gap-3">
                {release.entries.map((entry) => (
                  <li key={entry.title}>
                    <Card>
                      <CardContent className="flex flex-col gap-2 p-5">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge tone={entry.tag === "New" ? "primary" : "accent"}>{entry.tag}</Badge>
                          <h3 className="text-base font-semibold text-foreground">{entry.title}</h3>
                        </div>
                        <dl className="grid gap-1.5 text-sm sm:grid-cols-[8rem_1fr]">
                          <dt className="font-medium text-foreground">Before:</dt>
                          <dd className="text-muted-foreground">{entry.before}</dd>
                          <dt className="font-medium text-foreground">Now:</dt>
                          <dd className="text-muted-foreground">{entry.now}</dd>
                          <dt className="font-medium text-foreground">How to use it:</dt>
                          <dd className="text-muted-foreground">{entry.howToUse}</dd>
                        </dl>
                        {entry.showMe && entry.showMe.href !== "/whats-new" ? (
                          <Link href={entry.showMe.href} className="mt-1 inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
                            Show me: {entry.showMe.label} <ArrowRight aria-hidden className="size-3.5" />
                          </Link>
                        ) : null}
                      </CardContent>
                    </Card>
                  </li>
                ))}
              </ol>
            </section>
          ))}
        </div>
      )}
    </PageShell>
  );
}
