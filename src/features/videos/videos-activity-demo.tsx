"use client";

import { History } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { SectionHeader } from "@/components/ui/layout";
import { DEMO_VIDEO_ACTIVITY } from "@/data/demo/videos";
import { relativeTime } from "@/lib/utils/date";

/**
 * The seeded "recent video activity" list — DEMO ONLY, AND IN ITS OWN MODULE
 * SO IT CAN BE LOADED THAT WAY.
 *
 * The parent already refused to render this in live mode. What it could not
 * do from there was stop the seeded rows being BUNDLED: a static import ships
 * whether or not the branch runs, so a live deployment downloaded invented
 * names doing invented things to a real library and then threw them away.
 *
 * `next/dynamic` at the call site makes the import a separate chunk that is
 * only fetched when the branch actually renders — which is never in live mode.
 */
/** The same tones the live library's own rows use, kept in step by eye. */
const ACTIVITY_TONE = {
  added: "ready",
  updated: "processing",
  deleted: "failed",
} as const;

export function VideosActivityDemo() {
  return (
        <section className="mt-10">
          <SectionHeader
            title="Recent video activity"
            description="Who added, updated or removed training, and when."
          />
          <Card>
            <CardContent className="p-2">
              <ul className="divide-y divide-border">
                {DEMO_VIDEO_ACTIVITY.map((entry) => (
                  <li key={entry.id} className="flex items-center gap-3 px-3 py-3">
                    <History
                      className="size-3.5 shrink-0 text-muted-foreground"
                      aria-hidden
                    />
                    <Badge tone={ACTIVITY_TONE[entry.action]} size="sm">
                      {entry.action}
                    </Badge>
                    <span className="min-w-0 flex-1 truncate text-[13px] text-foreground">
                      {entry.videoTitle}
                    </span>
                    <span className="hidden shrink-0 text-xs text-muted-foreground sm:block">
                      {entry.actor}
                    </span>
                    <span className="shrink-0 text-xs text-subtle-foreground">
                      {relativeTime(entry.at)}
                    </span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </section>
  );
}
