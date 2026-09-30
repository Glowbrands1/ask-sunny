"use client";

import Link from "next/link";
import { useState } from "react";
import { Eye, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { ContentPart } from "@/lib/knowledge-sync/inventory";
import { CONTENT_TYPE_LABEL } from "@/lib/knowledge-sync/types";
import type { PartPreview, PartPreviewResult } from "@/lib/knowledge-sync/woven/part-preview";

/**
 * "Preview" for one Woven item part: what Ask Sunny would read in it, before
 * an audience choice or a sync. A part already in Ask Sunny opens its
 * existing document page; otherwise the server reads the file from Woven and
 * extracts its text in memory — nothing is stored or made searchable. The
 * request carries only the part's opaque `ref`.
 */
export function PartPreviewButton({ part, label = "Preview" }: { part: Pick<ContentPart, "ref" | "previewable" | "askSunnyDocumentId" | "title">; label?: string }) {
  const [state, setState] = useState<{ loading: boolean; result: PartPreviewResult | null }>({ loading: false, result: null });
  const [open, setOpen] = useState(false);

  if (part.askSunnyDocumentId) {
    return (
      <Link className="inline-flex items-center gap-1 text-[12px] text-primary hover:underline" href={`/knowledge/document/${encodeURIComponent(part.askSunnyDocumentId)}`}>
        <Eye className="size-3.5" aria-hidden /> {label}
      </Link>
    );
  }
  if (!part.previewable) return null;

  const load = () => {
    setOpen((v) => !v);
    if (state.result || state.loading) return;
    setState({ loading: true, result: null });
    fetch("/api/admin/knowledge-sync/woven/preview-part", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ref: part.ref }) })
      .then(async (response) => ((await response.json().catch(() => null)) as PartPreviewResult | null) ?? { status: "failed" as const, reason: "The preview could not be loaded." })
      .catch((): PartPreviewResult => ({ status: "failed", reason: "The preview could not be loaded." }))
      .then((result) => setState({ loading: false, result }));
  };

  return (
    <span className="inline-flex flex-col">
      <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[12px]" onClick={load} aria-expanded={open} aria-label={`${label}: ${part.title}`}>
        {state.loading ? <Loader2 className="size-3.5 animate-spin" /> : <Eye className="size-3.5" />}
        {label}
      </Button>
      {open && state.result ? <PreviewPanel result={state.result} /> : null}
    </span>
  );
}

function PreviewPanel({ result }: { result: PartPreviewResult }) {
  if (result.status !== "ok") {
    return (
      <p role="status" className="mt-1 max-w-xl rounded-[var(--radius-sm)] border border-border bg-surface px-3 py-2 text-[12px] text-muted-foreground">
        {result.reason}
      </p>
    );
  }
  const p: PartPreview = result.preview;
  return (
    <div role="region" aria-label={`Preview of ${p.title}`} className="mt-1 w-full max-w-3xl rounded-[var(--radius-sm)] border border-border bg-surface p-3 text-[13px]">
      <p className="font-semibold">{p.title}</p>
      <p className="text-[12px] text-muted-foreground">
        {CONTENT_TYPE_LABEL[p.contentType]} · From: {p.sourceName}
        {p.fileName ? ` · ${p.fileName}` : ""}
      </p>
      {p.askSunnyDocumentId ? (
        <Link className="mt-2 inline-block text-primary hover:underline" href={`/knowledge/document/${encodeURIComponent(p.askSunnyDocumentId)}`}>
          Open the Ask Sunny document
        </Link>
      ) : (
        <>
          <p className="mt-1 text-[12px] text-muted-foreground">
            Read from Woven just now for this preview — not saved, not searchable.{p.truncated ? " Showing the beginning only." : ""}
          </p>
          <div className="mt-2 max-h-80 overflow-y-auto">
            {p.sections.length === 0 ? <p className="text-muted-foreground">No readable text.</p> : null}
            {p.sections.map((s, i) => (
              <div key={i} className="mb-3">
                {s.label || s.page ? (
                  <p className="text-[11px] font-semibold tracking-[0.05em] text-muted-foreground uppercase">
                    {[s.label, s.page && !/^page\b/i.test(s.label) ? `p. ${s.page}` : null].filter(Boolean).join(" · ")}
                  </p>
                ) : null}
                <p className="whitespace-pre-wrap">{s.text}</p>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
