"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useTransition, type ReactNode } from "react";
import { ArrowLeft, ArrowRight, ArrowUpRight, BookOpen, Lightbulb, Pencil, PlayCircle, Plus } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState, Notice } from "@/components/ui/feedback";
import { Input, Label, Textarea } from "@/components/ui/field";
import { PageShell } from "@/components/ui/layout";
import { Dialog, DialogActions, DialogContent } from "@/components/ui/overlays";
import type { LessonNav } from "@/lib/ai-training/catalog";
import { lessonDisplayTitle, lessonLayout, type LessonLayout } from "@/lib/ai-training/lesson-layout";
import { splitModuleTitle } from "@/lib/ai-training/markdown";
import { cn } from "@/lib/utils/cn";
import {
  SUBMISSION_STATUS_LABEL,
  type TrainingLesson,
  type TrainingModule,
  type TrainingSubmission,
  type TrainingTrack,
} from "@/lib/ai-training/types";

import { submitLessonResponse } from "./actions";
import { SubmissionList } from "./submission-list";
import { TrainingBlocks, TrainingMarkdown, TrainingRich } from "./training-markdown";

/**
 * ONE LESSON, IN FOUR BLOCKS — Objective, Learn, Practice, Submit (Pau's
 * lesson-page layout, 20 Nov 2026). Each block has its own label chip and
 * colour, the same on every lesson, and a sticky bar shows which one you are
 * in. The lesson's own text is unchanged: `lessonLayout` only sorts it into
 * the blocks. A lesson it cannot sort (the archive) is drawn as one card.
 */
export function LessonScreen({
  problem,
  view,
  mine,
  nav = null,
  isAdmin,
}: {
  problem: string | null;
  view: { lesson: TrainingLesson; track: TrainingTrack; module: TrainingModule | null } | null;
  mine: TrainingSubmission[];
  nav?: LessonNav | null;
  isAdmin: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState(false);
  const back = view ? `/ai-training?track=${view.track.slug}` : "/ai-training";
  const layout = useMemo(() => (view ? lessonLayout(view.lesson.bodyMd) : null), [view]);

  return (
    <PageShell className="max-w-[1000px]">
      <Link href={back} className="mb-5 inline-flex items-center gap-1 text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase hover:text-foreground">
        <ArrowLeft aria-hidden className="size-3.5" /> All training
      </Link>

      {problem ? (
        <Notice tone="attention" title="This lesson could not be loaded">{problem}</Notice>
      ) : !view ? (
        <EmptyState title="Lesson not found" description="It may have been unpublished or moved." action={<Button asChild variant="secondary"><Link href="/ai-training">Back to AI Training</Link></Button>} />
      ) : (
        <>
          <LessonHeader view={view} nav={nav} lede={layout?.lede ?? null} isAdmin={isAdmin} />

          {sent ? (
            <Notice tone="primary" className="mt-6">Thanks — your submission was sent for review. You can see it below and under My submissions.</Notice>
          ) : null}

          {layout ? (
            <LessonBlocks layout={layout} mine={mine} onSubmit={() => setOpen(true)} />
          ) : (
            <>
              <Card className="mt-6 p-6 sm:p-8">
                <TrainingMarkdown md={view.lesson.bodyMd} promptCopies />
              </Card>
              <SubmitBlock layout={null} mine={mine} onSubmit={() => setOpen(true)} />
            </>
          )}

          {mine.length ? (
            <section className="mt-10" aria-labelledby="lesson-mine">
              <h2 id="lesson-mine" className="mb-4 text-xl font-semibold text-foreground">Your submissions</h2>
              <SubmissionList submissions={mine} />
            </section>
          ) : null}

          {nav && (nav.prev || nav.next) ? <PrevNext nav={nav} /> : null}

          <SubmitDialog
            open={open}
            onOpenChange={setOpen}
            lesson={view.lesson}
            onSent={() => {
              setOpen(false);
              setSent(true);
            }}
          />
        </>
      )}
    </PageShell>
  );
}

function LessonHeader({
  view,
  nav,
  lede,
  isAdmin,
}: {
  view: { lesson: TrainingLesson; track: TrainingTrack; module: TrainingModule | null };
  nav: LessonNav | null;
  lede: LessonLayout["lede"];
  isAdmin: boolean;
}) {
  const moduleSplit = view.module ? splitModuleTitle(view.module.title) : null;
  const lessonLabel = nav
    ? `Lesson ${nav.position} of ${nav.total}`
    : view.lesson.weekNumber != null
      ? `Lesson ${view.lesson.weekNumber}`
      : null;
  return (
    <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-xs text-muted-foreground">
          <span className="font-semibold tracking-[0.14em] uppercase">{view.track.title}</span>
          {view.module ? (
            <Badge tone="accent" size="md">
              {moduleSplit ? `${moduleSplit.label} · ${moduleSplit.rest}` : view.module.title}
            </Badge>
          ) : null}
          {lessonLabel ? <Badge tone="accent" size="md">{lessonLabel}</Badge> : null}
          {view.lesson.status !== "published" ? <Badge>Draft</Badge> : null}
        </div>
        <h1 className="display mt-3 text-[30px] break-words text-foreground sm:text-[44px]">{lessonDisplayTitle(view.lesson.title)}</h1>
        {lede ? (
          <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-muted-foreground"><TrainingRich runs={lede} /></p>
        ) : view.lesson.summary ? (
          <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-muted-foreground">{view.lesson.summary}</p>
        ) : null}
      </div>
      {isAdmin ? (
        <Button asChild variant="secondary" className="shrink-0">
          <Link href={`/ai-training/manage/lessons/${view.lesson.id}`}>
            <Pencil aria-hidden /> Edit
          </Link>
        </Button>
      ) : null}
    </header>
  );
}

/* ---------------- the four blocks ---------------- */

type BlockKey = "objective" | "learn" | "practice" | "submit";
const BLOCK_LABEL: Record<BlockKey, string> = { objective: "Objective", learn: "Learn", practice: "Practice", submit: "Submit" };
const blockId = (key: BlockKey) => `lesson-${key}`;

/** The label chip each block starts with. Submit's is yellow on its navy block. */
function BlockChip({ children, tone = "dark" }: { children: ReactNode; tone?: "dark" | "yellow" }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-1 text-[10px] leading-none font-extrabold tracking-[0.14em] uppercase",
        tone === "dark" ? "bg-primary text-primary-foreground" : "bg-accent text-accent-foreground",
      )}
    >
      {children}
    </span>
  );
}

function LessonBlocks({ layout, mine, onSubmit }: { layout: LessonLayout; mine: TrainingSubmission[]; onSubmit: () => void }) {
  const hasLearn = layout.learn.length > 0 || layout.why.length > 0 || layout.introRest.length > 0;
  const keys: BlockKey[] = hasLearn ? ["objective", "learn", "practice", "submit"] : ["objective", "practice", "submit"];
  const { active, stepsReached } = useScrollPosition(keys, layout.practice.steps.length);

  return (
    <>
      <SectionBar keys={keys} active={active} onSubmit={onSubmit} />

      <section id={blockId("objective")} aria-label="Objective" className="mt-6 scroll-mt-40 rounded-[var(--radius-xl)] bg-[var(--training-objective-bg)] p-5 sm:p-8">
        <div className="flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0 flex-1">
            <BlockChip>Objective</BlockChip>
            <TrainingBlocks blocks={layout.objective} className="training-objective training-tight mt-3" />
          </div>
          <div className="flex shrink-0 gap-3">
            {layout.minutes != null ? <Tile label="Time" value={`${layout.minutes} min`} /> : null}
            <Tile label="Submission" value="1 required" />
          </div>
        </div>
        <TrainingBlocks blocks={layout.notices} className="training-tight mt-4" />
      </section>

      {hasLearn ? <LearnBlock layout={layout} /> : null}

      <section id={blockId("practice")} aria-labelledby="lesson-practice-title" className="mt-10 scroll-mt-40">
        <div className="flex items-center justify-between gap-3">
          <BlockChip>Practice</BlockChip>
          {layout.practice.steps.length ? (
            <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <span>{layout.practice.steps.length} {layout.practice.steps.length === 1 ? "step" : "steps"}</span>
              <span aria-hidden className="flex gap-1">
                {layout.practice.steps.map((_, i) => (
                  <span key={i} className={cn("h-1 w-5 rounded-full", i < Math.max(1, stepsReached) ? "bg-accent" : "bg-border")} />
                ))}
              </span>
            </div>
          ) : null}
        </div>
        <h2 id="lesson-practice-title" className="display mt-3 text-2xl text-foreground sm:text-[28px]">This lesson&apos;s assignment</h2>
        {layout.practice.intro.length ? (
          layout.practice.steps.length ? (
            <TrainingBlocks blocks={layout.practice.intro} practice={layout.practiceIds} className="training-tight mt-3" />
          ) : (
            // No numbered steps (ChatGPT Lessons 8, 9, 18): the assignment is one card.
            <div className="mt-5 rounded-[var(--radius-lg)] border border-border bg-surface p-5 shadow-soft sm:p-6">
              <TrainingBlocks blocks={layout.practice.intro} practice={layout.practiceIds} className="training-tight" />
            </div>
          )
        ) : null}
        {layout.practice.steps.length ? (
          <ol className="mt-5 space-y-4" aria-label="Steps">
            {layout.practice.steps.map((step, i) => {
              const last = i === layout.practice.steps.length - 1;
              return (
                <li key={i} id={`lesson-step-${i + 1}`} className="grid grid-cols-[2.25rem_minmax(0,1fr)] gap-3 sm:grid-cols-[3rem_minmax(0,1fr)] sm:gap-4">
                  <div className="relative flex justify-center pt-4">
                    <span aria-hidden className="relative z-10 flex size-9 items-center justify-center rounded-full bg-accent text-base font-extrabold text-accent-foreground sm:size-10">
                      {step.number}
                    </span>
                    {!last ? <span aria-hidden className="absolute top-4 -bottom-4 left-1/2 w-0.5 -translate-x-1/2 bg-accent" /> : null}
                  </div>
                  <div className="min-w-0 rounded-[var(--radius-lg)] border border-border bg-surface p-5 shadow-soft sm:p-6">
                    <h3 className="text-lg font-bold text-foreground">
                      <span className="sr-only">{step.word} {step.number}: </span>
                      <TrainingRich runs={step.title} />
                    </h3>
                    <TrainingBlocks blocks={step.blocks} practice={layout.practiceIds} className="training-tight mt-2" />
                  </div>
                </li>
              );
            })}
          </ol>
        ) : null}
        {layout.practice.after.length ? (
          // After numbered steps, the card sits in the steps' column (past the
          // number rail: 2.25rem + gap 0.75rem, sm 3rem + gap 1rem), so its left
          // edge lines up with the step cards above it (Pau, 24 Nov 2026).
          <div
            data-testid="lesson-practice-after"
            className={cn(
              "rounded-[var(--radius-lg)] border border-border bg-surface p-5 shadow-soft sm:p-6",
              layout.practice.steps.length ? "mt-4 ml-12 sm:ml-16" : "mt-5",
            )}
          >
            <TrainingBlocks blocks={layout.practice.after} practice={layout.practiceIds} className="training-tight" />
          </div>
        ) : null}
      </section>

      <SubmitBlock layout={layout} mine={mine} onSubmit={onSubmit} />

      {layout.tail.length ? <TrainingBlocks blocks={layout.tail} className="training-tight mt-8" /> : null}
    </>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[var(--radius-md)] bg-surface px-4 py-3 shadow-soft">
      <div className="text-[10px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">{label}</div>
      <div className="mt-0.5 text-lg font-extrabold whitespace-nowrap text-foreground">{value}</div>
    </div>
  );
}

function LearnBlock({ layout }: { layout: LessonLayout }) {
  const why = [...layout.introRest, ...layout.why];
  const hasWatch = layout.learn.length > 0;
  const video = layout.learnHref ? /youtu\.?be|vimeo|loom|skilljar|wistia/i.test(layout.learnHref) || /\bwatch\b/i.test(textOfLearn(layout)) : false;
  return (
    <section id={blockId("learn")} aria-label="Learn" className="mt-6 scroll-mt-40 rounded-[var(--radius-xl)] bg-[var(--training-learn-bg)] p-5 sm:p-8">
      <BlockChip>Learn</BlockChip>
      <div className={cn("mt-4 grid gap-4", hasWatch && why.length ? "md:grid-cols-2" : "")}>
        {hasWatch ? (
          <div className="min-w-0 rounded-[var(--radius-lg)] bg-surface p-5 shadow-soft sm:p-6">
            <h2 className="flex items-center gap-2 text-base font-bold text-foreground">
              {layout.learnHref ? <PlayCircle aria-hidden className="size-4.5" /> : <BookOpen aria-hidden className="size-4.5" />}
              {layout.learnHref ? "Watch first" : "Read first"}
            </h2>
            <TrainingBlocks blocks={layout.learn} className="training-tight mt-2 text-sm" />
            {layout.learnHref ? (
              <Button asChild className="mt-4">
                <a href={layout.learnHref} target="_blank" rel="noreferrer">
                  {video ? "Open video" : "Open link"} <ArrowUpRight aria-hidden />
                </a>
              </Button>
            ) : null}
          </div>
        ) : null}
        {why.length ? (
          <div className="min-w-0 rounded-[var(--radius-lg)] bg-surface p-5 shadow-soft sm:p-6">
            <h2 className="flex items-center gap-2 text-base font-bold text-foreground">
              <Lightbulb aria-hidden className="size-4.5" /> Why this matters
            </h2>
            <TrainingBlocks blocks={why} className="training-tight mt-2 text-sm" />
          </div>
        ) : null}
      </div>
    </section>
  );
}

function textOfLearn(layout: LessonLayout): string {
  return layout.learn.map((b) => (b.text ?? []).map((r) => r.text).join("")).join(" ");
}

function SubmitBlock({ layout, mine, onSubmit }: { layout: LessonLayout | null; mine: TrainingSubmission[]; onSubmit: () => void }) {
  const submit = layout?.submit;
  const latest = mine[0];
  return (
    <section id={blockId("submit")} aria-labelledby="lesson-submit-title" className="mt-10 scroll-mt-40 rounded-[var(--radius-xl)] bg-primary p-5 text-primary-foreground sm:p-8">
      <div className="flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0 flex-1">
          <BlockChip tone="yellow">Submit</BlockChip>
          <h2 id="lesson-submit-title" className="display mt-3 text-2xl sm:text-[28px]">Required submission</h2>
          {submit ? (
            <>
              <TrainingBlocks blocks={submit.intro} className="training-prose-dark training-tight mt-2" />
              {submit.checklist.length ? (
                <ul className="mt-3 space-y-2" aria-label="What to submit">
                  {submit.checklist.map((item) => (
                    <li key={item.id} className="flex items-start gap-3">
                      <span aria-hidden className="mt-1 size-4 shrink-0 rounded-[5px] border-2 border-accent" />
                      <div className="min-w-0 text-[15px] leading-relaxed text-[var(--band-prompt-foreground)]">
                        <TrainingRich runs={item.text ?? []} />
                        {item.children ? <TrainingBlocks blocks={item.children} className="training-prose-dark training-tight" /> : null}
                      </div>
                    </li>
                  ))}
                </ul>
              ) : null}
              <TrainingBlocks blocks={submit.after} className="training-prose-dark training-tight mt-3" />
            </>
          ) : (
            <p className="mt-2 text-[15px] text-[var(--band-prompt-foreground)]">Share what you tried and what came out of it.</p>
          )}
        </div>
        <div className="flex shrink-0 flex-col items-stretch gap-2 text-center md:w-56">
          <Button variant="accent" size="lg" onClick={onSubmit}>
            <Plus aria-hidden /> Submit your work
          </Button>
          <p className="text-xs text-[var(--band-muted-foreground)]">
            {latest ? `${mine.length} submitted · ${SUBMISSION_STATUS_LABEL[latest.status]}` : "Nothing submitted yet"}
          </p>
        </div>
      </div>
    </section>
  );
}

/* ---------------- the sticky bar ---------------- */

function SectionBar({ keys, active, onSubmit }: { keys: BlockKey[]; active: number; onSubmit: () => void }) {
  return (
    <nav aria-label="Lesson sections" className="sticky top-20 z-30 mt-6 flex items-center gap-2 rounded-full border border-border bg-surface/95 p-1.5 shadow-float backdrop-blur">
      <ol className="flex min-w-0 flex-1 gap-0.5 overflow-x-auto [scrollbar-width:none]">
        {keys.map((key, i) => (
          <li key={key} className="shrink-0">
            <a
              href={`#${blockId(key)}`}
              aria-current={i === active ? "location" : undefined}
              className={cn(
                "inline-flex h-8 items-center rounded-full px-2.5 text-[13px] font-medium whitespace-nowrap transition-colors sm:px-3",
                i === active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-hover-surface hover:text-foreground",
              )}
            >
              {/* On a phone the numbers go, so all four fit beside Submit. */}
              <span className="hidden sm:inline">{i + 1} · </span>
              {BLOCK_LABEL[key]}
            </a>
          </li>
        ))}
      </ol>
      <Button variant="accent" size="sm" className="shrink-0" onClick={onSubmit}>
        Submit
      </Button>
    </nav>
  );
}

/** Which block is under the sticky bar, and how many steps have scrolled into view. */
function useScrollPosition(keys: BlockKey[], steps: number): { active: number; stepsReached: number } {
  const [state, setState] = useState({ active: 0, stepsReached: 0 });
  const signature = keys.join(",");
  useEffect(() => {
    const ids = signature.split(",").map((k) => blockId(k as BlockKey));
    let frame = 0;
    const measure = () => {
      frame = 0;
      // The app's header and this bar together are about 9rem tall.
      const line = 170;
      let active = 0;
      ids.forEach((id, i) => {
        const el = document.getElementById(id);
        if (el && el.getBoundingClientRect().top <= line) active = i;
      });
      // At the very bottom the last block cannot reach the line; it is still the one being read.
      const page = document.documentElement.scrollHeight;
      if (page > window.innerHeight && window.innerHeight + window.scrollY >= page - 4) active = ids.length - 1;
      let reached = 0;
      for (let i = 1; i <= steps; i++) {
        const el = document.getElementById(`lesson-step-${i}`);
        if (el && el.getBoundingClientRect().top <= window.innerHeight * 0.6) reached = i;
      }
      setState((prev) => (prev.active === active && prev.stepsReached === reached ? prev : { active, stepsReached: reached }));
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    measure();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [signature, steps]);
  return state;
}

/* ---------------- previous / next ---------------- */

function PrevNext({ nav }: { nav: LessonNav }) {
  return (
    <nav aria-label="Other lessons" className="mt-10 grid gap-4 sm:grid-cols-2">
      {nav.prev ? (
        <Link href={nav.prev.href} className="group rounded-[var(--radius-lg)] border border-border bg-surface p-5 shadow-soft transition-colors hover:bg-hover-surface">
          <span className="flex items-center gap-1 text-[10px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
            <ArrowLeft aria-hidden className="size-3" /> Previous
          </span>
          <span className="mt-1 block font-bold text-foreground">{nav.prev.label}</span>
        </Link>
      ) : (
        <span className="hidden sm:block" />
      )}
      {nav.next ? (
        <Link href={nav.next.href} className="group rounded-[var(--radius-lg)] border border-border bg-surface p-5 text-right shadow-soft transition-colors hover:bg-hover-surface">
          <span className="flex items-center justify-end gap-1 text-[10px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
            Next <ArrowRight aria-hidden className="size-3" />
          </span>
          <span className="mt-1 block font-bold text-foreground">{nav.next.label}</span>
        </Link>
      ) : null}
    </nav>
  );
}

/* ---------------- the submit dialog (unchanged) ---------------- */

function SubmitDialog({
  open,
  onOpenChange,
  lesson,
  onSent,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lesson: TrainingLesson;
  onSent: () => void;
}) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [link, setLink] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Submit your response" description={`For "${lesson.title}". Share what you tried and what came out of it.`}>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            start(async () => {
              const result = await submitLessonResponse({ lessonId: lesson.id, title, body, linkUrl: link });
              if (result.ok) {
                setTitle("");
                setBody("");
                setLink("");
                onSent();
              } else setError(result.message);
            });
          }}
        >
          <div>
            <Label htmlFor="submission-title">Title</Label>
            <Input id="submission-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={lesson.title} maxLength={300} />
          </div>
          <div>
            <Label htmlFor="submission-body">Your response</Label>
            <Textarea
              id="submission-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={8}
              maxLength={20000}
              placeholder="What did you ask the AI to do, what did it produce, and how did you use it?"
            />
          </div>
          <div>
            <Label htmlFor="submission-link">Link (optional)</Label>
            <Input id="submission-link" value={link} onChange={(e) => setLink(e.target.value)} placeholder="https:// — a shared chat, a document, a screenshot" />
          </div>
          <p className="text-xs text-muted-foreground">Only you and the training administrators can see your submission.</p>
          {error ? <p className="text-sm text-status-failed" role="alert">{error}</p> : null}
          <DialogActions>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>Cancel</Button>
            <Button type="submit" variant="accent" disabled={pending}>{pending ? "Sending…" : "Submit"}</Button>
          </DialogActions>
        </form>
      </DialogContent>
    </Dialog>
  );
}
