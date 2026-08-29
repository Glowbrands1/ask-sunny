import { Badge, StatusDot } from "@/components/ui/badge";
import { DOCUMENT_STATUS_LABEL } from "@/data/demo/knowledge";
import type { DocumentSource, DocumentStatus } from "@/types";

const STATUS_TONE = {
  ready: "ready",
  processing: "processing",
  needs_review: "attention",
  failed: "failed",
} as const;

/** Status is always icon/dot + text, never colour alone. */
export function DocumentStatusBadge({ status }: { status: DocumentStatus }) {
  return (
    <Badge tone={STATUS_TONE[status]} size="sm">
      <StatusDot />
      {DOCUMENT_STATUS_LABEL[status]}
    </Badge>
  );
}

export const SOURCE_LABEL: Record<DocumentSource, string> = {
  upload: "Uploaded",
  sharepoint: "SharePoint",
  woven: "Woven",
  system: "Seeded",
};

export function DocumentSourceBadge({ source }: { source: DocumentSource }) {
  return (
    <Badge tone="outline" size="sm">
      {SOURCE_LABEL[source]}
    </Badge>
  );
}
