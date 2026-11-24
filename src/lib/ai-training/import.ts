/**
 * IMPORTING THE OLD APP'S CONTENT.
 *
 * The JBA AI Training app keeps its lessons in its own database. What reaches
 * this app is an export of four tables — `tracks`, `modules`, `lessons` and
 * `content_pages` — as one CSV per table (Lovable's Database screen) or one
 * JSON object with a key per table. This module turns either into rows for the
 * `ai_training_*` tables. Pure: it runs in the browser before upload, and in a
 * test.
 *
 * Rows keep their ids, so importing a newer export again UPDATES rather than
 * duplicates. Columns this app does not have are dropped; nothing is invented
 * for a column the export lacks beyond the table's own defaults.
 */

export type ImportTable = "tracks" | "modules" | "lessons" | "pages";

export interface TrackRow {
  id: string;
  slug: string;
  title: string;
  sort_order: number;
}

export interface ModuleRow {
  id: string;
  track_id: string;
  slug: string;
  title: string;
  sort_order: number;
  admin_only: boolean;
}

export interface LessonRow {
  id: string;
  track_id: string;
  module_id: string | null;
  slug: string;
  title: string;
  summary: string | null;
  body_md: string;
  week_number: number | null;
  sort_order: number;
  status: "draft" | "published";
  published_at: string | null;
}

export interface PageRow {
  key: string;
  title: string;
  body_md: string;
}

export interface ParsedImport {
  tracks: TrackRow[];
  modules: ModuleRow[];
  lessons: LessonRow[];
  pages: PageRow[];
  /** Files or rows that could not be used, in words an administrator can act on. */
  problems: string[];
}

type Raw = Record<string, unknown>;

/* ---------------- CSV ---------------- */

/** RFC 4180 CSV: quoted fields, doubled quotes, commas and newlines inside quotes. */
export function parseCsv(text: string): Raw[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"' && field === "") quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  const nonEmpty = rows.filter((r) => r.some((cell) => cell.trim() !== ""));
  if (!nonEmpty.length) return [];
  const [header, ...body] = nonEmpty;
  const keys = header.map((h) => h.trim());
  return body.map((cells) => Object.fromEntries(keys.map((k, i) => [k, cells[i] ?? ""])));
}

/* ---------------- detection ---------------- */

/** Which table a file holds, from its name first and its columns second. */
export function detectTable(fileName: string, columns: string[]): ImportTable | null {
  const name = fileName.toLowerCase();
  if (/content[_-]?pages/.test(name)) return "pages";
  if (/lessons/.test(name)) return "lessons";
  if (/modules/.test(name)) return "modules";
  if (/tracks/.test(name)) return "tracks";
  const has = (c: string) => columns.includes(c);
  if (has("key") && has("body_md")) return "pages";
  if (has("body_md") && has("track_id")) return "lessons";
  if (has("admin_only") && has("track_id")) return "modules";
  if (has("slug") && has("title") && !has("track_id")) return "tracks";
  return null;
}

/* ---------------- values ---------------- */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function text(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v);
}

function nullableText(v: unknown): string | null {
  const s = text(v);
  return s === "" || s === "NULL" || s === "null" ? null : s;
}

function int(v: unknown, fallback: number): number {
  const s = text(v).trim();
  if (!s || s === "NULL" || s === "null") return fallback;
  const n = Number(s);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function nullableInt(v: unknown): number | null {
  const s = text(v).trim();
  if (!s || s === "NULL" || s === "null") return null;
  const n = Number(s);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function bool(v: unknown): boolean {
  if (typeof v === "boolean") return v;
  return ["true", "t", "1", "yes"].includes(text(v).trim().toLowerCase());
}

function uuid(v: unknown): string | null {
  const s = text(v).trim();
  return UUID.test(s) ? s.toLowerCase() : null;
}

/* ---------------- rows ---------------- */

function toTrack(r: Raw): TrackRow | string {
  const id = uuid(r.id);
  const slug = text(r.slug).trim();
  const title = text(r.title).trim();
  if (!id || !slug || !title) return `a track without an id, slug or title (${slug || title || "blank"})`;
  return { id, slug, title, sort_order: int(r.sort_order, 0) };
}

function toModule(r: Raw): ModuleRow | string {
  const id = uuid(r.id);
  const track = uuid(r.track_id);
  const slug = text(r.slug).trim();
  const title = text(r.title).trim();
  if (!id || !track || !slug || !title) return `a module without an id, track, slug or title (${title || slug || "blank"})`;
  return { id, track_id: track, slug, title, sort_order: int(r.sort_order, 0), admin_only: bool(r.admin_only) };
}

function toLesson(r: Raw): LessonRow | string {
  const id = uuid(r.id);
  const track = uuid(r.track_id);
  const slug = text(r.slug).trim();
  const title = text(r.title).trim();
  if (!id || !track || !slug || !title) return `a lesson without an id, track, slug or title (${title || slug || "blank"})`;
  const status = text(r.status).trim() === "published" ? "published" : "draft";
  return {
    id,
    track_id: track,
    module_id: uuid(r.module_id),
    slug,
    title,
    summary: nullableText(r.summary),
    body_md: text(r.body_md),
    week_number: nullableInt(r.week_number),
    sort_order: int(r.sort_order, 0),
    status,
    published_at: nullableText(r.published_at),
  };
}

function toPage(r: Raw): PageRow | string {
  const key = text(r.key).trim();
  if (!/^[a-z0-9_]{1,60}$/.test(key)) return `a page with an unusable key (${key || "blank"})`;
  return { key, title: text(r.title).trim() || key, body_md: text(r.body_md) };
}

const MAPPERS = { tracks: toTrack, modules: toModule, lessons: toLesson, pages: toPage } as const;

function collect(out: ParsedImport, table: ImportTable, rows: Raw[]) {
  const mapper = MAPPERS[table] as (r: Raw) => TrackRow | ModuleRow | LessonRow | PageRow | string;
  for (const raw of rows) {
    const row = mapper(raw);
    if (typeof row === "string") out.problems.push(`Skipped ${row}.`);
    else (out[table] as unknown[]).push(row);
  }
}

/** Every file of an export, parsed and sorted by table. */
export function parseImportFiles(files: { name: string; text: string }[]): ParsedImport {
  const out: ParsedImport = { tracks: [], modules: [], lessons: [], pages: [], problems: [] };
  for (const file of files) {
    const trimmed = file.text.trim();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      let json: unknown;
      try {
        json = JSON.parse(trimmed);
      } catch {
        out.problems.push(`${file.name} is not valid JSON.`);
        continue;
      }
      if (Array.isArray(json)) {
        const table = detectTable(file.name, Object.keys((json[0] as Raw) ?? {}));
        if (table) collect(out, table, json as Raw[]);
        else out.problems.push(`Could not tell which table ${file.name} holds.`);
        continue;
      }
      const obj = json as Record<string, unknown>;
      const pick = (...keys: string[]) => keys.map((k) => obj[k]).find(Array.isArray) as Raw[] | undefined;
      const tables: [ImportTable, Raw[] | undefined][] = [
        ["tracks", pick("tracks")],
        ["modules", pick("modules")],
        ["lessons", pick("lessons")],
        ["pages", pick("content_pages", "pages")],
      ];
      if (!tables.some(([, rows]) => rows)) out.problems.push(`${file.name} has none of tracks, modules, lessons or content_pages.`);
      for (const [table, rows] of tables) if (rows) collect(out, table, rows);
      continue;
    }
    const rows = parseCsv(file.text);
    const table = detectTable(file.name, Object.keys(rows[0] ?? {}));
    if (!table) {
      out.problems.push(`Could not tell which table ${file.name} holds. Name it tracks, modules, lessons or content_pages.`);
      continue;
    }
    collect(out, table, rows);
  }

  // A module or lesson pointing at a track (or module) the export does not contain cannot be saved.
  const trackIds = new Set(out.tracks.map((t) => t.id));
  const moduleIds = new Set(out.modules.map((m) => m.id));
  if (trackIds.size) {
    out.modules = out.modules.filter((m) => trackIds.has(m.track_id) || !out.problems.push(`Skipped module "${m.title}": its track is not in the export.`));
    out.lessons = out.lessons.filter((l) => trackIds.has(l.track_id) || !out.problems.push(`Skipped lesson "${l.title}": its track is not in the export.`));
  }
  if (moduleIds.size) {
    for (const lesson of out.lessons) {
      if (lesson.module_id && !moduleIds.has(lesson.module_id)) {
        out.problems.push(`Lesson "${lesson.title}" names a module that is not in the export; it is imported without one.`);
        lesson.module_id = null;
      }
    }
  }
  return out;
}
