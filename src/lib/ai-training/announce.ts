import { hasPermission } from "@/lib/permissions";
import type { NewNotification } from "@/lib/notifications/types";
import type { PermissionMatrix, Role } from "@/types";

/**
 * TELLING EVERYONE ABOUT A NEW LESSON OR MODULE (Pau, 26 Nov 2026: "can you add
 * notification to everyone when new module or lesson is posted").
 *
 * A lesson is announced the FIRST time it is published (its `published_at` was
 * empty): saving it again, fixing a typo, or unpublishing and republishing it
 * does not ring everyone's bell a second time. A module is "new" when the
 * lesson announced is the first published lesson in it; then one notification
 * names the module instead of one per lesson.
 *
 * Everyone = every active account whose role may open AI Training under the
 * permission matrix in force, except the editor who published it. A lesson in
 * an admin-only module, which staff cannot see, goes to the other editors only.
 *
 * Pure: the database reads and the bell write are in `announce.server.ts`.
 */

export const NEW_LESSON_KIND = "ai_training_new_lesson";
export const NEW_MODULE_KIND = "ai_training_new_module";

export interface AnnouncedLesson {
  id: string;
  title: string;
  summary: string | null;
  href: string;
  module: { id: string; title: string; adminOnly: boolean } | null;
  /** True when no other lesson in its module was published before this announcement. */
  moduleIsNew: boolean;
}

export interface AudienceMember {
  email: string;
  role: Role;
  status: string;
}

/** Lower-case emails of the active accounts that may open AI Training, without `exclude`. */
export function trainingAudience(users: AudienceMember[], matrix: PermissionMatrix, exclude: string | null): string[] {
  const self = exclude?.trim().toLowerCase() ?? "";
  const out = new Set<string>();
  for (const u of users) {
    const email = u.email?.trim().toLowerCase();
    if (!email || !email.includes("@") || email === self) continue;
    if (u.status !== "active") continue;
    if (!hasPermission(matrix, u.role, "view_ai_training")) continue;
    out.add(email);
  }
  return [...out];
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/** A bell message before it is addressed; `adminOnly` ones are for the editors only. */
export type AnnouncementMessage = Omit<NewNotification, "recipientEmail"> & { adminOnly: boolean };

/** One bell message per new module, and one per new lesson in a module that already had lessons. */
export function announcementMessages(lessons: AnnouncedLesson[]): AnnouncementMessage[] {
  const out: AnnouncementMessage[] = [];
  const newModules = new Map<string, AnnouncedLesson[]>();
  for (const lesson of lessons) {
    if (lesson.module && lesson.moduleIsNew) {
      const list = newModules.get(lesson.module.id) ?? [];
      list.push(lesson);
      newModules.set(lesson.module.id, list);
      continue;
    }
    out.push({
      kind: NEW_LESSON_KIND,
      title: clip(`New lesson: ${lesson.title}`, 300),
      body: clip([lesson.module?.title, lesson.summary].filter(Boolean).join(" · ") || "AI Training", 2000),
      href: lesson.href,
      adminOnly: lesson.module?.adminOnly ?? false,
    });
  }
  for (const group of newModules.values()) {
    const first = group[0];
    const mod = first.module!;
    const titles = group.map((l) => l.title);
    out.push({
      kind: NEW_MODULE_KIND,
      title: clip(`New module: ${mod.title}`, 300),
      body: clip(titles.length === 1 ? `First lesson: ${titles[0]}` : `${titles.length} lessons: ${titles.join(", ")}`, 2000),
      href: first.href,
      adminOnly: mod.adminOnly,
    });
  }
  return out;
}

/** Every recipient × every message. Admin-only messages go to `editors` (already without the publisher) only. */
export function announcementNotifications(input: {
  lessons: AnnouncedLesson[];
  everyone: string[];
  editors: string[];
}): NewNotification[] {
  const editors = new Set(input.editors.map((e) => e.trim().toLowerCase()));
  const rows: NewNotification[] = [];
  for (const message of announcementMessages(input.lessons)) {
    const { adminOnly, ...note } = message;
    const recipients = adminOnly ? input.everyone.filter((e) => editors.has(e)) : input.everyone;
    for (const recipientEmail of recipients) rows.push({ recipientEmail, ...note });
  }
  return rows;
}
