"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";

import { slugify } from "@/lib/ai-training/catalog";
import type { LessonRow, ModuleRow, PageRow, TrackRow } from "@/lib/ai-training/import";
import {
  createSubmission,
  deleteLesson,
  deleteModule,
  getLessonById,
  importRows,
  loadSyncBundle,
  moveLesson,
  reviewSubmission,
  saveLesson,
  saveModule,
  savePage,
  saveTrack,
  updateOwnSubmission,
} from "@/lib/ai-training/repository";
import type { LessonStatus, SubmissionStatus } from "@/lib/ai-training/types";
import { authorizeRequest } from "@/lib/auth/server";
import type { AuthenticatedIdentity } from "@/lib/auth/types";
import { canEditAiTraining } from "@/lib/ai-training/editors";
import { cleanNewModuleTitle } from "@/lib/ai-training/module-name";
import { publishAfterSave, syncConfig } from "@/lib/ai-training/sync";

/**
 * AI TRAINING'S SERVER FUNCTIONS.
 *
 * A Server Function can be called directly by anyone who can reach the app, so
 * every one of these checks the caller first — through `authorizeRequest`, the
 * same check every API route uses (verified identity, `view_ai_training` in the
 * server's matrix) — and validates its inputs here rather than trusting the
 * form that sent them. Editing the program additionally needs an admin console
 * role (`ADMIN_CONSOLE_ROLES`), the same answer the rest of this app gives to
 * "who administers it".
 *
 * They RETURN failures rather than throwing: a production build replaces a
 * thrown message with a generic one, and "that slug is taken" is something the
 * administrator needs to read.
 */

/** `warning`: saved here, but something after the save (publishing to the other app) did not work. */
export type ActionResult<T = undefined> = { ok: true; value?: T; warning?: string } | { ok: false; message: string };

/** Publishes the just-saved rows to the other app when the editor asked; a warning or nothing. */
function publish(identity: AuthenticatedIdentity, asked: boolean | undefined, target: Parameters<typeof loadSyncBundle>[0]) {
  return publishAfterSave({ publish: asked, cfg: syncConfig(), actorEmail: identity.email, load: () => loadSyncBundle(target) });
}

async function caller(): Promise<AuthenticatedIdentity> {
  const request = new Request("http://ai-training.internal/", { headers: new Headers(await headers()) });
  return (await authorizeRequest(request, "view_ai_training")).identity;
}

async function administrator(): Promise<AuthenticatedIdentity> {
  const identity = await caller();
  if (!canEditAiTraining(identity)) throw new Error("Editing AI Training is limited to its named editors.");
  return identity;
}

async function attempt<T>(work: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, value: await work() };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Something went wrong.";
    return { ok: false, message };
  }
}

/** Like `attempt`, for a save that may also carry a warning about publishing it. */
async function attemptSave<T>(work: () => Promise<{ value: T; warning?: string }>): Promise<ActionResult<T>> {
  try {
    const { value, warning } = await work();
    return warning ? { ok: true, value, warning } : { ok: true, value };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Something went wrong.";
    return { ok: false, message };
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function id(value: unknown, what = "item"): string {
  if (typeof value !== "string" || !UUID.test(value)) throw new Error(`Unknown ${what}.`);
  return value;
}

function textField(value: unknown, label: string, max: number, required = true): string {
  const s = typeof value === "string" ? value.trim() : "";
  if (required && !s) throw new Error(`${label} is required.`);
  if (s.length > max) throw new Error(`${label} is too long (${max.toLocaleString()} characters at most).`);
  return s;
}

function linkField(value: unknown): string | null {
  const s = typeof value === "string" ? value.trim() : "";
  if (!s) return null;
  if (!/^https?:\/\/\S+$/i.test(s) || s.length > 2000) throw new Error("The link must start with http:// or https://.");
  return s;
}

function refresh() {
  revalidatePath("/ai-training", "layout");
}

/* ---------------- staff ---------------- */

export async function submitLessonResponse(input: {
  lessonId: string;
  title: string;
  body: string;
  linkUrl: string;
}): Promise<ActionResult> {
  return attempt(async () => {
    const identity = await caller();
    const lessonId = id(input?.lessonId, "lesson");
    const found = await getLessonById(lessonId);
    // A draft or archived lesson is not something staff can see, so not something they can submit to.
    if (!found || (found.status !== "published" && !canEditAiTraining(identity))) throw new Error("That lesson is not available.");
    const body = textField(input.body, "Your response", 20_000, false);
    const linkUrl = linkField(input.linkUrl);
    if (!body && !linkUrl) throw new Error("Write a response or add a link.");
    await createSubmission({
      lessonId,
      userSubject: identity.subject,
      userName: identity.displayName || identity.email,
      userEmail: identity.email,
      title: textField(input.title, "Title", 300, false) || found.title,
      body,
      linkUrl,
    });
    refresh();
    return undefined;
  });
}

export async function editMySubmission(input: {
  id: string;
  title: string;
  body: string;
  linkUrl: string;
}): Promise<ActionResult> {
  return attempt(async () => {
    const identity = await caller();
    const body = textField(input.body, "Your response", 20_000, false);
    const linkUrl = linkField(input.linkUrl);
    if (!body && !linkUrl) throw new Error("Write a response or add a link.");
    const saved = await updateOwnSubmission(id(input?.id, "submission"), identity.subject, {
      title: textField(input.title, "Title", 300),
      body,
      linkUrl,
    });
    if (!saved) throw new Error("That submission can no longer be edited.");
    refresh();
    return undefined;
  });
}

/* ---------------- administrators ---------------- */

export async function saveLessonAction(input: {
  id: string | null;
  trackId: string;
  moduleId: string | null;
  slug: string;
  title: string;
  summary: string;
  bodyMd: string;
  weekNumber: string;
  status: LessonStatus;
  /** Set when the editor chose "+ New module…": the module is created first, then the lesson saved into it. */
  newModuleTitle?: string | null;
  /** The "Also publish to <other app>" box. */
  publishToOther?: boolean;
}): Promise<ActionResult<{ lessonId: string; moduleId: string | null }>> {
  return attemptSave(async () => {
    const identity = await administrator();
    const title = textField(input.title, "Title", 300);
    const trackId = id(input.trackId, "track");
    const newModuleTitle = typeof input.newModuleTitle === "string" ? cleanNewModuleTitle(input.newModuleTitle) : null;
    const slug = slugify(textField(input.slug, "Slug", 160, false) || title);
    const week = typeof input.weekNumber === "string" ? input.weekNumber.trim() : "";
    if (week && !/^\d{1,4}$/.test(week)) throw new Error("Lesson number must be a whole number.");
    if (input.status !== "draft" && input.status !== "published") throw new Error("Unknown status.");
    if (typeof input.bodyMd !== "string" || input.bodyMd.length > 500_000) throw new Error("The lesson is too long.");
    const createdModuleId = newModuleTitle
      ? await saveModule(null, { trackId, title: newModuleTitle, slug: slugify(newModuleTitle), adminOnly: false })
      : null;
    const moduleId = createdModuleId ?? (input.moduleId ? id(input.moduleId, "module") : null);
    const lessonInput = {
      trackId,
      moduleId,
      slug,
      title,
      summary: textField(input.summary, "Summary", 2000, false) || null,
      bodyMd: input.bodyMd,
      weekNumber: week ? Number(week) : null,
      status: input.status,
    };
    let saved: string;
    try {
      saved = await saveLesson(input.id ? id(input.id, "lesson") : null, lessonInput);
    } catch (error) {
      // Undo the module made for this lesson, so fixing the lesson and saving again does not clash with it.
      if (createdModuleId) await deleteModule(createdModuleId).catch(() => undefined);
      throw error;
    }
    refresh();
    return {
      value: { lessonId: saved, moduleId },
      warning: await publish(identity, input.publishToOther, { lessonId: saved }),
    };
  });
}

export async function deleteLessonAction(lessonId: string): Promise<ActionResult> {
  return attempt(async () => {
    await administrator();
    await deleteLesson(id(lessonId, "lesson"));
    refresh();
    return undefined;
  });
}

export async function setLessonStatusAction(
  lessonId: string,
  status: LessonStatus,
  publishToOther?: boolean,
): Promise<ActionResult> {
  return attemptSave(async () => {
    const identity = await administrator();
    const found = await getLessonById(id(lessonId, "lesson"));
    if (!found) throw new Error("That lesson no longer exists.");
    if (status !== "draft" && status !== "published") throw new Error("Unknown status.");
    await saveLesson(found.id, { ...found, status });
    refresh();
    return { value: undefined, warning: await publish(identity, publishToOther, { lessonId: found.id }) };
  });
}

export async function moveLessonAction(lessonId: string, direction: "up" | "down"): Promise<ActionResult> {
  return attempt(async () => {
    await administrator();
    if (direction !== "up" && direction !== "down") throw new Error("Unknown direction.");
    await moveLesson(id(lessonId, "lesson"), direction);
    refresh();
    return undefined;
  });
}

export async function saveModuleAction(input: {
  id: string | null;
  trackId: string;
  title: string;
  adminOnly: boolean;
  publishToOther?: boolean;
}): Promise<ActionResult> {
  return attemptSave(async () => {
    const identity = await administrator();
    const title = textField(input.title, "Module name", 300);
    const moduleId = await saveModule(input.id ? id(input.id, "module") : null, {
      trackId: id(input.trackId, "track"),
      title,
      slug: slugify(title),
      adminOnly: input.adminOnly === true,
    });
    refresh();
    return { value: undefined, warning: await publish(identity, input.publishToOther, { moduleId }) };
  });
}

export async function addTrackAction(title: string): Promise<ActionResult> {
  return attempt(async () => {
    await administrator();
    const clean = textField(title, "Track name", 200);
    await saveTrack({ title: clean, slug: slugify(clean) });
    refresh();
    return undefined;
  });
}

export async function savePageAction(input: {
  key: string;
  title: string;
  bodyMd: string;
  publishToOther?: boolean;
}): Promise<ActionResult> {
  return attemptSave(async () => {
    const identity = await administrator();
    if (typeof input.key !== "string" || !/^[a-z0-9_]{1,60}$/.test(input.key)) throw new Error("Unknown page.");
    if (typeof input.bodyMd !== "string" || input.bodyMd.length > 500_000) throw new Error("The page is too long.");
    await savePage(input.key, textField(input.title, "Title", 300), input.bodyMd);
    refresh();
    return { value: undefined, warning: await publish(identity, input.publishToOther, { pageKey: input.key }) };
  });
}

export async function reviewSubmissionAction(input: {
  id: string;
  status: SubmissionStatus;
  feedback: string;
}): Promise<ActionResult> {
  return attempt(async () => {
    const identity = await administrator();
    if (!["pending", "approved", "changes_requested"].includes(input.status)) throw new Error("Unknown status.");
    await reviewSubmission(
      id(input.id, "submission"),
      input.status,
      textField(input.feedback, "Feedback", 10_000, false),
      identity.displayName || identity.email,
    );
    refresh();
    return undefined;
  });
}

/**
 * One table's worth of an import, already parsed in the browser by
 * `parseImportFiles`. The rows are re-checked here: ids must be uuids, and only
 * the known columns are written.
 */
export async function importTableAction(
  table: "tracks" | "modules" | "lessons" | "pages",
  rows: unknown[],
): Promise<ActionResult<number>> {
  return attempt(async () => {
    await administrator();
    if (!Array.isArray(rows) || rows.length > 500) throw new Error("Send at most 500 rows at a time.");
    const str = (v: unknown, max = 300) => (typeof v === "string" ? v.slice(0, max) : "");
    const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.trunc(v) : 0);
    const opt = (v: unknown) => (v === null || v === undefined ? null : id(v));
    const clean = rows.map((raw) => {
      const r = (raw ?? {}) as Record<string, unknown>;
      switch (table) {
        case "tracks":
          return { id: id(r.id, "track"), slug: slugify(str(r.slug)), title: str(r.title), sort_order: num(r.sort_order) } satisfies TrackRow;
        case "modules":
          return { id: id(r.id, "module"), track_id: id(r.track_id, "track"), slug: str(r.slug), title: str(r.title), sort_order: num(r.sort_order), admin_only: r.admin_only === true } satisfies ModuleRow;
        case "lessons":
          return {
            id: id(r.id, "lesson"),
            track_id: id(r.track_id, "track"),
            module_id: opt(r.module_id),
            slug: slugify(str(r.slug, 160)),
            title: str(r.title),
            summary: typeof r.summary === "string" ? r.summary.slice(0, 2000) : null,
            body_md: str(r.body_md, 500_000),
            week_number: typeof r.week_number === "number" ? Math.trunc(r.week_number) : null,
            sort_order: num(r.sort_order),
            status: r.status === "published" ? "published" : "draft",
            published_at: typeof r.published_at === "string" && !Number.isNaN(Date.parse(r.published_at)) ? r.published_at : null,
          } satisfies LessonRow;
        case "pages":
          if (typeof r.key !== "string" || !/^[a-z0-9_]{1,60}$/.test(r.key)) throw new Error("A page has an unusable key.");
          return { key: r.key, title: str(r.title) || r.key, body_md: str(r.body_md, 500_000) } satisfies PageRow;
      }
    });
    const count = await importRows(table, clean as TrackRow[]);
    refresh();
    return count;
  });
}
