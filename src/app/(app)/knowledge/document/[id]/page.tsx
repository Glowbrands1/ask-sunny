import type { Metadata } from "next";

import { PermissionGate } from "@/components/permission-gate";
import { DocumentSourceView } from "@/features/knowledge/document-source-view";
import { requirePagePermission } from "@/lib/auth/page";

export const metadata: Metadata = {
  title: "Source document",
};

export const dynamic = "force-dynamic";

/**
 * THE DOCUMENT BEHIND A CITATION — `view_knowledge`, not the admin console.
 *
 * `/knowledge` is administrators-only because it is the corpus's management
 * console. This route is the other half of that split: one document, named by
 * id, opened because Sunny cited it. Every role that can be given an answer
 * holds `view_knowledge`, so every role can open its sources.
 *
 * It reaches no listing. The only knowledge call behind this page is
 * `GET /api/knowledge/documents/[id]`, so there is nothing here to walk from
 * one document to the rest of the library.
 */
export default async function KnowledgeDocumentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requirePagePermission("view_knowledge");
  const { id } = await params;

  return (
    <PermissionGate permission="view_knowledge">
      <DocumentSourceView documentId={decodeURIComponent(id)} />
    </PermissionGate>
  );
}
