import type { Metadata } from "next";

import { ensureAiTrainingEditor, readOrExplain } from "@/features/ai-training/data.server";
import { LessonEditor } from "@/features/ai-training/lesson-editor";
import { getLessonById, loadCatalog } from "@/lib/ai-training/repository";
import { requirePagePermission } from "@/lib/auth/page";

export const metadata: Metadata = {
  title: "Edit lesson",
};

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `/ai-training/manage/lessons/new?track=<id>` creates; a lesson id edits. The named AI Training editors only. */
export default async function EditLessonPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ track?: string }>;
}) {
  const identity = await requirePagePermission("view_ai_training");
  ensureAiTrainingEditor(identity);
  const { id } = await params;
  const { track } = await searchParams;

  const loaded = await readOrExplain(async () => {
    const [catalog, lesson] = await Promise.all([
      loadCatalog(true),
      id !== "new" && UUID.test(id) ? getLessonById(id) : Promise.resolve(null),
    ]);
    return { catalog, lesson };
  });

  return (
    <LessonEditor
      problem={loaded.problem}
      catalog={loaded.data?.catalog ?? null}
      lesson={loaded.data?.lesson ?? null}
      isNew={id === "new"}
      defaultTrackId={typeof track === "string" ? track : null}
    />
  );
}
