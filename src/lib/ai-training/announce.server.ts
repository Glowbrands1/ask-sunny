import "server-only";

import { createNotifications } from "@/lib/notifications/repository";
import { activePermissionMatrix } from "@/lib/permissions";
import { ensurePermissionsLoaded } from "@/lib/permissions/store";
import { getSupabaseAdmin } from "@/lib/supabase/server";

import { announcementNotifications, trainingAudience, type AnnouncedLesson, type AudienceMember } from "./announce";
import { aiTrainingEditorEmails } from "./editors";

/**
 * Sends the bell for lessons that have JUST been published for the first time
 * (see `announce.ts`). The lessons are already saved: a failure here is logged
 * and never turns a successful publish into an error for the editor.
 */

const CHUNK = 500;

/** Of `ids`, the lessons that have been published here before (their `published_at` is set). */
export async function lessonsPublishedBefore(ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const { data, error } = await getSupabaseAdmin().from("ai_training_lessons").select("id, published_at").in("id", ids);
  if (error) throw new Error(`AI Training: could not read the lessons (${error.message}).`);
  return new Set(((data ?? []) as { id: string; published_at: string | null }[]).filter((r) => r.published_at).map((r) => r.id));
}

async function loadAnnounced(ids: string[]): Promise<AnnouncedLesson[]> {
  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from("ai_training_lessons")
    .select("id, track_id, module_id, slug, title, summary, status")
    .in("id", ids);
  if (error) throw new Error(error.message);
  const lessons = ((data ?? []) as {
    id: string;
    track_id: string;
    module_id: string | null;
    slug: string;
    title: string;
    summary: string | null;
    status: string;
  }[]).filter((l) => l.status === "published");
  if (!lessons.length) return [];

  const trackIds = [...new Set(lessons.map((l) => l.track_id))];
  const moduleIds = [...new Set(lessons.map((l) => l.module_id).filter((m): m is string => !!m))];
  const [tracks, modules, siblings] = await Promise.all([
    db.from("ai_training_tracks").select("id, slug").in("id", trackIds),
    moduleIds.length
      ? db.from("ai_training_modules").select("id, title, admin_only").in("id", moduleIds)
      : Promise.resolve({ data: [], error: null }),
    // Lessons already published in those modules, other than the ones being announced.
    moduleIds.length
      ? db.from("ai_training_lessons").select("id, module_id").in("module_id", moduleIds).not("published_at", "is", null)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (tracks.error) throw new Error(tracks.error.message);
  if (modules.error) throw new Error(modules.error.message);
  if (siblings.error) throw new Error(siblings.error.message);

  const trackSlug = new Map(((tracks.data ?? []) as { id: string; slug: string }[]).map((t) => [t.id, t.slug]));
  const moduleById = new Map(
    ((modules.data ?? []) as { id: string; title: string; admin_only: boolean }[]).map((m) => [m.id, m]),
  );
  const announced = new Set(lessons.map((l) => l.id));
  const modulesWithEarlier = new Set(
    ((siblings.data ?? []) as { id: string; module_id: string }[]).filter((r) => !announced.has(r.id)).map((r) => r.module_id),
  );

  return lessons.map((l) => {
    const m = l.module_id ? moduleById.get(l.module_id) : undefined;
    return {
      id: l.id,
      title: l.title,
      summary: l.summary,
      href: `/ai-training/${trackSlug.get(l.track_id) ?? ""}/${l.slug}`,
      module: m ? { id: m.id, title: m.title, adminOnly: m.admin_only } : null,
      moduleIsNew: !!m && !modulesWithEarlier.has(m.id),
    };
  });
}

async function activeAccounts(): Promise<AudienceMember[]> {
  const { data, error } = await getSupabaseAdmin().from("app_users").select("email, role, status").eq("status", "active");
  if (error) throw new Error(error.message);
  return (data ?? []) as AudienceMember[];
}

/** Rings everyone's bell for `lessonIds` (just published for the first time). Never throws. */
export async function announceNewLessons(lessonIds: string[], publisherEmail: string | null): Promise<void> {
  if (!lessonIds.length) return;
  try {
    const lessons = await loadAnnounced(lessonIds);
    if (!lessons.length) return;
    await ensurePermissionsLoaded();
    const everyone = trainingAudience(await activeAccounts(), activePermissionMatrix(), publisherEmail);
    const rows = announcementNotifications({ lessons, everyone, editors: aiTrainingEditorEmails() });
    for (let i = 0; i < rows.length; i += CHUNK) await createNotifications(rows.slice(i, i + CHUNK));
  } catch (error) {
    console.error("[ai-training] lesson published, but the notification to everyone was not sent:", error);
  }
}
