"use client";

import Link from "next/link";
import { FileText } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { KNOWLEDGE_CATEGORY_LABEL } from "@/data/demo/knowledge";
import { cn } from "@/lib/utils/cn";
import { truncate } from "@/lib/utils/format";
import type { SourceCitation } from "@/types";

/**
 * SourceCard — the reusable "where this answer came from" card.
 *
 * Rendered from SourceCitation objects returned by the KnowledgeProvider, so it
 * works identically whether the citation came from mock retrieval today or from
 * real vector retrieval later.
 */
export function SourceCard({
  citation,
  index,
  className,
}: {
  citation: SourceCitation;
  index?: number;
  className?: string;
}) {
  return (
    <Link
      href={`/knowledge?document=${citation.documentId}`}
      className={cn(
        "group flex gap-3 rounded-[var(--radius-md)] border border-border bg-surface p-3 text-left shadow-soft transition-[border-color,box-shadow] hover:border-border-strong hover:shadow-raised",
        className,
      )}
    >
      <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-[var(--radius-xs)] bg-primary-soft text-primary-soft-foreground">
        {typeof index === "number" ? (
          <span className="text-[11px] font-semibold">{index + 1}</span>
        ) : (
          <FileText className="size-3.5" />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] leading-snug font-medium text-foreground group-hover:text-primary">
          {citation.documentTitle}
        </span>
        <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <span>{citation.locator}</span>
          <span aria-hidden>·</span>
          <span>{KNOWLEDGE_CATEGORY_LABEL[citation.category]}</span>
        </span>
        <span className="mt-1.5 block text-xs leading-relaxed text-subtle-foreground">
          {truncate(citation.excerpt, 128)}
        </span>
      </span>
    </Link>
  );
}

export function SourceCardList({
  citations,
  className,
  title = "Sources",
}: {
  citations: SourceCitation[];
  className?: string;
  title?: string;
}) {
  if (citations.length === 0) return null;
  return (
    <div className={className}>
      <div className="mb-2 flex items-center gap-2">
        <p className="eyebrow">{title}</p>
        <Badge tone="outline" size="sm">
          {citations.length}
        </Badge>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {citations.map((citation, index) => (
          <SourceCard
            key={`${citation.documentId}-${citation.locator}-${index}`}
            citation={citation}
            index={index}
          />
        ))}
      </div>
    </div>
  );
}
