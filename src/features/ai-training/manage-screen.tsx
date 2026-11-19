"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { ArrowDown, ArrowLeft, ArrowUp, Eye, EyeOff, Pencil, Plus, Trash2, Upload } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CheckboxField, SegmentedControl, Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/controls";
import { EmptyState, Notice } from "@/components/ui/feedback";
import { Input, Label, Select, Textarea } from "@/components/ui/field";
import { PageHeader, PageShell } from "@/components/ui/layout";
import { groupTrackLessons } from "@/lib/ai-training/catalog";
import { parseImportFiles, type ParsedImport } from "@/lib/ai-training/import";
import {
  SUBMISSION_STATUS_LABEL,
  TRAINING_PAGE_KEYS,
  TRAINING_PAGE_LABEL,
  type SubmissionStatus,
  type TrainingCatalog,
  type TrainingPage,
  type TrainingSubmission,
} from "@/lib/ai-training/types";

import {
  addTrackAction,
  deleteLessonAction,
  importTableAction,
  moveLessonAction,
  reviewSubmissionAction,
  saveModuleAction,
  savePageAction,
  setLessonStatusAction,
  type ActionResult,
} from "./actions";
import { ModuleTitle } from "./module-title";
import { STATUS_TONE, SubmissionBody, formatWhen } from "./submission-list";
import { TrainingMarkdown } from "./training-markdown";

export interface ManageData {
  catalog: TrainingCatalog;
  pages: TrainingPage[];
  submissions: TrainingSubmission[];
}

/** Runs a Server Function, shows its failure, and refreshes the page's data on success. */
function useRun() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  function run<T>(work: () => Promise<ActionResult<T>>, after?: (value: T | undefined) => void) {
    setError(null);
    start(async () => {
      const result = await work();
      if (!result.ok) setError(result.message);
      else {
        after?.(result.value);
        router.refresh();
      }
    });
  }
  return { pending, error, run };
}

export function ManageScreen({ problem, data }: { problem: string | null; data: ManageData | null }) {
  const waiting = data?.submissions.filter((s) => s.status === "pending").length ?? 0;
  return (
    <PageShell className="max-w-[1100px]">
      <Link href="/ai-training" className="mb-4 inline-flex items-center gap-1 text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase hover:text-foreground">
        <ArrowLeft aria-hidden className="size-3.5" /> AI Training
      </Link>
      <PageHeader title="Manage AI Training" description="Lessons, the program's pages, and staff submissions. Only administrators see this screen." />
      {problem || !data ? (
        <Notice tone="attention" title="AI Training is unavailable">{problem ?? "Nothing to show."}</Notice>
      ) : (
        <Tabs defaultValue={data.catalog.tracks.length ? "lessons" : "import"}>
          <TabsList aria-label="Manage sections">
            <TabsTrigger value="lessons">Lessons</TabsTrigger>
            <TabsTrigger value="pages">Pages</TabsTrigger>
            <TabsTrigger value="submissions">Submissions{waiting ? ` (${waiting} to review)` : ""}</TabsTrigger>
            <TabsTrigger value="import">Import</TabsTrigger>
          </TabsList>
          <TabsContent value="lessons"><LessonsTab catalog={data.catalog} /></TabsContent>
          <TabsContent value="pages"><PagesTab pages={data.pages} /></TabsContent>
          <TabsContent value="submissions"><SubmissionsTab submissions={data.submissions} /></TabsContent>
          <TabsContent value="import"><ImportTab /></TabsContent>
        </Tabs>
      )}
    </PageShell>
  );
}

/* ---------------- lessons ---------------- */

function LessonsTab({ catalog }: { catalog: TrainingCatalog }) {
  const [trackId, setTrackId] = useState(catalog.tracks[0]?.id ?? "");
  const track = catalog.tracks.find((t) => t.id === trackId) ?? catalog.tracks[0];
  const groups = useMemo(() => (track ? groupTrackLessons(catalog, track.id) : []), [catalog, track]);
  const modules = catalog.modules.filter((m) => m.trackId === track?.id).sort((a, b) => a.sortOrder - b.sortOrder);
  const { pending, error, run } = useRun();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        {catalog.tracks.length ? (
          <SegmentedControl
            value={track?.id ?? ""}
            onValueChange={setTrackId}
            ariaLabel="Track"
            options={catalog.tracks.map((t) => ({ value: t.id, label: t.title }))}
          />
        ) : (
          <p className="text-sm text-muted-foreground">No tracks yet. Import the content, or add a track.</p>
        )}
        <div className="flex flex-wrap gap-2">
          <AddTrack />
          {track ? (
            <Button asChild>
              <Link href={`/ai-training/manage/lessons/new?track=${track.id}`}>
                <Plus aria-hidden /> New lesson
              </Link>
            </Button>
          ) : null}
        </div>
      </div>
      {error ? <p className="text-sm text-status-failed" role="alert">{error}</p> : null}

      {track ? <Modules trackId={track.id} modules={modules} /> : null}

      {track ? (
        groups.length ? (
          groups.map((group) => (
            <section key={group.id}>
              <h3 className="mb-2 text-base font-semibold text-foreground">
                {group.module ? <ModuleTitle title={group.module.title} /> : "Not in a module"}
                {group.module?.adminOnly ? <span className="ml-2 text-xs font-normal text-muted-foreground">(admins only)</span> : null}
              </h3>
              <Card className="divide-y divide-border">
                {group.lessons.map((lesson, i) => (
                  <div key={lesson.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <Link href={`/ai-training/${track.slug}/${lesson.slug}`} className="font-medium break-words text-foreground hover:underline">
                        {lesson.title}
                      </Link>
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        {lesson.weekNumber != null ? <Badge tone="accent">Lesson {lesson.weekNumber}</Badge> : null}
                        <Badge tone={lesson.status === "published" ? "ready" : "neutral"}>{lesson.status === "published" ? "Published" : "Draft"}</Badge>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="iconSm" aria-label="Move up" disabled={pending || i === 0} onClick={() => run(() => moveLessonAction(lesson.id, "up"))}>
                        <ArrowUp aria-hidden />
                      </Button>
                      <Button variant="ghost" size="iconSm" aria-label="Move down" disabled={pending || i === group.lessons.length - 1} onClick={() => run(() => moveLessonAction(lesson.id, "down"))}>
                        <ArrowDown aria-hidden />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={pending}
                        onClick={() => run(() => setLessonStatusAction(lesson.id, lesson.status === "published" ? "draft" : "published"))}
                      >
                        {lesson.status === "published" ? <><EyeOff aria-hidden /> Unpublish</> : <><Eye aria-hidden /> Publish</>}
                      </Button>
                      <Button asChild variant="ghost" size="sm">
                        <Link href={`/ai-training/manage/lessons/${lesson.id}`}><Pencil aria-hidden /> Edit</Link>
                      </Button>
                      <Button
                        variant="ghost"
                        size="iconSm"
                        aria-label={`Delete ${lesson.title}`}
                        disabled={pending}
                        onClick={() => {
                          if (window.confirm(`Delete "${lesson.title}"? Submissions to it are kept but lose their link to the lesson.`)) run(() => deleteLessonAction(lesson.id));
                        }}
                      >
                        <Trash2 aria-hidden />
                      </Button>
                    </div>
                  </div>
                ))}
              </Card>
            </section>
          ))
        ) : (
          <EmptyState compact title="No lessons in this track yet" description="Add one with New lesson." />
        )
      ) : null}
    </div>
  );
}

function AddTrack() {
  const [title, setTitle] = useState("");
  const [open, setOpen] = useState(false);
  const { pending, error, run } = useRun();
  if (!open) {
    return (
      <Button variant="secondary" onClick={() => setOpen(true)}>
        <Plus aria-hidden /> Add track
      </Button>
    );
  }
  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => addTrackAction(title), () => {
          setTitle("");
          setOpen(false);
        });
      }}
    >
      <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Track name, e.g. Claude Training" aria-label="Track name" className="w-64" />
      <Button type="submit" disabled={pending || !title.trim()}>Add</Button>
      <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
      {error ? <p className="w-full text-sm text-status-failed" role="alert">{error}</p> : null}
    </form>
  );
}

function Modules({ trackId, modules }: { trackId: string; modules: TrainingCatalog["modules"] }) {
  const [title, setTitle] = useState("");
  const [adminOnly, setAdminOnly] = useState(false);
  const { pending, error, run } = useRun();
  return (
    <section>
      <h3 className="mb-2 text-base font-semibold text-foreground">Modules in this track</h3>
      <Card className="space-y-3 p-4">
        {modules.length ? (
          <ul className="space-y-2">
            {modules.map((m) => (
              <ModuleRow key={m.id} module={m} />
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">No modules. Lessons are listed by lesson number.</p>
        )}
        <form
          className="flex flex-wrap items-center gap-2 border-t border-border pt-3"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => saveModuleAction({ id: null, trackId, title, adminOnly }), () => {
              setTitle("");
              setAdminOnly(false);
            });
          }}
        >
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="New module, e.g. Module 4: Writing with AI" aria-label="New module name" className="min-w-64 flex-1" />
          <CheckboxField id={`new-module-admin-${trackId}`} label="Admins only (archive)" checked={adminOnly} onCheckedChange={setAdminOnly} />
          <Button type="submit" variant="secondary" disabled={pending || !title.trim()}>Add module</Button>
        </form>
        {error ? <p className="text-sm text-status-failed" role="alert">{error}</p> : null}
      </Card>
    </section>
  );
}

function ModuleRow({ module }: { module: TrainingCatalog["modules"][number] }) {
  const [title, setTitle] = useState(module.title);
  const [adminOnly, setAdminOnly] = useState(module.adminOnly);
  const { pending, error, run } = useRun();
  const changed = title.trim() !== module.title || adminOnly !== module.adminOnly;
  return (
    <li>
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          run(() => saveModuleAction({ id: module.id, trackId: module.trackId, title, adminOnly }));
        }}
      >
        <Input value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Module name" className="min-w-64 flex-1" />
        <CheckboxField id={`module-admin-${module.id}`} label="Admins only" checked={adminOnly} onCheckedChange={setAdminOnly} />
        <Button type="submit" variant="ghost" size="sm" disabled={pending || !changed}>Save</Button>
      </form>
      {error ? <p className="text-sm text-status-failed" role="alert">{error}</p> : null}
    </li>
  );
}

/* ---------------- pages ---------------- */

function PagesTab({ pages }: { pages: TrainingPage[] }) {
  const keys = [...TRAINING_PAGE_KEYS, ...pages.map((p) => p.key).filter((k) => !(TRAINING_PAGE_KEYS as readonly string[]).includes(k))];
  const [key, setKey] = useState<string>(keys[0]);
  const current = pages.find((p) => p.key === key);
  return (
    <div className="space-y-4">
      <div className="max-w-sm">
        <Label htmlFor="page-key">Page</Label>
        <Select id="page-key" value={key} onChange={(e) => setKey(e.target.value)}>
          {keys.map((k) => (
            <option key={k} value={k}>
              {(TRAINING_PAGE_LABEL as Record<string, string>)[k] ?? pages.find((p) => p.key === k)?.title ?? k}
            </option>
          ))}
        </Select>
        <p className="mt-1 text-xs text-muted-foreground">
          The Announcement shows at the top of AI Training. The Welcome text is kept from the old app and is not shown.
        </p>
      </div>
      <PageEditor key={key} pageKey={key} page={current} />
    </div>
  );
}

function PageEditor({ pageKey, page }: { pageKey: string; page: TrainingPage | undefined }) {
  const [title, setTitle] = useState(page?.title ?? (TRAINING_PAGE_LABEL as Record<string, string>)[pageKey] ?? pageKey);
  const [body, setBody] = useState(page?.bodyMd ?? "");
  const [saved, setSaved] = useState(false);
  const { pending, error, run } = useRun();
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        setSaved(false);
        run(() => savePageAction({ key: pageKey, title, bodyMd: body }), () => setSaved(true));
      }}
    >
      <div className="max-w-md">
        <Label htmlFor="page-title">Title</Label>
        <Input id="page-title" value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>
      <MarkdownSplit value={body} onChange={setBody} label="Page content (Notion-style markdown)" />
      {error ? <p className="text-sm text-status-failed" role="alert">{error}</p> : null}
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save page"}</Button>
        {saved ? <span className="text-sm text-muted-foreground">Saved.</span> : null}
      </div>
    </form>
  );
}

/** Markdown on the left, the rendered result on the right. */
export function MarkdownSplit({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div>
        <Label htmlFor="markdown-editor">{label}</Label>
        <Textarea id="markdown-editor" value={value} onChange={(e) => onChange(e.target.value)} className="mt-1 h-[60vh] font-mono text-xs leading-5" spellCheck={false} />
      </div>
      <div>
        <p className="text-[13px] font-medium text-foreground">Preview</p>
        <div className="mt-1 h-[60vh] overflow-y-auto rounded-[var(--radius-sm)] border border-border bg-surface p-5">
          <TrainingMarkdown md={value} promptCopies />
        </div>
      </div>
    </div>
  );
}

/* ---------------- submissions ---------------- */

function SubmissionsTab({ submissions }: { submissions: TrainingSubmission[] }) {
  const [filter, setFilter] = useState<SubmissionStatus | "all">("pending");
  const shown = submissions.filter((s) => filter === "all" || s.status === filter);
  return (
    <div className="space-y-4">
      <SegmentedControl
        value={filter}
        onValueChange={(v) => setFilter(v as SubmissionStatus | "all")}
        ariaLabel="Show submissions"
        options={[
          { value: "pending", label: `To review (${submissions.filter((s) => s.status === "pending").length})` },
          { value: "changes_requested", label: "Changes requested" },
          { value: "approved", label: "Approved" },
          { value: "all", label: "All" },
        ]}
      />
      {shown.length ? (
        shown.map((s) => <ReviewCard key={s.id} submission={s} />)
      ) : (
        <EmptyState compact title="Nothing here" description="No submissions match this filter." />
      )}
    </div>
  );
}

function ReviewCard({ submission }: { submission: TrainingSubmission }) {
  const [feedback, setFeedback] = useState(submission.feedback);
  const { pending, error, run } = useRun();
  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">
            {submission.userName || "Unknown"} · {formatWhen(submission.createdAt)}
          </p>
          <p className="mt-0.5 font-semibold break-words text-foreground">{submission.title}</p>
          {submission.lessonTitle ? (
            <p className="mt-0.5 text-sm text-muted-foreground">
              Lesson: {submission.lessonHref ? <Link href={submission.lessonHref} className="underline underline-offset-2">{submission.lessonTitle}</Link> : submission.lessonTitle}
            </p>
          ) : null}
        </div>
        <Badge tone={STATUS_TONE[submission.status]}>{SUBMISSION_STATUS_LABEL[submission.status]}</Badge>
      </div>
      <SubmissionBody submission={{ ...submission, feedback: "" }} />
      <div className="mt-4 space-y-2 border-t border-border pt-3">
        <Label htmlFor={`fb-${submission.id}`}>Feedback</Label>
        <Textarea id={`fb-${submission.id}`} value={feedback} onChange={(e) => setFeedback(e.target.value)} rows={3} maxLength={10000} placeholder="Optional for approval; say what to change when requesting changes." />
        {error ? <p className="text-sm text-status-failed" role="alert">{error}</p> : null}
        <div className="flex flex-wrap gap-2">
          <Button variant="accent" size="sm" disabled={pending} onClick={() => run(() => reviewSubmissionAction({ id: submission.id, status: "approved", feedback }))}>Approve</Button>
          <Button variant="secondary" size="sm" disabled={pending || !feedback.trim()} onClick={() => run(() => reviewSubmissionAction({ id: submission.id, status: "changes_requested", feedback }))}>Request changes</Button>
          {submission.status !== "pending" ? (
            <Button variant="ghost" size="sm" disabled={pending} onClick={() => run(() => reviewSubmissionAction({ id: submission.id, status: "pending", feedback }))}>Back to review</Button>
          ) : null}
        </div>
        {submission.reviewedByName && submission.reviewedAt ? (
          <p className="text-xs text-muted-foreground">Last reviewed by {submission.reviewedByName}, {formatWhen(submission.reviewedAt)}</p>
        ) : null}
      </div>
    </Card>
  );
}

/* ---------------- import ---------------- */

const BATCH = 10;

function ImportTab() {
  const router = useRouter();
  const [parsed, setParsed] = useState<ParsedImport | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function readFiles(list: FileList | null) {
    setError(null);
    setStatus(null);
    if (!list?.length) return;
    const files = await Promise.all([...list].map(async (f) => ({ name: f.name, text: await f.text() })));
    setParsed(parseImportFiles(files));
  }

  async function runImport() {
    if (!parsed) return;
    setBusy(true);
    setError(null);
    const done: string[] = [];
    // Parents before children: tracks, then modules, then lessons. Small batches keep each request well under the size limit.
    for (const table of ["tracks", "modules", "lessons", "pages"] as const) {
      const rows = parsed[table];
      for (let i = 0; i < rows.length; i += BATCH) {
        setStatus(`Importing ${table}… ${Math.min(i + BATCH, rows.length)} of ${rows.length}`);
        const result = await importTableAction(table, rows.slice(i, i + BATCH));
        if (!result.ok) {
          setError(`Stopped while importing ${table}: ${result.message}`);
          setBusy(false);
          setStatus(done.length ? `Imported so far: ${done.join(", ")}.` : null);
          router.refresh();
          return;
        }
      }
      if (rows.length) done.push(`${rows.length} ${table}`);
    }
    setBusy(false);
    setStatus(`Imported ${done.join(", ") || "nothing"}. Importing the same export again updates these rows rather than duplicating them.`);
    setParsed(null);
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <Notice tone="neutral" title="Bring over the old JBA AI Training content">
        In Lovable, open the training app, then More → Database, and export the <strong>tracks</strong>, <strong>modules</strong>, <strong>lessons</strong> and{" "}
        <strong>content_pages</strong> tables as CSV (or one JSON file holding all four). Choose all the files here at once.
      </Notice>
      <div>
        <Label htmlFor="import-files">Export files</Label>
        <Input id="import-files" type="file" multiple accept=".csv,.json,text/csv,application/json" onChange={(e) => readFiles(e.target.files)} className="h-auto py-2" disabled={busy} />
      </div>
      {parsed ? (
        <Card className="space-y-3 p-5">
          <p className="text-sm text-foreground">
            Ready to import <strong>{parsed.tracks.length}</strong> tracks, <strong>{parsed.modules.length}</strong> modules,{" "}
            <strong>{parsed.lessons.length}</strong> lessons and <strong>{parsed.pages.length}</strong> pages.
          </p>
          {parsed.problems.length ? (
            <ul className="list-disc space-y-1 pl-5 text-sm text-status-attention">
              {parsed.problems.slice(0, 20).map((p, i) => <li key={i}>{p}</li>)}
              {parsed.problems.length > 20 ? <li>…and {parsed.problems.length - 20} more.</li> : null}
            </ul>
          ) : null}
          <Button onClick={runImport} disabled={busy || !(parsed.tracks.length + parsed.modules.length + parsed.lessons.length + parsed.pages.length)}>
            <Upload aria-hidden /> {busy ? "Importing…" : "Import"}
          </Button>
        </Card>
      ) : null}
      {status ? <p className="text-sm text-muted-foreground" role="status">{status}</p> : null}
      {error ? <p className="text-sm text-status-failed" role="alert">{error}</p> : null}
    </div>
  );
}
