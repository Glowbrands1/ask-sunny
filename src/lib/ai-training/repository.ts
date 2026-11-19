import "server-only";

import { getSupabaseAdmin } from "@/lib/supabase/server";

import { canShowLesson, visibleCatalog } from "./catalog";
import type { LessonRow, ModuleRow, PageRow, TrackRow } from "./import";
import type {
  LessonStatus,
  SubmissionStatus,
  TrainingCatalog,
  TrainingLesson,
  TrainingLessonSummary,
  TrainingModule,
  TrainingPage,
  TrainingSubmission,
  TrainingTrack,
} from "./types";

/**
 * ============================================================================
 * AI TRAINING, SERVER-SIDE
 * ============================================================================
 *
 * The `ai_training_*` tables have RLS forced with NO policies (see the
 * migration), so every read and write is here, under the secret key, AFTER the
 * caller's permission was checked by the page or the Server Function that
 * calls in. `import "server-only"` makes a client component importing this a
 * build failure.
 *
 * WHAT IS NOT A CALLER'S TO SEE IS NEVER RETURNED. Drafts and admin-only
 * modules are filtered here for a non-administrator, and a submission is
 * returned to its author or an administrator only — the browser is never
 * handed rows and trusted not to render them.
 */

const LESSON_SUMMARY_COLUMNS =
  "id, track_id, module_id, slug, title, summary, week_number, sort_order, status, published_at";

interface TrackDb {
  id: string;
  slug: string;
  title: string;
  sort_order: number;
}
interface ModuleDb {
  id: string;
  track_id: string;
  slug: string;
  title: string;
  sort_order: number;
  admin_only: boolean;
}
interface LessonDb {
  id: string;
  track_id: string;
  module_id: string | null;
  slug: string;
  title: string;
  summary: string | null;
  week_number: number | null;
  sort_order: number;
  status: LessonStatus;
  published_at: string | null;
  body_md?: string;
  updated_at?: string;
}
interface PageDb {
  key: string;
  title: string;
  body_md: string;
  updated_at: string | null;
}
interface SubmissionDb {
  id: string;
  lesson_id: string | null;
  user_subject: string;
  user_name: string;
  title: string;
  body: string;
  link_url: string | null;
  status: SubmissionStatus;
  feedback: string;
  reviewed_by_name: string | null;
  reviewed_at: string | null;
  created_at: string;
}

const track = (r: TrackDb): TrainingTrack => ({ id: r.id, slug: r.slug, title: r.title, sortOrder: r.sort_order });
const trainingModule = (r: ModuleDb): TrainingModule => ({
  id: r.id,
  trackId: r.track_id,
  slug: r.slug,
  title: r.title,
  sortOrder: r.sort_order,
  adminOnly: r.admin_only,
});
const lessonSummary = (r: LessonDb): TrainingLessonSummary => ({
  id: r.id,
  trackId: r.track_id,
  moduleId: r.module_id,
  slug: r.slug,
  title: r.title,
  summary: r.summary,
  weekNumber: r.week_number,
  sortOrder: r.sort_order,
  status: r.status,
  publishedAt: r.published_at,
});
const lesson = (r: LessonDb): TrainingLesson => ({
  ...lessonSummary(r),
  bodyMd: r.body_md ?? "",
  updatedAt: r.updated_at ?? "",
});
const page = (r: PageDb): TrainingPage => ({ key: r.key, title: r.title, bodyMd: r.body_md, updatedAt: r.updated_at });

function fail(what: string, error: { message: string } | null): never {
  throw new Error(`AI Training: could not ${what}${error ? ` (${error.message})` : ""}.`);
}

/* ---------------- reads ---------------- */

async function fullCatalog(): Promise<TrainingCatalog> {
  const db = getSupabaseAdmin();
  const [tracks, modules, lessons] = await Promise.all([
    db.from("ai_training_tracks").select("id, slug, title, sort_order").order("sort_order"),
    db.from("ai_training_modules").select("id, track_id, slug, title, sort_order, admin_only").order("sort_order"),
    db.from("ai_training_lessons").select(LESSON_SUMMARY_COLUMNS).order("sort_order"),
  ]);
  if (tracks.error) fail("read the tracks", tracks.error);
  if (modules.error) fail("read the modules", modules.error);
  if (lessons.error) fail("read the lessons", lessons.error);
  return {
    tracks: (tracks.data as TrackDb[]).map(track),
    modules: (modules.data as ModuleDb[]).map(trainingModule),
    lessons: (lessons.data as LessonDb[]).map(lessonSummary),
  };
}

/** The catalog this reader may see. */
export async function loadCatalog(isAdmin: boolean): Promise<TrainingCatalog> {
  return visibleCatalog(await fullCatalog(), isAdmin);
}

export interface LessonView {
  lesson: TrainingLesson;
  track: TrainingTrack;
  module: TrainingModule | null;
}

/** One lesson by its track and slug, or null when it does not exist FOR THIS READER. */
export async function getLessonBySlug(trackSlug: string, slug: string, isAdmin: boolean): Promise<LessonView | null> {
  const db = getSupabaseAdmin();
  const { data: trackRow, error: trackError } = await db
    .from("ai_training_tracks")
    .select("id, slug, title, sort_order")
    .eq("slug", trackSlug)
    .maybeSingle();
  if (trackError) fail("read the track", trackError);
  if (!trackRow) return null;
  const { data, error } = await db
    .from("ai_training_lessons")
    .select(`${LESSON_SUMMARY_COLUMNS}, body_md, updated_at`)
    .eq("track_id", (trackRow as TrackDb).id)
    .eq("slug", slug)
    .maybeSingle();
  if (error) fail("read the lesson", error);
  if (!data) return null;
  return withModule(lesson(data as LessonDb), track(trackRow as TrackDb), isAdmin);
}

/** One lesson by id, for the editor. Administrators only — the caller checks. */
export async function getLessonById(id: string): Promise<TrainingLesson | null> {
  const { data, error } = await getSupabaseAdmin()
    .from("ai_training_lessons")
    .select(`${LESSON_SUMMARY_COLUMNS}, body_md, updated_at`)
    .eq("id", id)
    .maybeSingle();
  if (error) fail("read the lesson", error);
  return data ? lesson(data as LessonDb) : null;
}

async function withModule(found: TrainingLesson, trackValue: TrainingTrack, isAdmin: boolean): Promise<LessonView | null> {
  let moduleValue: TrainingModule | null = null;
  if (found.moduleId) {
    const { data, error } = await getSupabaseAdmin()
      .from("ai_training_modules")
      .select("id, track_id, slug, title, sort_order, admin_only")
      .eq("id", found.moduleId)
      .maybeSingle();
    if (error) fail("read the module", error);
    moduleValue = data ? trainingModule(data as ModuleDb) : null;
  }
  if (!canShowLesson(found, moduleValue ? [moduleValue] : [], isAdmin)) return null;
  return { lesson: found, track: trackValue, module: moduleValue };
}

export async function getPage(key: string): Promise<TrainingPage | null> {
  const { data, error } = await getSupabaseAdmin()
    .from("ai_training_pages")
    .select("key, title, body_md, updated_at")
    .eq("key", key)
    .maybeSingle();
  if (error) fail("read the page", error);
  return data ? page(data as PageDb) : null;
}

export async function listPages(): Promise<TrainingPage[]> {
  const { data, error } = await getSupabaseAdmin()
    .from("ai_training_pages")
    .select("key, title, body_md, updated_at")
    .order("key");
  if (error) fail("read the pages", error);
  return (data as PageDb[]).map(page);
}

/* ---------------- content writes (administrators; the caller checks) ---------------- */

export interface LessonInput {
  trackId: string;
  moduleId: string | null;
  slug: string;
  title: string;
  summary: string | null;
  bodyMd: string;
  weekNumber: number | null;
  status: LessonStatus;
}

/** Creates (no id) or updates a lesson. Publishing stamps `published_at` the first time. */
export async function saveLesson(id: string | null, input: LessonInput): Promise<string> {
  const db = getSupabaseAdmin();
  const row = {
    track_id: input.trackId,
    module_id: input.moduleId,
    slug: input.slug,
    title: input.title,
    summary: input.summary,
    body_md: input.bodyMd,
    week_number: input.weekNumber,
    status: input.status,
  };
  if (id) {
    const existing = await getLessonById(id);
    if (!existing) fail("find that lesson", null);
    const publishedAt =
      input.status === "published" ? existing.publishedAt ?? new Date().toISOString() : existing.publishedAt;
    const { error } = await db.from("ai_training_lessons").update({ ...row, published_at: publishedAt }).eq("id", id);
    if (error) fail(error.code === "23505" ? "save it: another lesson in this track already uses that slug" : "save the lesson", error.code === "23505" ? null : error);
    return id;
  }
  const { data: last } = await db
    .from("ai_training_lessons")
    .select("sort_order")
    .eq("track_id", input.trackId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const { data, error } = await db
    .from("ai_training_lessons")
    .insert({
      ...row,
      sort_order: ((last as { sort_order: number } | null)?.sort_order ?? 0) + 1,
      published_at: input.status === "published" ? new Date().toISOString() : null,
    })
    .select("id")
    .single();
  if (error) fail(error.code === "23505" ? "save it: another lesson in this track already uses that slug" : "create the lesson", error.code === "23505" ? null : error);
  return (data as { id: string }).id;
}

export async function deleteModule(id: string): Promise<void> {
  const { error } = await getSupabaseAdmin().from("ai_training_modules").delete().eq("id", id);
  if (error) fail("remove the module", error);
}

export async function deleteLesson(id: string): Promise<void> {
  const { error } = await getSupabaseAdmin().from("ai_training_lessons").delete().eq("id", id);
  if (error) fail("delete the lesson", error);
}

/** Swaps a lesson with its neighbour in the same track and module. */
export async function moveLesson(id: string, direction: "up" | "down"): Promise<void> {
  const db = getSupabaseAdmin();
  const current = await getLessonById(id);
  if (!current) return;
  let query = db
    .from("ai_training_lessons")
    .select("id, sort_order")
    .eq("track_id", current.trackId)
    .order("sort_order", { ascending: direction === "down" });
  query = current.moduleId ? query.eq("module_id", current.moduleId) : query.is("module_id", null);
  query =
    direction === "up" ? query.lt("sort_order", current.sortOrder) : query.gt("sort_order", current.sortOrder);
  const { data: rows, error } = await query.limit(1);
  if (error) fail("reorder the lessons", error);
  const neighbour = (rows as { id: string; sort_order: number }[])[0];
  if (!neighbour) return;
  const a = await db.from("ai_training_lessons").update({ sort_order: neighbour.sort_order }).eq("id", current.id);
  const b = await db.from("ai_training_lessons").update({ sort_order: current.sortOrder }).eq("id", neighbour.id);
  if (a.error || b.error) fail("reorder the lessons", a.error ?? b.error);
}

export async function savePage(key: string, title: string, bodyMd: string): Promise<void> {
  const { error } = await getSupabaseAdmin()
    .from("ai_training_pages")
    .upsert({ key, title, body_md: bodyMd }, { onConflict: "key" });
  if (error) fail("save the page", error);
}

export async function saveModule(
  id: string | null,
  input: { trackId: string; title: string; slug: string; adminOnly: boolean },
): Promise<string> {
  const db = getSupabaseAdmin();
  if (id) {
    const { error } = await db
      .from("ai_training_modules")
      .update({ title: input.title, admin_only: input.adminOnly })
      .eq("id", id);
    if (error) fail("save the module", error);
    return id;
  }
  const { data: last } = await db
    .from("ai_training_modules")
    .select("sort_order")
    .eq("track_id", input.trackId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const { data, error } = await db
    .from("ai_training_modules")
    .insert({
      track_id: input.trackId,
      slug: input.slug,
      title: input.title,
      admin_only: input.adminOnly,
      sort_order: ((last as { sort_order: number } | null)?.sort_order ?? 0) + 1,
    })
    .select("id")
    .single();
  if (error) fail(error.code === "23505" ? "add it: a module with that name already exists" : "add the module", error.code === "23505" ? null : error);
  return (data as { id: string }).id;
}

export async function saveTrack(input: { slug: string; title: string }): Promise<void> {
  const db = getSupabaseAdmin();
  const { data: last } = await db
    .from("ai_training_tracks")
    .select("sort_order")
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const { error } = await db.from("ai_training_tracks").insert({
    slug: input.slug,
    title: input.title,
    sort_order: ((last as { sort_order: number } | null)?.sort_order ?? 0) + 1,
  });
  if (error) fail(error.code === "23505" ? "add it: a track with that name already exists" : "add the track", error.code === "23505" ? null : error);
}

/** Upserts one table's imported rows by id (pages by key). */
export async function importRows(
  table: "tracks" | "modules" | "lessons" | "pages",
  rows: TrackRow[] | ModuleRow[] | LessonRow[] | PageRow[],
): Promise<number> {
  if (!rows.length) return 0;
  const name = {
    tracks: "ai_training_tracks",
    modules: "ai_training_modules",
    lessons: "ai_training_lessons",
    pages: "ai_training_pages",
  }[table];
  const { error } = await getSupabaseAdmin()
    .from(name)
    .upsert(rows as unknown as Record<string, unknown>[], { onConflict: table === "pages" ? "key" : "id" });
  if (error) fail(`import the ${table}`, error);
  return rows.length;
}

/* ---------------- submissions ---------------- */

const SUBMISSION_COLUMNS =
  "id, lesson_id, user_subject, user_name, title, body, link_url, status, feedback, reviewed_by_name, reviewed_at, created_at";

async function withLessons(rows: SubmissionDb[]): Promise<TrainingSubmission[]> {
  const ids = [...new Set(rows.map((r) => r.lesson_id).filter((v): v is string => !!v))];
  const lessons = new Map<string, { title: string; href: string }>();
  if (ids.length) {
    const db = getSupabaseAdmin();
    const { data } = await db.from("ai_training_lessons").select("id, slug, title, track_id").in("id", ids);
    const { data: tracks } = await db.from("ai_training_tracks").select("id, slug");
    const slugOf = new Map(((tracks ?? []) as { id: string; slug: string }[]).map((t) => [t.id, t.slug]));
    for (const l of (data ?? []) as { id: string; slug: string; title: string; track_id: string }[]) {
      lessons.set(l.id, { title: l.title, href: `/ai-training/${slugOf.get(l.track_id) ?? ""}/${l.slug}` });
    }
  }
  return rows.map((r) => ({
    id: r.id,
    lessonId: r.lesson_id,
    lessonTitle: r.lesson_id ? lessons.get(r.lesson_id)?.title ?? null : null,
    lessonHref: r.lesson_id ? lessons.get(r.lesson_id)?.href ?? null : null,
    userName: r.user_name,
    title: r.title,
    body: r.body,
    linkUrl: r.link_url,
    status: r.status,
    feedback: r.feedback,
    reviewedByName: r.reviewed_by_name,
    reviewedAt: r.reviewed_at,
    createdAt: r.created_at,
  }));
}

export async function createSubmission(input: {
  lessonId: string;
  userSubject: string;
  userName: string;
  userEmail: string;
  title: string;
  body: string;
  linkUrl: string | null;
}): Promise<void> {
  const { error } = await getSupabaseAdmin().from("ai_training_submissions").insert({
    lesson_id: input.lessonId,
    user_subject: input.userSubject,
    user_name: input.userName,
    user_email: input.userEmail,
    title: input.title,
    body: input.body,
    link_url: input.linkUrl,
  });
  if (error) fail("save your submission", error);
}

/** The caller's own submissions, newest first. */
export async function listMySubmissions(userSubject: string): Promise<TrainingSubmission[]> {
  const { data, error } = await getSupabaseAdmin()
    .from("ai_training_submissions")
    .select(SUBMISSION_COLUMNS)
    .eq("user_subject", userSubject)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) fail("read your submissions", error);
  return withLessons(data as SubmissionDb[]);
}

/** Everybody's submissions, for review. Administrators only — the caller checks. */
export async function listSubmissionsForReview(status: SubmissionStatus | "all"): Promise<TrainingSubmission[]> {
  let query = getSupabaseAdmin()
    .from("ai_training_submissions")
    .select(SUBMISSION_COLUMNS)
    .order("created_at", { ascending: false })
    .limit(300);
  if (status !== "all") query = query.eq("status", status);
  const { data, error } = await query;
  if (error) fail("read the submissions", error);
  return withLessons(data as SubmissionDb[]);
}

export async function reviewSubmission(
  id: string,
  status: SubmissionStatus,
  feedback: string,
  reviewerName: string,
): Promise<void> {
  const { error } = await getSupabaseAdmin()
    .from("ai_training_submissions")
    .update({
      status,
      feedback,
      reviewed_by_name: status === "pending" ? null : reviewerName,
      reviewed_at: status === "pending" ? null : new Date().toISOString(),
    })
    .eq("id", id);
  if (error) fail("save the review", error);
}

/** The author edits a submission; that sends it back to review. */
export async function updateOwnSubmission(
  id: string,
  userSubject: string,
  input: { title: string; body: string; linkUrl: string | null },
): Promise<boolean> {
  const { data, error } = await getSupabaseAdmin()
    .from("ai_training_submissions")
    .update({ title: input.title, body: input.body, link_url: input.linkUrl, status: "pending" })
    .eq("id", id)
    .eq("user_subject", userSubject)
    .neq("status", "approved")
    .select("id");
  if (error) fail("save your submission", error);
  return (data ?? []).length > 0;
}

/* ---------------- publishing to the other app ---------------- */

const SYNC_COLUMNS = {
  tracks: "id, slug, title, sort_order",
  modules: "id, track_id, slug, title, sort_order, admin_only",
  lessons: "id, track_id, module_id, slug, title, summary, body_md, week_number, sort_order, status, published_at",
  pages: "key, title, body_md",
} as const;

/**
 * The saved rows to send to the other app, with their parents so they exist
 * there too: a lesson brings its track and module, a module its track.
 * Column names are the importer's, so the receiver validates them as an import.
 */
export async function loadSyncBundle(target: { lessonId?: string; moduleId?: string; pageKey?: string }): Promise<{
  tracks: Record<string, unknown>[];
  modules: Record<string, unknown>[];
  lessons: Record<string, unknown>[];
  content_pages: Record<string, unknown>[];
}> {
  const db = getSupabaseAdmin();
  const one = async (table: string, columns: string, column: string, value: string) => {
    const { data, error } = await db.from(table).select(columns).eq(column, value).maybeSingle();
    if (error) fail("read the saved change", error);
    if (!data) fail("read the saved change", null);
    return data as unknown as Record<string, unknown>;
  };
  const out = { tracks: [] as Record<string, unknown>[], modules: [] as Record<string, unknown>[], lessons: [] as Record<string, unknown>[], content_pages: [] as Record<string, unknown>[] };
  if (target.pageKey) out.content_pages.push(await one("ai_training_pages", SYNC_COLUMNS.pages, "key", target.pageKey));
  let moduleId = target.moduleId ?? null;
  let trackId: string | null = null;
  if (target.lessonId) {
    const lesson = await one("ai_training_lessons", SYNC_COLUMNS.lessons, "id", target.lessonId);
    out.lessons.push(lesson);
    trackId = String(lesson.track_id);
    moduleId = (lesson.module_id as string | null) ?? null;
  }
  if (moduleId) {
    const mod = await one("ai_training_modules", SYNC_COLUMNS.modules, "id", moduleId);
    out.modules.push(mod);
    trackId = String(mod.track_id);
  }
  if (trackId) out.tracks.push(await one("ai_training_tracks", SYNC_COLUMNS.tracks, "id", trackId));
  return out;
}

/** Adds tracks this app does not have yet; an existing track keeps its own name and order. */
export async function addMissingTracks(rows: TrackRow[]): Promise<number> {
  if (!rows.length) return 0;
  const { error } = await getSupabaseAdmin()
    .from("ai_training_tracks")
    .upsert(rows as unknown as Record<string, unknown>[], { onConflict: "id", ignoreDuplicates: true });
  if (error) fail("add the track", error);
  return rows.length;
}

/**
 * Before a published change is saved here: does a DIFFERENT lesson, module or
 * track here already use the same web address or name? Returns what the editor
 * should do, in plain words (it is shown after "not published to <this app>: "),
 * or null when nothing clashes.
 */
export async function findSyncClash(parsed: {
  tracks: TrackRow[];
  modules: ModuleRow[];
  lessons: LessonRow[];
}): Promise<string | null> {
  const db = getSupabaseAdmin();
  for (const t of parsed.tracks) {
    const { data } = await db.from("ai_training_tracks").select("id").eq("slug", t.slug).neq("id", t.id).limit(1);
    if (data?.length) return `it already has a different training track named like "${t.title}". Ask for help to line the two apps' tracks up.`;
  }
  for (const m of parsed.modules) {
    const { data } = await db.from("ai_training_modules").select("title").eq("track_id", m.track_id).eq("slug", m.slug).neq("id", m.id).limit(1);
    const other = (data as { title: string }[] | null)?.[0];
    if (other) return `it already has a different module called "${other.title}" in this track. Rename this module and save again.`;
  }
  for (const l of parsed.lessons) {
    const { data } = await db.from("ai_training_lessons").select("title").eq("track_id", l.track_id).eq("slug", l.slug).neq("id", l.id).limit(1);
    const other = (data as { title: string }[] | null)?.[0];
    if (other) return `it already has a different lesson ("${other.title}") using the web address "${l.slug}". Change this lesson's web address and save again.`;
  }
  return null;
}

