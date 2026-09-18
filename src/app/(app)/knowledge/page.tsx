import { Suspense } from "react";
import type { Metadata } from "next";

import { PermissionGate } from "@/components/permission-gate";
import { KnowledgeScreen } from "@/features/knowledge/knowledge-screen";
import { requireAdminConsolePage } from "@/lib/auth/page";

export const metadata: Metadata = {
  title: "Knowledge Base",
};

export const dynamic = "force-dynamic";

/**
 * THE MANAGEMENT CONSOLE FOR THE CORPUS — administrators only.
 *
 * `requireAdminConsolePage` checks `view_knowledge` FIRST and then the admin
 * console, so the two refusals stay distinct and the permission this screen
 * reads with is still stated. What it adds is the second condition: the
 * inventory, the counts, the processing and failure states, upload, delete and
 * re-index are administration of the knowledge base rather than use of it.
 *
 * READING A CITED DOCUMENT DID NOT MOVE BEHIND THIS. `/knowledge/document/[id]`
 * asks for `view_knowledge` alone and shows one document, so every role Sunny
 * answers for can still open the source under a citation.
 */
export default async function KnowledgePage() {
  await requireAdminConsolePage("view_knowledge");

  return (
    <PermissionGate permission="view_knowledge" adminOnly>
      <Suspense fallback={null}>
        <KnowledgeScreen />
      </Suspense>
    </PermissionGate>
  );
}
