import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/feedback";
import { PageHeader, PageShell } from "@/components/ui/layout";
import type { WhatsNewEntry } from "@/config/whats-new";

/** "2026-11-26" → "Nov 26, 2026" (a calendar day, so read at noon UTC: no time zone moves it). */
export function whatsNewDate(date: string): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));
}

export function WhatsNewScreen({ entries }: { entries: readonly WhatsNewEntry[] }) {
  return (
    <PageShell>
      <PageHeader eyebrow="Updates" title="What's New" description="Recent updates and new features in Ask Sunny, newest first." />
      {entries.length === 0 ? (
        <EmptyState title="Nothing new yet" description="New features will be listed here as they arrive." />
      ) : (
        <ol className="flex max-w-3xl flex-col gap-3" aria-label="Recent updates">
          {entries.map((entry) => (
            <li key={`${entry.date}-${entry.title}`}>
              <Card>
                <CardContent className="flex flex-col gap-1.5 p-5">
                  <time dateTime={entry.date} className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {whatsNewDate(entry.date)}
                  </time>
                  <h2 className="text-base font-semibold text-foreground">{entry.title}</h2>
                  <p className="text-sm text-muted-foreground">{entry.description}</p>
                  {entry.href && entry.href !== "/whats-new" ? (
                    <Link href={entry.href} className="mt-1 inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
                      Open it <ArrowRight aria-hidden className="size-3.5" />
                    </Link>
                  ) : null}
                </CardContent>
              </Card>
            </li>
          ))}
        </ol>
      )}
    </PageShell>
  );
}
