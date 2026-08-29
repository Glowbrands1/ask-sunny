import { Suspense } from "react";
import type { Metadata } from "next";

import { KnowledgeScreen } from "@/features/knowledge/knowledge-screen";

export const metadata: Metadata = {
  title: "Knowledge Base",
};

export default function KnowledgePage() {
  return (
    <Suspense fallback={null}>
      <KnowledgeScreen />
    </Suspense>
  );
}
