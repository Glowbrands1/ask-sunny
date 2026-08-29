"use client";

import { useMemo, useState } from "react";
import {
  BarChart3,
  BookOpen,
  CalendarCheck,
  CalendarDays,
  ExternalLink,
  GraduationCap,
  Info,
  Library,
  LifeBuoy,
  Megaphone,
  Search,
  Users,
  Wrench,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/field";
import { EmptyState, Notice } from "@/components/ui/feedback";
import { PageHeader, PageShell } from "@/components/ui/layout";
import { Dialog, DialogActions, DialogClose, DialogContent } from "@/components/ui/overlays";
import { DEMO_RESOURCES, RESOURCE_CATEGORY_LABEL } from "@/data/demo/resources";
import { cn } from "@/lib/utils/cn";
import type { ExternalResource } from "@/types";

const ICONS: Record<string, LucideIcon> = {
  "calendar-check": CalendarCheck,
  "bar-chart": BarChart3,
  library: Library,
  "book-open": BookOpen,
  "graduation-cap": GraduationCap,
  users: Users,
  "life-buoy": LifeBuoy,
  "calendar-days": CalendarDays,
  wrench: Wrench,
  megaphone: Megaphone,
};

export function ResourcesScreen() {
  const [query, setQuery] = useState("");
  const [pending, setPending] = useState<ExternalResource | null>(null);

  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = DEMO_RESOURCES.filter(
      (resource) =>
        !q ||
        resource.name.toLowerCase().includes(q) ||
        resource.description.toLowerCase().includes(q),
    );
    const map = new Map<string, ExternalResource[]>();
    filtered.forEach((resource) => {
      const list = map.get(resource.category) ?? [];
      list.push(resource);
      map.set(resource.category, list);
    });
    return Array.from(map.entries());
  }, [query]);

  return (
    <PageShell>
      <PageHeader
        eyebrow="Tools"
        title="Manager Resources"
        description="Every external tool a manager needs, in one place — instead of a bookmark folder, a Teams message and a memory."
        actions={
          <div className="relative">
            <Search
              className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search resources…"
              aria-label="Search resources"
              className="pl-9 sm:w-64"
            />
          </div>
        }
      />

      {grouped.length === 0 ? (
        <EmptyState
          icon={<Wrench />}
          title="No resources match"
          description="Try a different search term."
          action={
            <Button variant="secondary" onClick={() => setQuery("")}>
              Clear search
            </Button>
          }
        />
      ) : (
        <div className="space-y-8">
          {grouped.map(([category, resources]) => (
            <section key={category}>
              <h2 className="eyebrow mb-3">
                {RESOURCE_CATEGORY_LABEL[category] ?? category}
              </h2>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {resources.map((resource) => {
                  const Icon = ICONS[resource.iconKey] ?? Wrench;
                  const available = resource.availability === "available";
                  return (
                    <Card key={resource.id} interactive={available}>
                      <CardContent className="flex h-full flex-col p-5">
                        <div className="flex items-start justify-between gap-3">
                          <span
                            className={cn(
                              "flex size-10 shrink-0 items-center justify-center rounded-[var(--radius-md)]",
                              available
                                ? "bg-primary-soft text-primary-soft-foreground"
                                : "bg-surface-muted text-muted-foreground",
                            )}
                          >
                            <Icon className="size-4.5" aria-hidden />
                          </span>
                          {!available ? (
                            <Badge tone="neutral" size="sm">
                              Coming soon
                            </Badge>
                          ) : null}
                        </div>

                        <h3 className="mt-3.5 text-[15px] font-semibold text-foreground">
                          {resource.name}
                        </h3>
                        <p className="mt-1.5 flex-1 text-[13px] leading-relaxed text-muted-foreground">
                          {resource.description}
                        </p>

                        <p className="mt-3 text-xs text-subtle-foreground">
                          Owner: {resource.owner}
                        </p>

                        <Button
                          variant={available ? "secondary" : "ghost"}
                          size="sm"
                          className="mt-4 w-full"
                          disabled={!available}
                          onClick={() => setPending(resource)}
                        >
                          {available ? (
                            <>
                              Open
                              <ExternalLink />
                            </>
                          ) : (
                            "Not available yet"
                          )}
                        </Button>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}

      <Notice tone="neutral" icon={<Info />} className="mt-8">
        Resources are stored as data, not hard-coded links, so an administrator
        will be able to add, rename and reorder these tiles without a release.
        Destination URLs are placeholders in this prototype.
      </Notice>

      {/* Leaving-the-app confirmation */}
      <Dialog
        open={Boolean(pending)}
        onOpenChange={(open) => {
          if (!open) setPending(null);
        }}
      >
        {pending ? (
          <DialogContent
            title={`Open ${pending.name}?`}
            description="This opens an external tool in a new tab."
          >
            <p className="text-[13px] leading-relaxed text-muted-foreground">
              {pending.description}
            </p>
            <div className="mt-4 rounded-[var(--radius-sm)] border border-border bg-surface-muted px-3 py-2.5">
              <p className="eyebrow">Destination</p>
              <p className="mt-1 text-[13px] break-all text-foreground">
                {pending.url}
              </p>
              <p className="mt-1.5 text-xs text-muted-foreground">
                Placeholder URL — the real destination is configured per
                organisation.
              </p>
            </div>
            <DialogActions>
              <DialogClose asChild>
                <Button variant="ghost">Cancel</Button>
              </DialogClose>
              <Button asChild>
                <a href={pending.url} target="_blank" rel="noopener noreferrer">
                  Open in a new tab
                  <ExternalLink />
                </a>
              </Button>
            </DialogActions>
          </DialogContent>
        ) : null}
      </Dialog>
    </PageShell>
  );
}
