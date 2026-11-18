import type { Metadata } from "next";

import { readOrExplain, viewerIsAdmin } from "@/features/ai-training/data.server";
import { LessonScreen } from "@/features/ai-training/lesson-screen";
import { requirePagePermission } from "@/lib/auth/page";
import { getLessonBySlug, listMySubmissions } from "@/lib/ai-training/repository";

export const metadata: Metadata = {
  title: "AI Training",
};

export const dynamic = "force-dynamic";

export default async function AiTrainingLessonPage({ params }: { params: Promise<{ track: string; slug: string }> }) {
  // The guard is the first await: nothing is read before the permission is checked.
  const identity = await requirePagePermission("view_ai_training");
  const { track, slug } = await params;
  const isAdmin = viewerIsAdmin(identity);

  const loaded = await readOrExplain(async () => {
    const view = await getLessonBySlug(track, slug, isAdmin);
    const mine = view && identity ? (await listMySubmissions(identity.subject)).filter((s) => s.lessonId === view.lesson.id) : [];
    return { view, mine };
  });

  return (
    <LessonScreen
      problem={loaded.problem}
      view={loaded.data?.view ?? null}
      mine={loaded.data?.mine ?? []}
      isAdmin={isAdmin}
    />
  );
}
