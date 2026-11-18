"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { ArrowLeft, Pencil, Plus } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState, Notice } from "@/components/ui/feedback";
import { Input, Label, Textarea } from "@/components/ui/field";
import { PageShell } from "@/components/ui/layout";
import { Dialog, DialogActions, DialogContent } from "@/components/ui/overlays";
import type { TrainingLesson, TrainingModule, TrainingSubmission, TrainingTrack } from "@/lib/ai-training/types";

import { submitLessonResponse } from "./actions";
import { ModuleTitle } from "./module-title";
import { SubmissionList } from "./submission-list";
import { TrainingMarkdown } from "./training-markdown";

export function LessonScreen({
  problem,
  view,
  mine,
  isAdmin,
}: {
  problem: string | null;
  view: { lesson: TrainingLesson; track: TrainingTrack; module: TrainingModule | null } | null;
  mine: TrainingSubmission[];
  isAdmin: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState(false);
  const back = view ? `/ai-training?track=${view.track.slug}` : "/ai-training";

  return (
    <PageShell className="max-w-[900px]">
      <Link href={back} className="mb-6 inline-flex items-center gap-1 text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase hover:text-foreground">
        <ArrowLeft aria-hidden className="size-3.5" /> All training
      </Link>

      {problem ? (
        <Notice tone="attention" title="This lesson could not be loaded">{problem}</Notice>
      ) : !view ? (
        <EmptyState title="Lesson not found" description="It may have been unpublished or moved." action={<Button asChild variant="secondary"><Link href="/ai-training">Back to AI Training</Link></Button>} />
      ) : (
        <>
          <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-xs text-muted-foreground">
                <span className="font-semibold tracking-[0.14em] uppercase">{view.track.title}</span>
                {view.module ? (
                  <>
                    <span aria-hidden>·</span>
                    <ModuleTitle title={view.module.title} />
                  </>
                ) : null}
                {view.lesson.weekNumber != null ? <Badge tone="accent">Lesson {view.lesson.weekNumber}</Badge> : null}
                {view.lesson.status !== "published" ? <Badge>Draft</Badge> : null}
              </div>
              <h1 className="display mt-3 text-[28px] break-words text-foreground sm:text-[36px]">{view.lesson.title}</h1>
              {view.lesson.summary ? <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{view.lesson.summary}</p> : null}
            </div>
            <div className="flex shrink-0 gap-2">
              {isAdmin ? (
                <Button asChild variant="secondary">
                  <Link href={`/ai-training/manage/lessons/${view.lesson.id}`}>
                    <Pencil aria-hidden /> Edit
                  </Link>
                </Button>
              ) : null}
              <Button variant="accent" size="lg" onClick={() => setOpen(true)}>
                <Plus aria-hidden /> Submit
              </Button>
            </div>
          </header>

          {sent ? (
            <Notice tone="primary" className="mt-6">Thanks — your submission was sent for review. You can see it below and under My submissions.</Notice>
          ) : null}

          <Card className="mt-6 p-6 sm:p-8">
            <TrainingMarkdown md={view.lesson.bodyMd} promptCopies />
          </Card>

          <section className="mt-10">
            <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
              <h2 className="text-xl font-semibold text-foreground">Your submissions</h2>
              <Button variant="secondary" onClick={() => setOpen(true)}>
                <Plus aria-hidden /> Submit a response
              </Button>
            </div>
            {mine.length ? (
              <SubmissionList submissions={mine} />
            ) : (
              <EmptyState compact title="Nothing submitted yet" description="When you have tried this lesson, press Submit to share what you made." />
            )}
          </section>

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
