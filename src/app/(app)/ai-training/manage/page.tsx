import type { Metadata } from "next";

import { ensureAiTrainingEditor, readOrExplain } from "@/features/ai-training/data.server";
import { ManageScreen } from "@/features/ai-training/manage-screen";
import { listPages, listSubmissionsForReview, loadCatalog } from "@/lib/ai-training/repository";
import { syncConfig } from "@/lib/ai-training/sync";
import { requirePagePermission } from "@/lib/auth/page";

export const metadata: Metadata = {
  title: "Manage AI Training",
};

export const dynamic = "force-dynamic";

/** Editing the program: the named AI Training editors only (see `@/lib/ai-training/editors`). */
export default async function ManageAiTrainingPage() {
  const identity = await requirePagePermission("view_ai_training");
  ensureAiTrainingEditor(identity);

  const loaded = await readOrExplain(async () => {
    const [catalog, pages, submissions] = await Promise.all([
      loadCatalog(true),
      listPages(),
      listSubmissionsForReview("all"),
    ]);
    return { catalog, pages, submissions };
  });

  return <ManageScreen problem={loaded.problem} data={loaded.data} otherAppName={syncConfig()?.otherAppName ?? null} />;
}
