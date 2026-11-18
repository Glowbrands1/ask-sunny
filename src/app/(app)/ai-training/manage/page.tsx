import type { Metadata } from "next";

import { readOrExplain } from "@/features/ai-training/data.server";
import { ManageScreen } from "@/features/ai-training/manage-screen";
import { listPages, listSubmissionsForReview, loadCatalog } from "@/lib/ai-training/repository";
import { requireAdminConsolePage } from "@/lib/auth/page";

export const metadata: Metadata = {
  title: "Manage AI Training",
};

export const dynamic = "force-dynamic";

/** Editing the program: administrators only, like every other management console here. */
export default async function ManageAiTrainingPage() {
  await requireAdminConsolePage("view_ai_training");

  const loaded = await readOrExplain(async () => {
    const [catalog, pages, submissions] = await Promise.all([
      loadCatalog(true),
      listPages(),
      listSubmissionsForReview("all"),
    ]);
    return { catalog, pages, submissions };
  });

  return <ManageScreen problem={loaded.problem} data={loaded.data} />;
}
