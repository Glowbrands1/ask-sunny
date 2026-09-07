"use client";

import * as React from "react";
import { Download, ExternalLink, Eye, FileWarning, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/feedback";
import { Dialog, DialogContent } from "@/components/ui/overlays";
import { documentFileLink, type OriginalFileLink } from "./lifecycle-service";
import type { KnowledgeDocument } from "@/types";

/**
 * ============================================================================
 * SEEING AND KEEPING THE FILE THAT WAS UPLOADED
 * ============================================================================
 *
 * Both actions resolve a SHORT-LIVED SIGNED URL from the server and then use
 * it immediately. Nothing is cached: the URL is a credential with a clock on
 * it, and one held in component state would outlive the reason it was minted.
 *
 * ============================================================================
 * WHY THE PDF IS EMBEDDED WITH A REAL FALLBACK RATHER THAN AN IFRAME ALONE
 * ============================================================================
 *
 * Desktop browsers render a PDF inline from a signed URL perfectly well, and
 * that is what "let me see what I uploaded" actually means. MOBILE SAFARI AND
 * SEVERAL ANDROID BROWSERS DO NOT — they show a blank frame, or one page, or
 * offer a download instead. So `<object>` is used rather than `<iframe>`,
 * because its children render exactly when the embed cannot, and those children
 * are the two controls that always work: open in a new tab, and download.
 *
 * The same two controls are also outside the embed, always visible, so the
 * mobile path is not a fallback a person has to discover.
 *
 * ============================================================================
 * WHAT IS NOT PREVIEWED, AND IS NOT PRETENDED
 * ============================================================================
 *
 * A `.docx` has no browser-native rendering, and this phase does not build a
 * conversion service. It would be easy to render the EXTRACTED TEXT and call it
 * a preview — and it would be a lie: the extraction is a retrieval artefact with
 * no layout, no tables and no signatures, and a manager checking "did the right
 * file upload" would be shown something that is not the file. So an unsupported
 * type says so plainly and offers the original.
 */

const PREVIEW_TTL_NOTE =
  "This link is temporary. Reopen the preview if it stops loading.";

/** Resolves a signed URL and hands it to `use`, with the busy/error plumbing. */
function useFileLink() {
  const [busy, setBusy] = React.useState<"download" | "preview" | null>(null);
  const [problem, setProblem] = React.useState<string | null>(null);

  const resolve = React.useCallback(
    async (
      input: { documentId: string; scopeId: string; mode: "download" | "preview" },
      apply: (link: OriginalFileLink) => void,
    ) => {
      setBusy(input.mode);
      setProblem(null);
      try {
        apply(await documentFileLink(input));
      } catch (error) {
        setProblem(
          error instanceof Error
            ? error.message
            : "The file could not be opened. Try again in a moment.",
        );
      } finally {
        setBusy(null);
      }
    },
    [],
  );

  return { busy, problem, resolve };
}

/**
 * Starts the download.
 *
 * `window.location.assign` rather than a synthetic anchor: the signed URL
 * already carries the attachment filename the server set, so the browser saves
 * it correctly and never navigates away from the Knowledge Base.
 */
function startDownload(link: OriginalFileLink) {
  window.location.assign(link.url);
}

export function DocumentFileActions({
  document,
  scopeId,
}: {
  document: KnowledgeDocument;
  scopeId: string;
}) {
  const { busy, problem, resolve } = useFileLink();
  const [preview, setPreview] = React.useState<OriginalFileLink | null>(null);

  const download = () =>
    void resolve({ documentId: document.id, scopeId, mode: "download" }, startDownload);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" onClick={download} disabled={busy !== null}>
          {busy === "download" ? <Loader2 className="animate-spin" /> : <Download />}
          Download original
        </Button>

        <Button
          variant="ghost"
          onClick={() =>
            void resolve({ documentId: document.id, scopeId, mode: "preview" }, setPreview)
          }
          disabled={busy !== null}
        >
          {busy === "preview" ? <Loader2 className="animate-spin" /> : <Eye />}
          Preview
        </Button>
      </div>

      {problem ? (
        <Notice tone="attention" className="mt-3">
          {problem}
        </Notice>
      ) : null}

      <DocumentPreviewDialog
        link={preview}
        title={document.title}
        onClose={() => setPreview(null)}
        onDownload={download}
      />
    </div>
  );
}

export function DocumentPreviewDialog({
  link,
  title,
  onClose,
  onDownload,
}: {
  link: OriginalFileLink | null;
  title: string;
  onClose: () => void;
  onDownload: () => void;
}) {
  return (
    <Dialog
      open={link !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      {link ? (
        <DialogContent title={title} description={link.fileName} wide>
          {link.previewable ? (
            <div>
              {/*
                Height in viewport units with a floor, so the frame is usable on
                a laptop and does not exceed a phone screen. `w-full` inside a
                `max-w-3xl` dialog, so nothing can widen the page.
              */}
              <object
                data={link.url}
                type={link.mimeType}
                aria-label={`Preview of ${link.fileName}`}
                className="block h-[min(70vh,44rem)] max-h-[70vh] min-h-64 w-full rounded-[var(--radius-md)] border border-border bg-surface-muted"
              >
                {/* Rendered only where the browser cannot embed a PDF. */}
                <div className="p-6">
                  <Notice tone="neutral" title="This browser cannot show the file inline">
                    Open it in a new tab, or download the original.
                  </Notice>
                </div>
              </object>
              <p className="mt-2 text-xs text-subtle-foreground">{PREVIEW_TTL_NOTE}</p>
            </div>
          ) : (
            <Notice
              tone="neutral"
              icon={<FileWarning />}
              title="Preview isn't available for this file type"
            >
              Ask Sunny can only show PDFs in the browser. Download the original
              to open it in the application it was made in — the file itself is
              unchanged.
            </Notice>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button variant="secondary" onClick={onDownload}>
              <Download />
              Download original
            </Button>
            {link.previewable ? (
              <Button asChild variant="ghost">
                <a href={link.url} target="_blank" rel="noreferrer">
                  <ExternalLink />
                  Open in a new tab
                </a>
              </Button>
            ) : null}
          </div>
        </DialogContent>
      ) : null}
    </Dialog>
  );
}
