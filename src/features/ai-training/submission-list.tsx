"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { ExternalLink, Pencil } from "lucide-react";

import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Label, Textarea } from "@/components/ui/field";
import { SUBMISSION_STATUS_LABEL, type SubmissionStatus, type TrainingSubmission } from "@/lib/ai-training/types";

import { editMySubmission } from "./actions";

export const STATUS_TONE: Record<SubmissionStatus, BadgeTone> = {
  pending: "neutral",
  approved: "ready",
  changes_requested: "attention",
};

export function formatWhen(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" }) + " CT";
}

/** The reader's own submissions, with their review. Editable until approved. */
export function SubmissionList({ submissions, showLesson = false }: { submissions: TrainingSubmission[]; showLesson?: boolean }) {
  return (
    <div className="space-y-3">
      {submissions.map((submission) => (
        <OwnSubmission key={submission.id} submission={submission} showLesson={showLesson} />
      ))}
    </div>
  );
}

function OwnSubmission({ submission, showLesson }: { submission: TrainingSubmission; showLesson: boolean }) {
  const [editing, setEditing] = useState(false);
  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">{formatWhen(submission.createdAt)}</p>
          <p className="mt-0.5 font-semibold break-words text-foreground">{submission.title}</p>
          {showLesson && submission.lessonTitle ? (
            <p className="mt-0.5 text-sm text-muted-foreground">
              Lesson:{" "}
              {submission.lessonHref ? (
                <Link href={submission.lessonHref} className="underline underline-offset-2">
                  {submission.lessonTitle}
                </Link>
              ) : (
                submission.lessonTitle
              )}
            </p>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <Badge tone={STATUS_TONE[submission.status]}>{SUBMISSION_STATUS_LABEL[submission.status]}</Badge>
          {submission.status !== "approved" && !editing ? (
            <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
              <Pencil aria-hidden /> Edit
            </Button>
          ) : null}
        </div>
      </div>
      {editing ? (
        <EditForm submission={submission} onDone={() => setEditing(false)} />
      ) : (
        <SubmissionBody submission={submission} />
      )}
    </Card>
  );
}

export function SubmissionBody({ submission }: { submission: TrainingSubmission }) {
  return (
    <>
      {submission.body ? <p className="mt-3 text-sm whitespace-pre-wrap break-words text-body-foreground">{submission.body}</p> : null}
      {submission.linkUrl ? (
        <a href={submission.linkUrl} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-sm break-all underline underline-offset-2">
          {submission.linkUrl} <ExternalLink aria-hidden className="size-3.5 shrink-0" />
        </a>
      ) : null}
      {submission.feedback ? (
        <div className="mt-3 rounded-[var(--radius-md)] bg-surface-muted p-3 text-sm">
          <p className="text-xs font-semibold text-muted-foreground">
            Feedback{submission.reviewedByName ? ` from ${submission.reviewedByName}` : ""}
          </p>
          <p className="mt-1 whitespace-pre-wrap text-body-foreground">{submission.feedback}</p>
        </div>
      ) : null}
    </>
  );
}

function EditForm({ submission, onDone }: { submission: TrainingSubmission; onDone: () => void }) {
  const [title, setTitle] = useState(submission.title);
  const [body, setBody] = useState(submission.body);
  const [link, setLink] = useState(submission.linkUrl ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      className="mt-3 space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const result = await editMySubmission({ id: submission.id, title, body, linkUrl: link });
          if (result.ok) onDone();
          else setError(result.message);
        });
      }}
    >
      <div>
        <Label htmlFor={`t-${submission.id}`}>Title</Label>
        <Input id={`t-${submission.id}`} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={300} />
      </div>
      <div>
        <Label htmlFor={`b-${submission.id}`}>Your response</Label>
        <Textarea id={`b-${submission.id}`} value={body} onChange={(e) => setBody(e.target.value)} rows={6} maxLength={20000} />
      </div>
      <div>
        <Label htmlFor={`l-${submission.id}`}>Link (optional)</Label>
        <Input id={`l-${submission.id}`} value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://" />
      </div>
      {error ? <p className="text-sm text-status-failed" role="alert">{error}</p> : null}
      <p className="text-xs text-muted-foreground">Saving sends it back for review.</p>
      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save"}</Button>
        <Button type="button" variant="ghost" onClick={onDone} disabled={pending}>Cancel</Button>
      </div>
    </form>
  );
}
