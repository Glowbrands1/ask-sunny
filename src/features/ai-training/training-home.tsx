"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo } from "react";
import { ArrowRight, BookOpen, GraduationCap, MessageSquare, Search, Settings, Sparkles } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/controls";
import { EmptyState, Notice } from "@/components/ui/feedback";
import { Input } from "@/components/ui/field";
import { PageHeader, PageShell } from "@/components/ui/layout";
import { groupTrackLessons, trackCounts } from "@/lib/ai-training/catalog";
import { splitSections } from "@/lib/ai-training/markdown";
import type { TrainingCatalog, TrainingPage, TrainingSubmission } from "@/lib/ai-training/types";
import { cn } from "@/lib/utils/cn";

import { ModuleTitle } from "./module-title";
import { SubmissionList } from "./submission-list";
import { TrainingMarkdown } from "./training-markdown";

const TABS = ["training", "policy", "best-practices", "submissions"] as const;
type Tab = (typeof TABS)[number];

export interface TrainingHomeData {
  catalog: TrainingCatalog;
  policy: TrainingPage | null;
  bestPractices: TrainingPage | null;
  announcement: TrainingPage | null;
  mine: TrainingSubmission[];
}

export function TrainingHome({
  isAdmin,
  problem,
  data,
}: {
  isAdmin: boolean;
  problem: string | null;
  data: TrainingHomeData | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const tab: Tab = (TABS as readonly string[]).includes(params.get("tab") ?? "") ? (params.get("tab") as Tab) : "training";

  function setParam(key: string, value: string | null) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    const query = next.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  return (
    <PageShell className="max-w-[1100px]">
      <PageHeader
        eyebrow="JB & Associates"
        title="AI Training"
        description="Claude and ChatGPT lessons for putting AI to real use in your everyday work. Read a lesson, try it, then submit what you made."
        actions={
          isAdmin ? (
            <Button asChild variant="secondary">
              <Link href="/ai-training/manage">
                <Settings aria-hidden /> Manage training
              </Link>
            </Button>
          ) : null
        }
      />

      {problem || !data ? (
        <Notice tone="attention" title="AI Training is unavailable">
          {problem ?? "Nothing to show yet."}
        </Notice>
      ) : (
        <>
          {data.announcement?.bodyMd.trim() ? (
            <Card className="mb-6 p-5">
              <TrainingMarkdown md={data.announcement.bodyMd} />
            </Card>
          ) : null}
          <Tabs value={tab} onValueChange={(value) => setParam("tab", value === "training" ? null : value)}>
            <TabsList aria-label="AI Training sections">
              <TabsTrigger value="training">Training</TabsTrigger>
              <TabsTrigger value="policy">AI Policy</TabsTrigger>
              <TabsTrigger value="best-practices">Best Practices</TabsTrigger>
              <TabsTrigger value="submissions">
                My submissions{data.mine.length ? ` (${data.mine.length})` : ""}
              </TabsTrigger>
            </TabsList>
            <TabsContent value="training">
              <Catalog
                catalog={data.catalog}
                trackSlug={params.get("track")}
                query={params.get("q") ?? ""}
                onTrack={(slug) => setParam("track", slug)}
                onQuery={(q) => setParam("q", q || null)}
                isAdmin={isAdmin}
              />
            </TabsContent>
            <TabsContent value="policy">
              <ContentPage page={data.policy} empty="The AI Access & Use Policy has not been added yet." />
            </TabsContent>
            <TabsContent value="best-practices">
              <BestPractices page={data.bestPractices} />
            </TabsContent>
            <TabsContent value="submissions">
              {data.mine.length ? (
                <SubmissionList submissions={data.mine} showLesson />
              ) : (
                <EmptyState
                  icon={<GraduationCap />}
                  title="No submissions yet"
                  description="Open a lesson, try it out, and press Submit to share what you made."
                />
              )}
            </TabsContent>
          </Tabs>
        </>
      )}
    </PageShell>
  );
}

function Catalog({
  catalog,
  trackSlug,
  query,
  onTrack,
  onQuery,
  isAdmin,
}: {
  catalog: TrainingCatalog;
  trackSlug: string | null;
  query: string;
  onTrack: (slug: string) => void;
  onQuery: (q: string) => void;
  isAdmin: boolean;
}) {
  const track = catalog.tracks.find((t) => t.slug === trackSlug) ?? catalog.tracks[0];
  const groups = useMemo(() => (track ? groupTrackLessons(catalog, track.id, query) : []), [catalog, track, query]);
  const total = groups.reduce((n, g) => n + g.lessons.length, 0);

  if (!catalog.tracks.length) {
    return (
      <EmptyState
        icon={<GraduationCap />}
        title="No lessons yet"
        description={
          isAdmin
            ? "Import the training content, or add a track and lessons, from Manage training."
            : "Lessons will appear here as soon as they are published."
        }
      />
    );
  }

  return (
    <div>
      <div className="mb-6 grid gap-3 sm:grid-cols-2" role="group" aria-label="Training track">
        {catalog.tracks.map((t) => {
          const selected = t.id === track?.id;
          const counts = trackCounts(catalog, t.id);
          const Icon = t.slug.includes("claude") ? Sparkles : t.slug.includes("chatgpt") ? MessageSquare : BookOpen;
          return (
            <button
              key={t.id}
              type="button"
              aria-pressed={selected}
              onClick={() => onTrack(t.slug)}
              className={cn(
                "flex flex-col rounded-[var(--radius-lg)] border-2 bg-surface p-5 text-left shadow-raised transition-colors hover:bg-hover-surface focus-visible:outline-2 focus-visible:outline-offset-2",
                selected ? "border-accent" : "border-transparent",
              )}
            >
              <span className="mb-3 flex items-center justify-between gap-3">
                <span className="grid size-10 place-items-center rounded-full bg-surface-muted text-foreground">
                  <Icon aria-hidden className="size-5" />
                </span>
                <span className="text-xs font-semibold text-muted-foreground">{selected ? "Viewing" : "View"}</span>
              </span>
              <span className="text-lg font-semibold text-foreground">{t.title}</span>
              <span className="mt-2 text-xs text-muted-foreground">
                {counts.modules} {counts.modules === 1 ? "module" : "modules"} · {counts.lessons} published{" "}
                {counts.lessons === 1 ? "lesson" : "lessons"}
              </span>
            </button>
          );
        })}
      </div>

      <div className="relative mb-4">
        <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          defaultValue={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder="Search lessons by title or topic"
          aria-label="Search lessons"
          className="pl-10"
        />
      </div>
      <p className="mb-3 text-xs text-muted-foreground">
        {total} {total === 1 ? "lesson" : "lessons"}
      </p>

      {total === 0 ? (
        <EmptyState
          compact
          title={query ? `No lessons match "${query}"` : "No lessons published yet"}
          description={query ? "Try a different word, or clear the search." : "New lessons will appear here as soon as they are published."}
        />
      ) : (
        <div className="space-y-8">
          {groups.map((group) => (
            <section key={group.id}>
              {group.module ? (
                <h2 className="mb-3 text-lg font-semibold text-foreground">
                  <ModuleTitle title={group.module.title} />
                  {group.module.adminOnly ? <span className="ml-2 text-xs font-normal text-muted-foreground">(admins only)</span> : null}
                </h2>
              ) : null}
              <div className="grid gap-3 md:grid-cols-2">
                {group.lessons.map((lesson) => (
                  <Link key={lesson.id} href={`/ai-training/${track!.slug}/${lesson.slug}`} className="group block rounded-[var(--radius-lg)] focus-visible:outline-2 focus-visible:outline-offset-2">
                    <Card interactive className="h-full p-5">
                      <div className="text-[17px] font-semibold break-words text-foreground">{lesson.title}</div>
                      {lesson.summary ? <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{lesson.summary}</p> : null}
                      <div className="mt-3 flex items-center justify-between gap-3">
                        <span className="flex flex-wrap gap-1.5">
                          {lesson.weekNumber != null ? <Badge tone="accent">Lesson {lesson.weekNumber}</Badge> : null}
                          {lesson.status !== "published" ? <Badge>Draft</Badge> : null}
                        </span>
                        <ArrowRight aria-hidden className="size-4 shrink-0 opacity-40 transition group-hover:translate-x-0.5 group-hover:opacity-100" />
                      </div>
                    </Card>
                  </Link>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function ContentPage({ page, empty }: { page: TrainingPage | null; empty: string }) {
  if (!page?.bodyMd.trim()) return <EmptyState compact title="Nothing here yet" description={empty} />;
  return (
    <Card className="p-6 sm:p-8">
      <TrainingMarkdown md={page.bodyMd} />
    </Card>
  );
}

/** Best Practices splits into a tab per "## " section, as it did in the old app. */
function BestPractices({ page }: { page: TrainingPage | null }) {
  const md = page?.bodyMd ?? "";
  const { intro, sections } = useMemo(() => splitSections(md), [md]);
  if (!md.trim()) return <EmptyState compact title="Nothing here yet" description="Best practices will appear here once they are written." />;
  if (sections.length < 2) return <ContentPage page={page} empty="" />;
  return (
    <Card className="p-6 sm:p-8">
      {intro.trim() ? <div className="mb-4"><TrainingMarkdown md={intro} /></div> : null}
      <Tabs defaultValue="0">
        <TabsList aria-label="Best practice topics">
          {sections.map((section, i) => (
            <TabsTrigger key={i} value={String(i)}>
              {section.title}
            </TabsTrigger>
          ))}
        </TabsList>
        {sections.map((section, i) => (
          <TabsContent key={i} value={String(i)}>
            <TrainingMarkdown md={section.body} promptCopies />
          </TabsContent>
        ))}
      </Tabs>
    </Card>
  );
}
