"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { ArrowUpRight, Info, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { EmptyState, Notice } from "@/components/ui/feedback";
import { PageHeader, PageShell } from "@/components/ui/layout";
import { isDemoMode } from "@/lib/config/runtime";

/**
 * ============================================================================
 * EVERY FIGURE ON THIS SCREEN IS INVENTED, SO LIVE DOES NOT SHOW IT
 * ============================================================================
 *
 * "$214.62 spent this month", "1,284 requests", "$785.38 credit remaining",
 * "34 of 41 leaders using the tool", a four-week trend — all of it seeded, all
 * of it rendered on live deployments to anybody holding `view_ai_usage`
 * (admin, owner, developer, regional manager). A `DemoDataNote` sat at the
 * BOTTOM of the page, under the charts, which is not where somebody reading a
 * spend figure looks.
 *
 * Numbers about money are the worst possible thing to invent: they are exactly
 * the kind a person acts on without checking, and "are we about to run out of
 * credit" is a question somebody might answer from this page in a budget
 * meeting.
 *
 * THERE IS NO REAL SOURCE TO SWAP IN. Nothing records Anthropic spend — no
 * table, no endpoint, no provider call. So live gets an honest
 * not-configured state rather than an estimate, and it points at the adoption
 * analytics that ARE real (`/admin/analytics`, backed by
 * `lib/analytics/queries.ts`) so the trip to this screen is not wasted.
 */
function AIUsageUnavailable() {
  return (
    <PageShell>
      <PageHeader
        eyebrow="Admin"
        title="AI Usage"
        description="What the assistant costs to run, and how much credit is left."
      />
      <EmptyState
        icon={<Sparkles />}
        title="AI usage reporting is not connected"
        description="Spend, request volume and remaining credit are not being recorded yet, so there is nothing to show here. When a usage source is connected this page will report it."
        action={
          <Button asChild variant="secondary">
            <Link href="/admin/analytics">
              View adoption analytics
              <ArrowUpRight />
            </Link>
          </Button>
        }
      />
      <Notice tone="neutral" icon={<Info />} className="mt-6">
        Adoption analytics — questions asked, forms created, who is using the
        assistant — are recorded and available now. Provider cost and credit
        are not.
      </Notice>
    </PageShell>
  );
}

/*
 * DYNAMIC, so the seeded figures are a chunk only a demo deployment fetches.
 * `ssr: false` because it is client-only content that never renders live.
 */
const AIUsageDemoScreen = dynamic(
  () => import("./ai-usage-demo-screen").then((m) => m.AIUsageDemoScreen),
  { ssr: false },
);

export function AIUsageScreen() {
  if (!isDemoMode()) return <AIUsageUnavailable />;
  return <AIUsageDemoScreen />;
}
