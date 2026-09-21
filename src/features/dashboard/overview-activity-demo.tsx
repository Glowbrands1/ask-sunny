"use client";

import { Sparkles } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { DemoDataNote } from "@/components/ui/feedback";
import { SectionHeader } from "@/components/ui/layout";
import { DEMO_RECENT_ACTIVITY } from "@/data/demo/dashboard";
import { relativeTime } from "@/lib/utils/date";
import { ACTIVITY_ICONS } from "./activity-icons";
import type { Role } from "@/types";

/**
 * "RECENT ASK SUNNY ACTIVITY" — SEEDED IN ITS ENTIRETY, AND NOW IN A CHUNK OF
 * ITS OWN.
 *
 * The summaries, the actors and the timestamps are all invented, and the
 * actors are named people. The Overview already refused to render this in
 * live mode, which was the right call and only half the job: a static import
 * ships regardless of whether the branch runs, so every live visitor
 * downloaded six fabricated actions attributed to Corey Vandenberg and
 * Alicia Moreno and then discarded them.
 *
 * HIDDEN RATHER THAN EMPTIED, still. "No recent activity" would be its own
 * falsehood: there is activity, it is simply not recorded anywhere yet.
 */
export function OverviewActivityDemo({ role }: { role: Role }) {
  return (
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
  );
}
