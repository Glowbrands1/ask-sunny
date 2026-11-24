import type { Metadata } from "next";

import { readOrExplain, viewerIsAdmin } from "@/features/ai-training/data.server";
import { TrainingHome } from "@/features/ai-training/training-home";
import { canSeeAssignmentTracker } from "@/lib/ai-training/assignments";
import { loadAssignmentTracker } from "@/lib/ai-training/assignments-repository";
import { requirePagePermission } from "@/lib/auth/page";
import { businessToday } from "@/lib/business-date";
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

  // The Assignments tab: the tracker's named people only. Anyone else is never sent its rows, nor shown the tab.
  const assignments = canSeeAssignmentTracker(identity)
    ? await readOrExplain(loadAssignmentTracker).then((r) => ({
        tracker: r.data,
        today: businessToday(),
        problem: r.problem && "The assignment tracker could not be loaded. If this is a new deployment, its database tables may not have been created yet.",
      }))
    : null;

  return <TrainingHome isAdmin={isAdmin} problem={loaded.problem} data={loaded.data} assignments={assignments} />;
}
