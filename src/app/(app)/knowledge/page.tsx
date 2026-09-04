import { Suspense } from "react";
import type { Metadata } from "next";

import { KnowledgeScreen } from "@/features/knowledge/knowledge-screen";
import { requirePagePermission } from "@/lib/auth/page";

export const metadata: Metadata = {
  title: "Knowledge Base",
};

export const dynamic = "force-dynamic";

export default async function KnowledgePage() {
  await requirePagePermission("view_knowledge");

  return (
    <Suspense fallback={null}>
      <KnowledgeScreen />
    </Suspense>
  );
}
