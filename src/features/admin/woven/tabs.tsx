import Link from "next/link";
import { ArrowLeft, Lock } from "lucide-react";

import { Notice } from "@/components/ui/feedback";
import { PageHeader } from "@/components/ui/layout";
import { cn } from "@/lib/utils/cn";

/**
 * The six Woven tabs, each at its own URL — the Analytics pattern — so a
 * filtered directory is a link somebody can send.
 *
 * Tabs that show people are marked: they need Manage users as well as Manage
 * integrations, and their pages enforce it on the server before reading.
 */

export type WovenTabKey = "overview" | "directory" | "changes" | "runs" | "mappings" | "preview";

export const WOVEN_TABS: readonly { key: WovenTabKey; label: string; href: string; people: boolean }[] = [
  { key: "overview", label: "Overview", href: "/admin/integrations/woven", people: false },
  { key: "directory", label: "Employee Directory", href: "/admin/integrations/woven/directory", people: true },
  { key: "changes", label: "Change Feed", href: "/admin/integrations/woven/changes", people: true },
  { key: "runs", label: "Sync History", href: "/admin/integrations/woven/runs", people: false },
  { key: "mappings", label: "Mappings", href: "/admin/integrations/woven/mappings", people: true },
  { key: "preview", label: "Access Preview", href: "/admin/integrations/woven/preview", people: true },
];

export function WovenTabs({ current }: { current: WovenTabKey }) {
  return (
    <nav aria-label="Woven Employee Sync" className="mb-6 overflow-x-auto border-b border-border">
      <ul className="flex min-w-max gap-1">
        {WOVEN_TABS.map((tab) => {
          const active = tab.key === current;
          return (
            <li key={tab.key}>
              <Link
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "inline-flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-[13px] font-semibold whitespace-nowrap",
                  active
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {tab.label}
                {tab.people ? (
                  <Lock className="size-3 opacity-60" aria-label="Needs Manage users" />
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** The header every Woven tab shares: back link, title, the observe-only promise, the tabs. */
export function WovenHeader({ current, sampleLabel }: { current: WovenTabKey; sampleLabel: string | null }) {
  return (
    <>
      <Link
        href="/admin/integrations"
        className="mb-3 inline-flex items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" />
        Integrations
      </Link>
      <PageHeader
        eyebrow="Admin · Integrations · Woven"
        title="Woven Employee Sync"
        description="Who works where, in what position, and what changed — read from Woven. Observe only: no login, role, scope or salon access is changed."
      />
      {sampleLabel ? <SampleBanner label={sampleLabel} /> : null}
      <WovenTabs current={current} />
    </>
  );
}

export function SampleBanner({ label }: { label: string }) {
  return (
    <Notice tone="attention" title={label} className="mb-4">
      <span data-testid="woven-sample-banner">
        This demo build shows invented records so the screens can be reviewed before real Woven data exists. Nothing
        here came from Woven, nothing is read from or written to the database, and every action is disabled.
      </span>
    </Notice>
  );
}
