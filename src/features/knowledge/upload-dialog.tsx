"use client";

import { useCallback, useRef, useState } from "react";
import { CheckCircle2, FileUp, Info, RotateCcw, TriangleAlert, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FieldGroup, Input, Select, Textarea } from "@/components/ui/field";
import { Notice } from "@/components/ui/feedback";
import { DialogActions } from "@/components/ui/overlays";
import { KNOWLEDGE_CATEGORIES } from "@/data/demo/knowledge";
import { DEMO_PROCESSING_MS, demoProcessingOutcome } from "./lifecycle-service";
import {
  precheckFile,
  uploadManyToKnowledgeBase,
  uploadsAreLive,
  type BulkUploadFile,
} from "./upload-service";
import { useSession } from "@/lib/session/session-context";
import { useAppStore } from "@/lib/store/app-store";
import { nowIso } from "@/lib/utils/date";
import { cn } from "@/lib/utils/cn";
import {
  FILE_TYPE_LABEL,
  estimateCharacterCount,
  fileTypeFromName,
  formatBytes,
} from "@/lib/utils/format";
import { createId } from "@/lib/utils/id";
import type { KnowledgeCategory, KnowledgeDocument } from "@/types";

const MAX_BYTES = 50 * 1024 * 1024;

/**
 * Demo mode keeps the prototype's wide accept list — nothing is parsed, so any
 * document can be filed. Live mode accepts only what the ingestion pipeline can
 * actually extract text from, because "uploaded" must mean "searchable".
 */
const ACCEPTED_DEMO =
  ".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.md,.ppt,.pptx,.png,.jpg,.jpeg";
const ACCEPTED_LIVE = ".pdf,.docx,.txt,.md";

/**
 * HOW MANY FILES ONE BATCH MAY HOLD.
 *
 * Not a technical ceiling — the runner is sequential and would happily walk a
 * hundred. It is a guard against the accident: selecting an entire Downloads
 * folder, or dropping a directory, and committing to an hour of indexing
 * without meaning to. The reader can run a second batch, and the message says
 * so rather than silently truncating the selection.
 */
const MAX_BATCH = 25;

/**
 * =============================================================================
 * UPLOADING DOCUMENTS — ONE, OR A FOLDER OF THEM
 * =============================================================================
 *
 * REQUESTED: bulk upload. The dialog took exactly one file: no `multiple` on the
 * input, and both the picker and the drop handler read `files[0]` and discarded
 * the rest — so dropping eight policies filed one and silently dropped seven.
 *
 * WHAT A BATCH SHARES, AND WHAT IT DOES NOT:
 *
 *   PER FILE — the title. This is the important one. Uploading a document whose
 *   title already exists creates a NEW VERSION and supersedes the old one, so a
 *   batch that derived one title for all of them would quietly overwrite
 *   documents. Each file's title comes from its own filename, exactly as the
 *   single-file flow already derived it, and each is editable in the queue.
 *
 *   SHARED — the category and the tags. Filing a folder of policies means
 *   filing them all under Policies, and typing that eight times is the work
 *   this change exists to remove.
 *
 *   SINGLE-FILE ONLY — the description. It is one line about what THIS document
 *   covers, so applying one sentence to eight different documents would write
 *   something false into eight records. The field appears for a single file and
 *   is replaced by a note for a batch; descriptions can be edited per document
 *   afterwards.
 *
 * SEQUENTIAL, AND ONE FAILURE DOES NOT ABORT THE REST. See
 * `uploadManyToKnowledgeBase`. Each file reports its own outcome as it lands,
 * a rate limit is waited out rather than treated as a failure, and a corrupt
 * PDF in position three does not cost the reader files four through twenty.
 *
 * NOTHING ABOUT THE SERVER CHANGED. Still one file per request, so every
 * validation, permission check and ingestion step is exactly where it was.
 */

/** A queued file and where it has got to. */
interface QueueItem {
  readonly key: string;
  readonly file: File;
  title: string;
  status: "queued" | "uploading" | "waiting" | "done" | "failed";
  /** Set on `failed`, and shown against the row rather than as a page error. */
  message?: string;
}

export function UploadDialog({
  defaultCategory,
  onDone,
}: {
  defaultCategory?: KnowledgeCategory;
  onDone: () => void;
}) {
  const { user } = useSession();
  const { addDocument, updateDocument, storageAvailable } = useAppStore();
  const inputRef = useRef<HTMLInputElement>(null);
  const live = uploadsAreLive();

  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<KnowledgeCategory>(
    defaultCategory ?? "operations",
  );
  const [tags, setTags] = useState("");
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  /** True once a run has finished, so the dialog can report and offer a retry. */
  const [ran, setRan] = useState(false);

  const patch = useCallback((key: string, next: Partial<QueueItem>) => {
    setQueue((current) =>
      current.map((item) => (item.key === key ? { ...item, ...next } : item)),
    );
  }, []);

  /**
   * Adds a selection to the queue.
   *
   * REJECTIONS ARE PER FILE AND THE REST STILL QUEUE. Dropping a folder that
   * contains one .pages file should file the other seven documents and say what
   * it skipped — refusing the whole selection over one bad member is the
   * behaviour that makes people upload one at a time.
   *
   * ALREADY-QUEUED FILES ARE NOT ADDED TWICE. Dropping the same set again is an
   * easy accident, and a duplicate in the queue means the same document indexed
   * twice — which for a title-versioned library means it supersedes itself.
   */
  const accept = useCallback(
    (incoming: FileList | null) => {
      const chosen = Array.from(incoming ?? []);
      if (chosen.length === 0) return;

      const problems: string[] = [];
      const additions: QueueItem[] = [];

      setQueue((current) => {
        const seen = new Set(
          current.map((item) => `${item.file.name}:${item.file.size}`),
        );
        let room = MAX_BATCH - current.length;

        for (const file of chosen) {
          const identity = `${file.name}:${file.size}`;
          if (seen.has(identity)) continue;

          const problem = live
            ? precheckFile(file)
            : file.size > MAX_BYTES
              ? `${file.name} is ${formatBytes(file.size)}. The limit is 50 MB per file.`
              : null;

          if (problem) {
            problems.push(problem);
            continue;
          }

          if (room <= 0) {
            problems.push(
              `Only ${MAX_BATCH} files can be uploaded at once. ${file.name} and anything after it were not added — upload them as a second batch.`,
            );
            break;
          }

          seen.add(identity);
          room -= 1;
          additions.push({
            key: createId("q"),
            file,
            title: file.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " "),
            status: "queued",
          });
        }

        return [...current, ...additions];
      });

      setError(problems.length > 0 ? problems.join(" ") : null);
      // A fresh selection after a run is a new batch, not a continuation.
      setRan(false);
    },
    [live],
  );

  /** Files still worth sending: never re-uploads one that already succeeded. */
  const pending = queue.filter((item) => item.status !== "done");
  const ready = pending.every((item) => item.title.trim().length > 0);
  const done = queue.filter((item) => item.status === "done").length;
  const failed = queue.filter((item) => item.status === "failed").length;
  const single = queue.length === 1;

  const handleSubmit = async () => {
    if (pending.length === 0 || !ready) return;
    setSaving(true);
    setError(null);

    const parsedTags = tags
      .split(",")
      .map((tag) => tag.trim().toLowerCase())
      .filter(Boolean);

    // Reset anything that failed on a previous run so a retry reads as a retry.
    for (const item of pending) patch(item.key, { status: "queued", message: undefined });

    /* ---------------------------------------------------------- live -- */
    if (live) {
      const files: BulkUploadFile[] = pending.map((item) => ({
        key: item.key,
        file: item.file,
        title: item.title.trim(),
      }));

      await uploadManyToKnowledgeBase(
        files,
        {
          // A batch writes no shared description — see the header.
          description: single ? description.trim() : "",
          category,
          tags: parsedTags,
          uploadedBy: user.name,
        },
        (event) => {
          if (event.kind === "started") {
            patch(event.key, { status: "uploading" });
          } else if (event.kind === "waiting") {
            patch(event.key, { status: "waiting" });
          } else if (event.kind === "done") {
            patch(event.key, { status: "done" });
            /*
             * ADDED AS EACH ONE LANDS, not in a batch at the end. The document
             * the server returns is already indexed, so the library should show
             * it — and if the tab is closed mid-batch what was indexed is still
             * on screen rather than lost from the UI.
             */
            void addDocument(event.outcome.document);
          } else {
            patch(event.key, { status: "failed", message: event.message });
          }
        },
      );

      setSaving(false);
      setRan(true);
      return;
    }

    /* ---------------------------------------------------------- demo -- */
    for (const item of pending) {
      patch(item.key, { status: "uploading" });

      const id = createId("kb");
      const blobKey = `doc-${id}`;
      const now = nowIso();

      const document: KnowledgeDocument = {
        id,
        title: item.title.trim(),
        description:
          (single ? description.trim() : "") ||
          "Uploaded through the Ask Sunny knowledge library.",
        category,
        fileName: item.file.name,
        fileType: fileTypeFromName(item.file.name),
        sizeBytes: item.file.size,
        characterCount: estimateCharacterCount(item.file.size),
        status: "processing",
        source: "upload",
        version: 1,
        previousVersions: [],
        uploadedBy: user.name,
        uploadedAt: now,
        updatedAt: now,
        indexed: false,
        tags: parsedTags,
        blobKey,
      };

      await addDocument(document, item.file);
      patch(item.key, { status: "done" });

      // Stand-in for ingestion completing. Deterministic rather than always
      // succeeding: a title containing "[fail]" lands in the failed state, so
      // the failure and retry path can be demonstrated on demand instead of
      // only being reachable when a real service breaks.
      window.setTimeout(() => {
        updateDocument(id, {
          ...demoProcessingOutcome(document),
          updatedAt: nowIso(),
        });
      }, DEMO_PROCESSING_MS);
    }

    setSaving(false);
    setRan(true);
  };

  /*
   * A FINISHED RUN WITH NOTHING LEFT TO SEND CLOSES ON THE READER'S WORD, not
   * automatically. A batch where two of eight failed has something to read, and
   * closing over it would hide which two.
   */
  const allSucceeded = ran && failed === 0 && queue.length > 0;

  return (
    <div>
      {!storageAvailable ? (
        <Notice tone="attention" icon={<Info />} className="mb-4">
          Browser storage is unavailable, so these uploads will not survive a
          page refresh. Everything else still works.
        </Notice>
      ) : null}

      {/* Drop zone */}
      <div
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          accept(event.dataTransfer.files);
        }}
        className={cn(
          "rounded-[var(--radius-lg)] border-2 border-dashed p-6 text-center transition-colors",
          dragging
            ? "border-primary bg-primary-soft"
            : "border-border-strong bg-surface-muted",
        )}
      >
        <input
          ref={inputRef}
          type="file"
          /* THE WHOLE POINT: the picker takes a selection, not a file. */
          multiple
          accept={live ? ACCEPTED_LIVE : ACCEPTED_DEMO}
          className="sr-only"
          id="knowledge-file"
          onChange={(event) => {
            accept(event.target.files);
            /*
             * CLEARED SO THE SAME FILE CAN BE PICKED AGAIN. Without this, a
             * reader who removes a file from the queue and re-picks it gets no
             * `change` event, because the input's value has not altered.
             */
            event.target.value = "";
          }}
        />

        <span className="mx-auto mb-3 flex size-10 items-center justify-center rounded-full bg-surface text-muted-foreground">
          <FileUp className="size-4" aria-hidden />
        </span>
        <p className="text-[13px] font-medium text-foreground">
          Drag documents here, or
        </p>
        <Button
          variant="secondary"
          size="sm"
          className="mt-2.5"
          onClick={() => inputRef.current?.click()}
        >
          {queue.length > 0 ? "Add more files" : "Choose files"}
        </Button>
        <p className="mt-3 text-xs text-muted-foreground">
          {live
            ? "PDF, Word (.docx), text or Markdown · 50 MB per file"
            : "PDF, Word, Excel, PowerPoint, text, Markdown or images · 50 MB per file"}{" "}
          · up to {MAX_BATCH} at a time
        </p>
      </div>

      {error ? (
        <Notice tone="attention" className="mt-3">
          {error}
        </Notice>
      ) : null}

      {/* ------------------------------------------------------- the queue -- */}
      {queue.length > 0 ? (
        <div className="mt-4">
          <div className="mb-2 flex items-center justify-between gap-3">
            <p className="eyebrow">
              {queue.length} {queue.length === 1 ? "document" : "documents"}
            </p>
            {ran ? (
              <p className="text-[11px] font-bold text-muted-foreground">
                {done} uploaded
                {failed > 0 ? ` · ${failed} failed` : ""}
              </p>
            ) : null}
          </div>

          <ul className="space-y-1.5">
            {queue.map((item) => (
              <li
                key={item.key}
                className={cn(
                  "flex flex-wrap items-center gap-2.5 rounded-[var(--radius-md)] border bg-surface px-3 py-2.5 sm:flex-nowrap",
                  item.status === "failed"
                    ? "border-l-[3px] border-border border-l-measure-flagged"
                    : "border-border",
                )}
              >
                <span
                  aria-hidden
                  className="flex size-8 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-surface-muted text-muted-foreground"
                >
                  {/*
                    THE TICK IS NOT GREEN, and `theme-semantics.test.ts` is
                    right to have caught it. Green marks the good direction of a
                    MEASURE where the business has stated which one that is; a
                    document that finished indexing is the case the freeze names
                    explicitly as staying neutral — "a document that finished
                    indexing is not outperforming anything". The `ready` badge
                    beside it already reads grey for the same reason.
                  */}
                  {item.status === "done" ? (
                    <CheckCircle2 className="size-4 text-status-ready" />
                  ) : item.status === "failed" ? (
                    <TriangleAlert className="size-4 text-measure-flagged-foreground" />
                  ) : (
                    <FileUp className="size-4" />
                  )}
                </span>

                <span className="min-w-0 flex-1">
                  {/*
                    THE TITLE IS EDITABLE PER ROW, because it decides which
                    document this supersedes. A filename-derived title is a good
                    default and a poor guarantee.
                  */}
                  <label htmlFor={`title-${item.key}`} className="sr-only">
                    Title for {item.file.name}
                  </label>
                  <Input
                    id={`title-${item.key}`}
                    value={item.title}
                    disabled={saving || item.status === "done"}
                    onChange={(event) =>
                      patch(item.key, { title: event.target.value })
                    }
                    className="h-8 text-[13px]"
                    placeholder="Document title"
                  />
                  <span className="mt-1 block truncate text-[10.5px] text-muted-foreground">
                    {item.file.name} ·{" "}
                    {FILE_TYPE_LABEL[fileTypeFromName(item.file.name)]} ·{" "}
                    {formatBytes(item.file.size)}
                  </span>
                  {item.message ? (
                    <span className="mt-1 block text-[11px] text-measure-flagged-foreground">
                      {item.message}
                    </span>
                  ) : null}
                </span>

                <span className="flex shrink-0 items-center gap-1.5">
                  <QueueStatus status={item.status} live={live} />
                  {item.status === "done" || saving ? null : (
                    <Button
                      variant="ghost"
                      size="iconSm"
                      aria-label={`Remove ${item.file.name}`}
                      onClick={() =>
                        setQueue((current) =>
                          current.filter((entry) => entry.key !== item.key),
                        )
                      }
                    >
                      <X />
                    </Button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* ------------------------------------------------- shared metadata -- */}
      <div className="mt-5 space-y-4">
        <FieldGroup label="Category" htmlFor="upload-category" required>
          <Select
            id="upload-category"
            value={category}
            disabled={saving}
            onChange={(event) =>
              setCategory(event.target.value as KnowledgeCategory)
            }
          >
            {KNOWLEDGE_CATEGORIES.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.label}
              </option>
            ))}
          </Select>
        </FieldGroup>

        {/*
          ONE DESCRIPTION DESCRIBES ONE DOCUMENT. For a batch the field is
          replaced by a note rather than applied to every file, which would
          write the same sentence into records it is not true of.
        */}
        {single ? (
          <FieldGroup
            label="Description"
            htmlFor="upload-description"
            hint="One line describing what this document covers. Shown in the library and used when matching answers."
          >
            <Textarea
              id="upload-description"
              value={description}
              disabled={saving}
              onChange={(event) => setDescription(event.target.value)}
              className="min-h-20"
              placeholder="What does this document cover?"
            />
          </FieldGroup>
        ) : queue.length > 1 ? (
          <p className="text-[12px] leading-relaxed text-muted-foreground">
            Each document takes its title from its filename — edit any of them
            above. Descriptions are per document and can be added from the
            library once these are indexed.
          </p>
        ) : null}

        <FieldGroup
          label="Tags"
          htmlFor="upload-tags"
          hint={
            queue.length > 1
              ? "Comma separated, applied to every document in this batch. Tags improve retrieval once indexed."
              : "Comma separated. Tags improve retrieval once the document is indexed."
          }
        >
          <Input
            id="upload-tags"
            value={tags}
            disabled={saving}
            onChange={(event) => setTags(event.target.value)}
            placeholder="attendance, coaching, documentation"
          />
        </FieldGroup>
      </div>

      <Notice tone="neutral" icon={<Info />} className="mt-5">
        {live ? (
          <>
            Each original is stored privately, then its text is extracted, split
            into retrieval chunks and indexed — one document at a time, so a
            large batch takes a few minutes. Each shows as{" "}
            <Badge tone="processing" size="sm">Processing</Badge> until every
            chunk is stored, and only then as{" "}
            <Badge tone="ready" size="sm">Ready</Badge>. Sunny cannot cite one
            before that.
          </>
        ) : (
          <>
            The files are stored in this browser and their metadata is recorded
            now. Text extraction, chunking and indexing run in live mode — here
            each document shows as{" "}
            <Badge tone="processing" size="sm">Processing</Badge> briefly, then{" "}
            <Badge tone="ready" size="sm">Ready</Badge>.
          </>
        )}
      </Notice>

      <DialogActions>
        <Button variant="ghost" onClick={onDone} disabled={saving}>
          {allSucceeded ? "Close" : "Cancel"}
        </Button>
        {/*
          NO DEAD CONTROL AFTER A CLEAN RUN. With everything uploaded there is
          nothing left to send, so a permanently disabled "Upload document"
          button is furniture that reads as something broken. Close is the only
          action left, and it is the one the reader wants.
        */}
        {allSucceeded ? null : (
          <Button
            onClick={() => void handleSubmit()}
            disabled={pending.length === 0 || !ready || saving}
          >
            {saving ? (
              live ? "Indexing…" : "Uploading…"
            ) : failed > 0 ? (
              <>
                <RotateCcw />
                Retry {failed} {failed === 1 ? "document" : "documents"}
              </>
            ) : pending.length > 1 ? (
              `Upload ${pending.length} documents`
            ) : (
              "Upload document"
            )}
          </Button>
        )}
      </DialogActions>
    </div>
  );
}

/** Where one queued file has got to, in words rather than by colour alone. */
function QueueStatus({
  status,
  live,
}: {
  status: QueueItem["status"];
  live: boolean;
}) {
  if (status === "queued") return null;
  if (status === "uploading") {
    return (
      <Badge tone="processing" size="sm">
        {live ? "Indexing" : "Uploading"}
      </Badge>
    );
  }
  if (status === "waiting") {
    /*
     * NAMED HONESTLY. The route asked us to slow down and the batch is waiting
     * out its window — that is not a failure and must not read as one, or the
     * reader cancels a run that was about to continue on its own.
     */
    return (
      <Badge tone="attention" size="sm">
        Waiting
      </Badge>
    );
  }
  if (status === "done") {
    return (
      <Badge tone="ready" size="sm">
        Uploaded
      </Badge>
    );
  }
  return (
    <Badge tone="failed" size="sm">
      Failed
    </Badge>
  );
}
