import type { TrainingCatalog, TrainingLessonSummary, TrainingModule } from "./types";

/**
 * WHO SEES WHICH LESSON. Pure, so the server applies it before anything reaches
 * a browser and a test can pin it.
 *
 * Administrators see everything, drafts and the archive included. Everyone else
 * sees published lessons outside admin-only modules. A lesson whose module is
 * MISSING is hidden too: a module the reader cannot see is not an ungrouped
 * lesson (the rule the old app learned the hard way).
 */
export function canShowLesson(
  lesson: Pick<TrainingLessonSummary, "moduleId" | "status">,
  modules: Pick<TrainingModule, "id" | "adminOnly">[],
  isAdmin: boolean,
): boolean {
  if (isAdmin) return true;
  if (lesson.status !== "published") return false;
  if (lesson.moduleId === null) return true;
  return modules.some((m) => m.id === lesson.moduleId && !m.adminOnly);
}

/** The catalog trimmed to what this reader may see. */
export function visibleCatalog(catalog: TrainingCatalog, isAdmin: boolean): TrainingCatalog {
  const modules = isAdmin ? catalog.modules : catalog.modules.filter((m) => !m.adminOnly);
  return {
    tracks: catalog.tracks,
    modules,
    lessons: catalog.lessons.filter((lesson) => canShowLesson(lesson, catalog.modules, isAdmin)),
  };
}

export interface LessonGroup {
  id: string;
  module: TrainingModule | null;
  lessons: TrainingLessonSummary[];
}

/**
 * One track's lessons, grouped the way the old Training page grouped them:
 * ungrouped lessons first (by week number when the track has no modules), then
 * each module in module order, each module's lessons in their own order.
 */
export function groupTrackLessons(
  catalog: TrainingCatalog,
  trackId: string,
  query = "",
): LessonGroup[] {
  const q = query.trim().toLowerCase();
  const matches = (l: TrainingLessonSummary) =>
    !q || l.title.toLowerCase().includes(q) || (l.summary ?? "").toLowerCase().includes(q);
  const lessons = catalog.lessons.filter((l) => l.trackId === trackId && matches(l));
  const modules = catalog.modules
    .filter((m) => m.trackId === trackId)
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const bySort = (a: TrainingLessonSummary, b: TrainingLessonSummary) => a.sortOrder - b.sortOrder;
  const byWeek = (a: TrainingLessonSummary, b: TrainingLessonSummary) =>
    (a.weekNumber ?? 9999) - (b.weekNumber ?? 9999) || bySort(a, b);

  const groups: LessonGroup[] = [];
  const loose = lessons.filter((l) => !l.moduleId || !modules.some((m) => m.id === l.moduleId));
  if (loose.length) groups.push({ id: "none", module: null, lessons: loose.sort(modules.length ? bySort : byWeek) });
  for (const group of modules) {
    const inModule = lessons.filter((l) => l.moduleId === group.id).sort(bySort);
    if (inModule.length) groups.push({ id: group.id, module: group, lessons: inModule });
  }
  return groups;
}

/** Module and published-lesson counts for a track card. */
export function trackCounts(catalog: TrainingCatalog, trackId: string): { modules: number; lessons: number } {
  const lessons = catalog.lessons.filter((l) => l.trackId === trackId && l.status === "published");
  const modules = catalog.modules.filter(
    (m) => m.trackId === trackId && lessons.some((l) => l.moduleId === m.id),
  );
  return { modules: modules.length, lessons: lessons.length };
}

/** A lesson slug from its title: lowercase words joined by hyphens. */
export function slugify(title: string): string {
  return (
    title
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 120) || "lesson"
  );
}
