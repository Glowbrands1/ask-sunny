"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ArrowLeft } from "lucide-react";

import { Button } from "@/components/ui/button";
import { EmptyState, Notice } from "@/components/ui/feedback";
import { Input, Label, Select, Textarea } from "@/components/ui/field";
import { PageHeader, PageShell } from "@/components/ui/layout";
import { slugify } from "@/lib/ai-training/catalog";
import { nextModuleName } from "@/lib/ai-training/module-name";
import type { LessonStatus, TrainingCatalog, TrainingLesson } from "@/lib/ai-training/types";

import { saveLessonAction } from "./actions";
import { MarkdownSplit } from "./manage-screen";

/** The Module list's value for "+ New module…". Never a real id (ids are UUIDs). */
const NEW_MODULE = "__new__";

export function LessonEditor({
  problem,
  catalog,
  lesson,
  isNew,
  defaultTrackId,
}: {
  problem: string | null;
  catalog: TrainingCatalog | null;
  lesson: TrainingLesson | null;
  isNew: boolean;
  defaultTrackId: string | null;
}) {
  const back = (
    <Link href="/ai-training/manage" className="mb-4 inline-flex items-center gap-1 text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase hover:text-foreground">
      <ArrowLeft aria-hidden className="size-3.5" /> Manage AI Training
    </Link>
  );
  if (problem || !catalog) {
    return (
      <PageShell className="max-w-[1300px]">
        {back}
        <Notice tone="attention" title="AI Training is unavailable">{problem ?? "Nothing to show."}</Notice>
      </PageShell>
    );
  }
  if (!isNew && !lesson) {
    return (
      <PageShell className="max-w-[1300px]">
        {back}
        <EmptyState title="Lesson not found" description="It may have been deleted." />
      </PageShell>
    );
  }
  if (!catalog.tracks.length) {
    return (
      <PageShell className="max-w-[1300px]">
        {back}
        <EmptyState title="Add a track first" description="Every lesson belongs to a track. Add one, or import the content, from Manage AI Training." />
      </PageShell>
    );
  }
  return (
    <PageShell className="max-w-[1300px]">
      {back}
      <Form catalog={catalog} lesson={lesson} defaultTrackId={defaultTrackId} />
    </PageShell>
  );
}

function Form({ catalog, lesson, defaultTrackId }: { catalog: TrainingCatalog; lesson: TrainingLesson | null; defaultTrackId: string | null }) {
  const router = useRouter();
  const [trackId, setTrackId] = useState(lesson?.trackId ?? (catalog.tracks.some((t) => t.id === defaultTrackId) ? defaultTrackId! : catalog.tracks[0].id));
  const [moduleId, setModuleId] = useState(lesson?.moduleId ?? "");
  const [newModuleTitle, setNewModuleTitle] = useState("");
  const [title, setTitle] = useState(lesson?.title ?? "");
  const [slug, setSlug] = useState(lesson?.slug ?? "");
  const [slugTouched, setSlugTouched] = useState(!!lesson);
  const [summary, setSummary] = useState(lesson?.summary ?? "");
  const [week, setWeek] = useState(lesson?.weekNumber != null ? String(lesson.weekNumber) : "");
  const [status, setStatus] = useState<LessonStatus>(lesson?.status ?? "draft");
  const [body, setBody] = useState(lesson?.bodyMd ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();
  const modules = catalog.modules.filter((m) => m.trackId === trackId).sort((a, b) => a.sortOrder - b.sortOrder);
  const track = catalog.tracks.find((t) => t.id === trackId);

  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        setSaved(false);
        start(async () => {
          const result = await saveLessonAction({
            id: lesson?.id ?? null,
            trackId,
            moduleId: moduleId && moduleId !== NEW_MODULE ? moduleId : null,
            newModuleTitle: moduleId === NEW_MODULE ? newModuleTitle : null,
            slug,
            title,
            summary,
            bodyMd: body,
            weekNumber: week,
            status,
          });
          if (!result.ok) setError(result.message);
          else if (!lesson && result.value) router.replace(`/ai-training/manage/lessons/${result.value}`);
          else {
            setSaved(true);
            router.refresh();
          }
        });
      }}
    >
      <PageHeader
        title={lesson ? "Edit lesson" : "New lesson"}
        actions={
          <>
            {lesson && track ? (
              <Button asChild variant="secondary">
                <Link href={`/ai-training/${track.slug}/${lesson.slug}`}>View lesson</Link>
              </Button>
            ) : null}
            <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save"}</Button>
          </>
        }
      />
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <div>
          <Label htmlFor="lesson-track">Track</Label>
          <Select id="lesson-track" value={trackId} onChange={(e) => { setTrackId(e.target.value); setModuleId(""); }}>
            {catalog.tracks.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
          </Select>
        </div>
        <div>
          <Label htmlFor="lesson-module">Module</Label>
          <Select
            id="lesson-module"
            value={moduleId}
            onChange={(e) => {
              if (e.target.value === NEW_MODULE && moduleId !== NEW_MODULE) setNewModuleTitle(nextModuleName(modules));
              setModuleId(e.target.value);
            }}
          >
            <option value="">No module</option>
            {modules.map((m) => <option key={m.id} value={m.id}>{m.title}{m.adminOnly ? " (admins only)" : ""}</option>)}
            <option value={NEW_MODULE}>+ New module…</option>
          </Select>
          {moduleId === NEW_MODULE ? (
            <div className="mt-2">
              <Label htmlFor="lesson-new-module">New module name</Label>
              <Input
                id="lesson-new-module"
                value={newModuleTitle}
                onChange={(e) => setNewModuleTitle(e.target.value)}
                placeholder="Module 6: Working with agents"
              />
              <p className="mt-1 text-xs text-muted-foreground">Created when you save this lesson.</p>
            </div>
          ) : null}
        </div>
        <div>
          <Label htmlFor="lesson-status">Status</Label>
          <Select id="lesson-status" value={status} onChange={(e) => setStatus(e.target.value as LessonStatus)}>
            <option value="draft">Draft (only administrators see it)</option>
            <option value="published">Published</option>
          </Select>
        </div>
        <div className="lg:col-span-2">
          <Label htmlFor="lesson-title">Title</Label>
          <Input
            id="lesson-title"
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              if (!slugTouched) setSlug(slugify(e.target.value));
            }}
            maxLength={300}
            required
          />
        </div>
        <div>
          <Label htmlFor="lesson-week">Lesson number (optional)</Label>
          <Input id="lesson-week" value={week} onChange={(e) => setWeek(e.target.value)} inputMode="numeric" placeholder="e.g. 4" />
        </div>
        <div className="lg:col-span-2">
          <Label htmlFor="lesson-summary">Summary (shown on the lesson card)</Label>
          <Textarea id="lesson-summary" value={summary} onChange={(e) => setSummary(e.target.value)} rows={2} maxLength={2000} />
        </div>
        <div>
          <Label htmlFor="lesson-slug">Web address</Label>
          <Input id="lesson-slug" value={slug} onChange={(e) => { setSlug(e.target.value); setSlugTouched(true); }} placeholder="filled in from the title" />
          <p className="mt-1 text-xs break-all text-muted-foreground">/ai-training/{track?.slug}/{slugify(slug || title)}</p>
        </div>
      </div>
      <MarkdownSplit value={body} onChange={setBody} label="Lesson content (Notion-style markdown)" />
      {error ? <p className="text-sm text-status-failed" role="alert">{error}</p> : null}
      {saved ? <p className="text-sm text-muted-foreground" role="status">Saved.</p> : null}
      <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save"}</Button>
    </form>
  );
}
