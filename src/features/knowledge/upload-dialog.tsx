"use client";

import { useCallback, useRef, useState } from "react";
import { FileUp, Info, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FieldGroup, Input, Select, Textarea } from "@/components/ui/field";
import { Notice } from "@/components/ui/feedback";
import { DialogActions } from "@/components/ui/overlays";
import { KNOWLEDGE_CATEGORIES } from "@/data/demo/knowledge";
import { DEMO_PROCESSING_MS, demoProcessingOutcome } from "./lifecycle-service";
import {
  precheckFile,
  uploadToKnowledgeBase,
  uploadsAreLive,
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
 * Working upload, in both modes.
 *
 * DEMO: the file is stored as a Blob in IndexedDB via the StorageProvider and
 * the KnowledgeDocument record is added to the library, so it survives a
 * refresh. Nothing is parsed; the brief "Processing" state is an honest
 * stand-in.
 *
 * LIVE: the file is POSTed to /api/knowledge/upload, which stores the original
 * in a private bucket and runs extract -> chunk -> embed -> index server-side.
 * The document only appears as Ready once every chunk is persisted, and a
 * failure is reported rather than shown as a successful upload.
 *
 * The component talks to `upload-service.ts` and to the StorageProvider. It
 * imports no Supabase client, no SDK and no key.
 */
export function UploadDialog({
  defaultCategory,
  onDone,
}: {
  defaultCategory?: KnowledgeCategory;
  onDone: () => void;
}) {
  const { user, brand } = useSession();
  const { addDocument, updateDocument, storageAvailable } = useAppStore();
  const inputRef = useRef<HTMLInputElement>(null);
  const live = uploadsAreLive();

  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<KnowledgeCategory>(
    defaultCategory ?? "operations",
  );
  const [tags, setTags] = useState("");
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const accept = useCallback(
    (next: File | null) => {
      if (!next) return;

      // Live mode runs the same validator the server runs, so an unsupported
      // type is refused here with the same message rather than uploaded and
      // rejected. The server still re-validates: this is a courtesy, not a
      // trust boundary.
      const problem = live
        ? precheckFile(next)
        : next.size > MAX_BYTES
          ? `${next.name} is ${formatBytes(next.size)}. The limit is 50 MB per file.`
          : null;

      if (problem) {
        setError(problem);
        return;
      }

      setError(null);
      setFile(next);
      setTitle((current) =>
        current || next.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " "),
      );
    },
    [live],
  );

  const handleSubmit = async () => {
    if (!file || !title.trim()) return;
    setSaving(true);
    setError(null);

    const parsedTags = tags
      .split(",")
      .map((tag) => tag.trim().toLowerCase())
      .filter(Boolean);

    /* ---------------------------------------------------------- live -- */
    if (live) {
      try {
        // The server owns the whole pipeline. The document it returns is
        // already indexed, or the request failed — there is no in-between
        // state the UI has to guess at.
        const { document: indexed } = await uploadToKnowledgeBase({
          file,
          title: title.trim(),
          description: description.trim(),
          category,
          tags: parsedTags,
          scopeId: brand.knowledgeScopeId,
          uploadedBy: user.name,
        });

        await addDocument(indexed);
        setSaving(false);
        onDone();
      } catch (uploadError) {
        // Reported, never swallowed: an unindexed document must not appear in
        // the library as though Sunny can cite it.
        setError(
          uploadError instanceof Error
            ? uploadError.message
            : "The document could not be indexed.",
        );
        setSaving(false);
      }
      return;
    }

    /* ---------------------------------------------------------- demo -- */
    const id = createId("kb");
    const blobKey = `doc-${id}`;
    const now = nowIso();
    const fileType = fileTypeFromName(file.name);

    const document: KnowledgeDocument = {
      id,
      title: title.trim(),
      description:
        description.trim() || "Uploaded through the Ask Sunny knowledge library.",
      category,
      fileName: file.name,
      fileType,
      sizeBytes: file.size,
      characterCount: estimateCharacterCount(file.size),
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

    await addDocument(document, file);

    // Stand-in for ingestion completing. Deterministic rather than always
    // succeeding: a title containing "[fail]" lands in the failed state, so the
    // failure and retry path can be demonstrated on demand instead of only
    // being reachable when a real service breaks.
    window.setTimeout(() => {
      updateDocument(id, {
        ...demoProcessingOutcome(document),
        updatedAt: nowIso(),
      });
    }, DEMO_PROCESSING_MS);

    setSaving(false);
    onDone();
  };

  return (
    <div>
      {!storageAvailable ? (
        <Notice tone="attention" icon={<Info />} className="mb-4">
          Browser storage is unavailable, so this upload will not survive a page
          refresh. Everything else still works.
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
          accept(event.dataTransfer.files?.[0] ?? null);
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
          accept={live ? ACCEPTED_LIVE : ACCEPTED_DEMO}
          className="sr-only"
          id="knowledge-file"
          onChange={(event) => accept(event.target.files?.[0] ?? null)}
        />

        {file ? (
          <div className="flex items-center justify-center gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-surface text-primary">
              <FileUp className="size-4" aria-hidden />
            </span>
            <span className="min-w-0 text-left">
              <span className="block truncate text-[13px] font-medium text-foreground">
                {file.name}
              </span>
              <span className="mt-0.5 block text-xs text-muted-foreground">
                {FILE_TYPE_LABEL[fileTypeFromName(file.name)]} ·{" "}
                {formatBytes(file.size)}
              </span>
            </span>
            <Button
              variant="ghost"
              size="iconSm"
              aria-label="Remove selected file"
              onClick={() => setFile(null)}
            >
              <X />
            </Button>
          </div>
        ) : (
          <>
            <span className="mx-auto mb-3 flex size-10 items-center justify-center rounded-full bg-surface text-muted-foreground">
              <FileUp className="size-4" aria-hidden />
            </span>
            <p className="text-[13px] font-medium text-foreground">
              Drag a document here, or
            </p>
            <Button
              variant="secondary"
              size="sm"
              className="mt-2.5"
              onClick={() => inputRef.current?.click()}
            >
              Choose a file
            </Button>
            <p className="mt-3 text-xs text-muted-foreground">
              {live
                ? "PDF, Word (.docx), text or Markdown · 50 MB max per file"
                : "PDF, Word, Excel, PowerPoint, text, Markdown or images · 50 MB max per file"}
            </p>
          </>
        )}
      </div>

      {error ? (
        <Notice tone="attention" className="mt-3">
          {error}
        </Notice>
      ) : null}

      {/* Metadata */}
      <div className="mt-5 space-y-4">
        <FieldGroup
          label="Document title"
          htmlFor="upload-title"
          required
          hint="Uploading a document with an existing title creates a new version and supersedes the old one. Sunny always cites the newest version."
        >
          <Input
            id="upload-title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="e.g. Attendance & Dress Code Policy"
          />
        </FieldGroup>

        <FieldGroup label="Category" htmlFor="upload-category" required>
          <Select
            id="upload-category"
            value={category}
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

        <FieldGroup
          label="Description"
          htmlFor="upload-description"
          hint="One line describing what this document covers. Shown in the library and used when matching answers."
        >
          <Textarea
            id="upload-description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            className="min-h-20"
            placeholder="What does this document cover?"
          />
        </FieldGroup>

        <FieldGroup
          label="Tags"
          htmlFor="upload-tags"
          hint="Comma separated. Tags improve retrieval once the document is indexed."
        >
          <Input
            id="upload-tags"
            value={tags}
            onChange={(event) => setTags(event.target.value)}
            placeholder="attendance, coaching, documentation"
          />
        </FieldGroup>
      </div>

      <Notice tone="neutral" icon={<Info />} className="mt-5">
        {live ? (
          <>
            The original file is stored privately, then its text is extracted,
            split into retrieval chunks and indexed. The document shows as{" "}
            <Badge tone="processing" size="sm">Processing</Badge> until every
            chunk is stored, and only then as{" "}
            <Badge tone="ready" size="sm">Ready</Badge>. Sunny cannot cite it
            before that.
          </>
        ) : (
          <>
            The file is stored in this browser and its metadata is recorded now.
            Text extraction, chunking and indexing run in live mode — here the
            document shows as{" "}
            <Badge tone="processing" size="sm">Processing</Badge> briefly, then{" "}
            <Badge tone="ready" size="sm">Ready</Badge>.
          </>
        )}
      </Notice>

      <DialogActions>
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button
          onClick={() => void handleSubmit()}
          disabled={!file || !title.trim() || saving}
        >
          {saving ? (live ? "Indexing…" : "Uploading…") : "Upload document"}
        </Button>
      </DialogActions>
    </div>
  );
}
