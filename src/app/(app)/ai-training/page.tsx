import type { Metadata } from "next";

import { readOrExplain, viewerIsAdmin } from "@/features/ai-training/data.server";
import { TrainingHome } from "@/features/ai-training/training-home";
import { requirePagePermission } from "@/lib/auth/page";
import { getPage, listMySubmissions, loadCatalog } from "@/lib/ai-training/repository";

export const metadata: Metadata = {
  title: "AI Training",
};

export const dynamic = "force-dynamic";

export default async function AiTrainingPage() {
  const identity = await requirePagePermission("view_ai_training");
  const isAdmin = viewerIsAdmin(identity);

  const loaded = await readOrExplain(async () => {
    const [catalog, policy, bestPractices, announcement, mine] = await Promise.all([
      loadCatalog(isAdmin),
      getPage("policy"),
      getPage("best_practices"),
      getPage("announcement"),
      identity ? listMySubmissions(identity.subject) : Promise.resolve([]),
    ]);
    return { catalog, policy, bestPractices, announcement, mine };
  });

  return <TrainingHome isAdmin={isAdmin} problem={loaded.problem} data={loaded.data} />;
}
