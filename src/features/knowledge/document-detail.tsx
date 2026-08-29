"use client";

import { Download, History } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FieldGroup, Select } from "@/components/ui/field";
import { Notice } from "@/components/ui/feedback";
import { KNOWLEDGE_CATEGORIES, KNOWLEDGE_CATEGORY_LABEL } from "@/data/demo/knowledge";
import { getStorageProvider } from "@/lib/storage";
import { useAppStore } from "@/lib/store/app-store";
import { formatDate, formatDateTime } from "@/lib/utils/date";
import { FILE_TYPE_LABEL, formatBytes, formatNumber } from "@/lib/utils/format";
import type { KnowledgeCategory, KnowledgeDocument } from "@/types";
import { DocumentSourceBadge, DocumentStatusBadge } from "./document-status";

export function DocumentDetail({
  document,
  canManage,
}: {
  document: KnowledgeDocument;
  canManage: boolean;
}) {
  const { updateDocument } = useAppStore();

  const handleDownload = async () => {
    if (!document.blobKey) return;
    const blob = await getStorageProvider().getBlob(document.blobKey);
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const anchor = window.document.createElement("a");
    anchor.href = url;
    anchor.download = document.fileName;
    window.document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <div className="flex flex-wrap items-center gap-1.5">
        <DocumentStatusBadge status={document.status} />
        <DocumentSourceBadge source={document.source} />
        <Badge tone="neutral" size="sm">
          {FILE_TYPE_LABEL[document.fileType]}
        </Badge>
        {document.version > 1 ? (
          <Badge tone="primary" size="sm">
            Version {document.version}
          </Badge>
        ) : null}
        {document.indexed ? (
          <Badge tone="accent" size="sm">
            Indexed
          </Badge>
        ) : (
          <Badge tone="neutral" size="sm">
            Not indexed
          </Badge>
        )}
      </div>

      <p className="mt-4 text-[13px] leading-relaxed text-muted-foreground">
        {document.description}
      </p>

      <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-4 border-t border-border pt-5 sm:grid-cols-3">
        {[
          { label: "Category", value: KNOWLEDGE_CATEGORY_LABEL[document.category] },
          { label: "File", value: document.fileName },
          { label: "Size", value: formatBytes(document.sizeBytes) },
          {
            label: "Characters",
            value: `${formatNumber(document.characterCount)} approx.`,
          },
          { label: "Uploaded by", value: document.uploadedBy },
          { label: "Uploaded", value: formatDateTime(document.uploadedAt) },
        ].map((entry) => (
          <div key={entry.label}>
            <dt className="eyebrow">{entry.label}</dt>
            <dd className="mt-1 text-[13px] break-words text-foreground">
              {entry.value}
            </dd>
          </div>
        ))}
      </dl>

      {document.tags.length > 0 ? (
        <div className="mt-5">
          <p className="eyebrow mb-2">Tags</p>
          <div className="flex flex-wrap gap-1.5">
            {document.tags.map((tag) => (
              <Badge key={tag} tone="neutral" size="sm">
                {tag}
              </Badge>
            ))}
          </div>
        </div>
      ) : null}

      {canManage ? (
        <div className="mt-6 border-t border-border pt-5">
          <FieldGroup
            label="Re-categorize"
            htmlFor={`recategorize-${document.id}`}
            hint="Moves the document into a different library. Retrieval scope updates immediately."
          >
            <Select
              id={`recategorize-${document.id}`}
              value={document.category}
              onChange={(event) =>
                updateDocument(document.id, {
                  category: event.target.value as KnowledgeCategory,
                })
              }
            >
              {KNOWLEDGE_CATEGORIES.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.label}
                </option>
              ))}
            </Select>
          </FieldGroup>
        </div>
      ) : null}

      {document.previousVersions.length > 0 ? (
        <div className="mt-6 border-t border-border pt-5">
          <div className="mb-3 flex items-center gap-2">
            <History className="size-3.5 text-muted-foreground" aria-hidden />
            <p className="eyebrow">Version history</p>
          </div>
          <ul className="space-y-2">
            {[...document.previousVersions]
              .sort((a, b) => b.version - a.version)
              .map((version) => (
                <li
                  key={version.version}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-sm)] border border-border px-3 py-2.5"
                >
                  <span className="text-[13px] text-foreground">
                    Version {version.version}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {version.uploadedBy} · {formatDate(version.uploadedAt)} ·{" "}
                    {formatBytes(version.sizeBytes)}
                  </span>
                </li>
              ))}
          </ul>
          <p className="mt-2.5 text-xs leading-relaxed text-muted-foreground">
            Sunny always answers from the newest version. Earlier versions are
            kept for reference only.
          </p>
        </div>
      ) : null}

      <div className="mt-6 border-t border-border pt-5">
        {document.blobKey ? (
          <Button variant="secondary" onClick={() => void handleDownload()}>
            <Download />
            Download original
          </Button>
        ) : (
          <Notice tone="neutral">
            This is a seeded demo record, so there is no file to download.
            Documents you upload can be downloaded again from here.
          </Notice>
        )}
      </div>
    </div>
  );
}
