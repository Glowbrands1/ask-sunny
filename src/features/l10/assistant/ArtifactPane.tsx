// Copied from the Leadership Hub (src/components/assistant/ArtifactPane.tsx); keep in step with it. See src/features/l10/README.md.
"use client";

import Markdown from "react-markdown";
import { useRef, useState } from "react";
import { artifactFilename, wordDocument } from "./citations";
import { cx } from "@/features/l10/ui/ui";
import type { ArtifactDoc } from "./artifact-context";
import { CheckIcon, ChevronIcon, CloseIcon, CopyIcon, DownloadIcon } from "./icons";
import { noImages, proseClass, remarkGfm } from "./markdown-prose";

const btn =
  "inline-flex min-h-11 items-center gap-1.5 rounded-xl px-3 text-sm font-semibold hover:bg-white/70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bronze";

/** Artifacts-lite: a side/expanded pane showing a long answer as a document. No code execution. */
export function ArtifactPane({ doc, onClose }: { doc: ArtifactDoc; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const body = useRef<HTMLDivElement>(null);

  async function copy() {
    try {
      await navigator.clipboard.writeText(doc.markdown);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked */
    }
  }

  function save(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.append(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }
  const download = () => save(new Blob([doc.markdown], { type: "text/markdown;charset=utf-8" }), artifactFilename(doc.title));
  const downloadWord = () => save(new Blob([wordDocument(doc.title, body.current?.innerHTML ?? "")], { type: "application/msword" }), artifactFilename(doc.title, "doc"));

  return (
    <section aria-label={`Document: ${doc.title}`} data-testid="artifact-pane" className="flex min-h-0 min-w-0 flex-1 flex-col bg-white/45 max-sm:absolute max-sm:inset-0 max-sm:z-10 max-sm:bg-cream sm:border-l sm:border-white/70">
      <header className="flex items-center gap-1 border-b border-line/40 px-2 py-1.5">
        <button type="button" onClick={onClose} className={cx(btn, "sm:hidden")} aria-label="Back to chat">
          <ChevronIcon width={16} height={16} className="rotate-180" />
          Chat
        </button>
        <h3 className="m-0 min-w-0 flex-1 truncate px-2 text-sm font-bold">{doc.title}</h3>
        <button type="button" onClick={copy} className={btn}>
          {copied ? <CheckIcon width={16} height={16} /> : <CopyIcon width={16} height={16} />}
          <span aria-live="polite">{copied ? "Copied" : "Copy"}</span>
        </button>
        <button type="button" onClick={downloadWord} aria-label="Download Word" title="Download as a Word document" className={btn}>
          <DownloadIcon width={16} height={16} />
          <span className="max-sm:hidden">Word</span>
        </button>
        <button type="button" onClick={download} aria-label="Download .md" title="Download as Markdown" className={btn}>
          <DownloadIcon width={16} height={16} />
          <span className="max-sm:hidden">.md</span>
        </button>
        <button type="button" onClick={onClose} aria-label="Close document" className={cx(btn, "max-sm:hidden px-2.5")}>
          <CloseIcon width={16} height={16} />
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain px-5 py-4">
        <div ref={body} className={proseClass}>
          <Markdown remarkPlugins={[remarkGfm]} components={noImages}>{doc.markdown}</Markdown>
        </div>
      </div>
    </section>
  );
}
