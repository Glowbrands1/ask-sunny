import "server-only";

import { getSupabaseAdmin } from "@/lib/supabase/server";

import {
  parseFormDocument,
  parseFormVariants,
  type FormDocument,
  type FormVariant,
} from "./document";
import { TEMPLATE_SEEDS } from "./library";

/**
 * THE FORMS SYSTEM OF RECORD.
 *
 * `import "server-only"` is the structural part: a client component that
 * imports this file is a build error, so employee HR records cannot be read
 * into a browser bundle by accident. Every function here runs behind a route
 * that has already called `authorizeRequest`, and the privileged key never
 * leaves this process.
 *
 * The database does the work the comments in the migration describe — a
 * published version cannot be edited, a finalized form's values cannot be
 * rewritten — so this layer does not re-implement those rules in TypeScript
 * where they could drift. It reads, it writes, and it lets the triggers refuse.
 */

export const FORMS_BUCKET = "forms-templates";

export interface TemplateRow {
  id: string;
  key: string;
  name: string;
  shortName: string;
  description: string;
  layoutFamily: "coaching" | "corrective" | "epp" | "dmit_epp";
  requiredPermission: string;
  active: boolean;
  displayOrder: number;
}

export interface TemplateVersionRow {
  id: string;
  templateId: string;
  version: number;
  status: "draft" | "published" | "archived";
  document: FormDocument;
  variants: FormVariant[];
  notes: string;
  createdBy: string;
  createdAt: string;
  publishedAt: string | null;
  publishedBy: string | null;
}

export interface TemplateAssetRow {
  id: string;
  templateId: string;
  version: number;
  kind: "bundled_default" | "upload";
  status: "active" | "superseded" | "rejected";
  fileName: string;
  storagePath: string | null;
  contentSha256: string | null;
  sizeBytes: number | null;
  pageCount: number | null;
  acroform: Record<string, unknown>;
  validation: Record<string, unknown>;
  uploadedBy: string;
  createdAt: string;
}

function mapTemplate(row: Record<string, unknown>): TemplateRow {
  return {
    id: String(row.id),
    key: String(row.key),
    name: String(row.name),
    shortName: String(row.short_name),
    description: String(row.description ?? ""),
    layoutFamily: row.layout_family as TemplateRow["layoutFamily"],
    requiredPermission: String(row.required_permission),
    active: Boolean(row.active),
    displayOrder: Number(row.display_order ?? 0),
  };
}

function mapVersion(row: Record<string, unknown>): TemplateVersionRow {
  return {
    id: String(row.id),
    templateId: String(row.template_id),
    version: Number(row.version),
    status: row.status as TemplateVersionRow["status"],
    document: parseFormDocument(row.document),
    variants: parseFormVariants(row.variants),
    notes: String(row.notes ?? ""),
    createdBy: String(row.created_by ?? "system"),
    createdAt: String(row.created_at),
    publishedAt: (row.published_at as string | null) ?? null,
    publishedBy: (row.published_by as string | null) ?? null,
  };
}

function mapAsset(row: Record<string, unknown>): TemplateAssetRow {
  return {
    id: String(row.id),
    templateId: String(row.template_id),
    version: Number(row.version),
    kind: row.kind as TemplateAssetRow["kind"],
    status: row.status as TemplateAssetRow["status"],
    fileName: String(row.file_name),
    storagePath: (row.storage_path as string | null) ?? null,
    contentSha256: (row.content_sha256 as string | null) ?? null,
    sizeBytes: row.size_bytes === null ? null : Number(row.size_bytes),
    pageCount: row.page_count === null ? null : Number(row.page_count),
    acroform: (row.acroform as Record<string, unknown>) ?? {},
    validation: (row.validation as Record<string, unknown>) ?? {},
    uploadedBy: String(row.uploaded_by ?? "system"),
    createdAt: String(row.created_at),
  };
}

/* ------------------------------------------------------------- library --- */

/**
 * Installs the nine templates, once.
 *
 * Idempotent by key: a template that already exists is left exactly as it is,
 * including any versions an administrator has published since. Seeding is how
 * an empty database gets the library — it is never a way to overwrite edited
 * templates with the code's idea of them.
 */
export async function ensureTemplateLibrary(actor = "system"): Promise<{
  created: string[];
  existing: string[];
}> {
  const supabase = getSupabaseAdmin();
  const created: string[] = [];
  const existing: string[] = [];

  const { data: rows, error } = await supabase.from("form_templates").select("key");
  if (error) throw new Error(`Could not read the template library: ${error.message}`);
  const known = new Set((rows ?? []).map((row) => String(row.key)));

  for (const seed of TEMPLATE_SEEDS) {
    if (known.has(seed.key)) {
      existing.push(seed.key);
      continue;
    }

    const { data: template, error: templateError } = await supabase
      .from("form_templates")
      .insert({
        key: seed.key,
        name: seed.name,
        short_name: seed.shortName,
        description: seed.description,
        layout_family: seed.layoutFamily,
        required_permission: seed.requiredPermission,
        display_order: seed.displayOrder,
      })
      .select("id")
      .single();
    if (templateError || !template) {
      throw new Error(`Could not create ${seed.key}: ${templateError?.message}`);
    }

    const { data: version, error: versionError } = await supabase
      .from("form_template_versions")
      .insert({
        template_id: template.id,
        version: 1,
        status: "published",
        document: seed.document,
        variants: seed.variants,
        notes: "Seeded from the approved reference forms.",
        created_by: actor,
        published_at: new Date().toISOString(),
        published_by: actor,
      })
      .select("id")
      .single();
    if (versionError || !version) {
      throw new Error(`Could not publish ${seed.key} v1: ${versionError?.message}`);
    }

    const { error: currentError } = await supabase
      .from("form_template_current")
      .insert({ template_id: template.id, version_id: version.id });
    if (currentError) {
      throw new Error(`Could not point ${seed.key} at v1: ${currentError.message}`);
    }

    /*
     * The bundled default PDF, recorded as version 1 of the asset chain.
     *
     * It has no storage path on purpose: the bundled default IS the structured
     * renderer, not a file somebody uploaded. Recording it anyway means
     * "Replace with new PDF" produces version 2 rather than version 1, so the
     * chain reads as a history from the beginning and reverting has somewhere
     * to revert TO.
     */
    const { error: assetError } = await supabase.from("form_template_assets").insert({
      template_id: template.id,
      version: 1,
      kind: "bundled_default",
      status: "active",
      file_name: seed.bundledPdfName,
      uploaded_by: actor,
      validation: {
        source: "bundled",
        renderer: "structured",
        note: "Generated by the structured renderer from the published template version.",
      },
    });
    if (assetError) {
      throw new Error(`Could not record ${seed.key}'s bundled PDF: ${assetError.message}`);
    }

    created.push(seed.key);
  }

  return { created, existing };
}

export interface TemplateSummary extends TemplateRow {
  currentVersion: TemplateVersionRow | null;
  draftVersion: TemplateVersionRow | null;
  versionCount: number;
  activeAsset: TemplateAssetRow | null;
  assetCount: number;
}

/** The template library screen, in one read per table rather than per card. */
export async function listTemplateSummaries(): Promise<TemplateSummary[]> {
  const supabase = getSupabaseAdmin();

  const [templates, versions, current, assets] = await Promise.all([
    supabase.from("form_templates").select("*").order("display_order"),
    supabase.from("form_template_versions").select("*").order("version", { ascending: false }),
    supabase.from("form_template_current").select("*"),
    supabase.from("form_template_assets").select("*").order("version", { ascending: false }),
  ]);

  for (const result of [templates, versions, current, assets]) {
    if (result.error) throw new Error(`Could not read the templates: ${result.error.message}`);
  }

  const currentByTemplate = new Map(
    (current.data ?? []).map((row) => [String(row.template_id), String(row.version_id)]),
  );
  const versionRows = (versions.data ?? []).map(mapVersion);
  const assetRows = (assets.data ?? []).map(mapAsset);

  return (templates.data ?? []).map((row) => {
    const template = mapTemplate(row);
    const mine = versionRows.filter((version) => version.templateId === template.id);
    const currentId = currentByTemplate.get(template.id);
    const myAssets = assetRows.filter((asset) => asset.templateId === template.id);

    return {
      ...template,
      currentVersion: mine.find((version) => version.id === currentId) ?? null,
      draftVersion: mine.find((version) => version.status === "draft") ?? null,
      versionCount: mine.length,
      activeAsset: myAssets.find((asset) => asset.status === "active") ?? null,
      assetCount: myAssets.length,
    };
  });
}

export async function getTemplateByKey(key: string): Promise<TemplateRow | null> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("form_templates")
    .select("*")
    .eq("key", key)
    .maybeSingle();
  if (error) throw new Error(`Could not read template ${key}: ${error.message}`);
  return data ? mapTemplate(data) : null;
}

export async function getVersion(versionId: string): Promise<TemplateVersionRow | null> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("form_template_versions")
    .select("*")
    .eq("id", versionId)
    .maybeSingle();
  if (error) throw new Error(`Could not read version ${versionId}: ${error.message}`);
  return data ? mapVersion(data) : null;
}

export async function listVersions(templateId: string): Promise<TemplateVersionRow[]> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("form_template_versions")
    .select("*")
    .eq("template_id", templateId)
    .order("version", { ascending: false });
  if (error) throw new Error(`Could not read versions: ${error.message}`);
  return (data ?? []).map(mapVersion);
}

/** The version a NEW form of this template is filled from. */
export async function getCurrentVersion(templateId: string): Promise<TemplateVersionRow | null> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("form_template_current")
    .select("version_id")
    .eq("template_id", templateId)
    .maybeSingle();
  if (error) throw new Error(`Could not resolve the current version: ${error.message}`);
  if (!data) return null;
  return getVersion(String(data.version_id));
}

/* ------------------------------------------------------------ authoring --- */

/**
 * Opens a draft to edit.
 *
 * The published version is never touched — it is CLONED. If a draft already
 * exists it is returned as-is, because the database allows only one per
 * template and silently replacing somebody's in-progress edit would be worse
 * than refusing.
 */
export async function openDraft(
  templateId: string,
  actor: string,
): Promise<{ draft: TemplateVersionRow; clonedFrom: number | null }> {
  const supabase = getSupabaseAdmin();

  const { data: existing, error: existingError } = await supabase
    .from("form_template_versions")
    .select("*")
    .eq("template_id", templateId)
    .eq("status", "draft")
    .maybeSingle();
  if (existingError) throw new Error(`Could not read the draft: ${existingError.message}`);
  if (existing) return { draft: mapVersion(existing), clonedFrom: null };

  const current = await getCurrentVersion(templateId);
  const versions = await listVersions(templateId);
  const nextVersion = (versions[0]?.version ?? 0) + 1;

  const { data, error } = await supabase
    .from("form_template_versions")
    .insert({
      template_id: templateId,
      version: nextVersion,
      status: "draft",
      document: current?.document ?? { paper: "letter", blocks: [] },
      variants: current?.variants ?? [],
      notes: current ? `Cloned from version ${current.version}.` : "New template.",
      created_by: actor,
    })
    .select("*")
    .single();
  if (error || !data) throw new Error(`Could not open a draft: ${error?.message}`);

  return { draft: mapVersion(data), clonedFrom: current?.version ?? null };
}

export async function saveDraft(
  versionId: string,
  document: FormDocument,
  variants: FormVariant[],
  notes: string,
): Promise<TemplateVersionRow> {
  const supabase = getSupabaseAdmin();
  // Parsed before it is stored: a document the reader cannot understand must
  // never reach the column in the first place.
  const validated = parseFormDocument(document);

  const { data, error } = await supabase
    .from("form_template_versions")
    .update({ document: validated, variants, notes })
    .eq("id", versionId)
    .eq("status", "draft")
    .select("*")
    .single();
  if (error || !data) throw new Error(`Could not save the draft: ${error?.message}`);
  return mapVersion(data);
}

/**
 * Publishes a draft and points the template at it.
 *
 * The previous current version is archived rather than deleted: forms filled
 * from it still reference it, and re-rendering one has to find the document it
 * was signed against.
 */
export async function publishDraft(
  versionId: string,
  actor: string,
): Promise<TemplateVersionRow> {
  const supabase = getSupabaseAdmin();

  const draft = await getVersion(versionId);
  if (!draft) throw new Error("That version no longer exists.");
  if (draft.status !== "draft") throw new Error("Only a draft can be published.");

  const previous = await getCurrentVersion(draft.templateId);

  const { data, error } = await supabase
    .from("form_template_versions")
    .update({
      status: "published",
      published_at: new Date().toISOString(),
      published_by: actor,
    })
    .eq("id", versionId)
    .select("*")
    .single();
  if (error || !data) throw new Error(`Could not publish: ${error?.message}`);

  /*
   * `onConflict` NAMED EXPLICITLY. One row per template is the point of this
   * table, and leaving the conflict target to be inferred is how a second row
   * appears — after which "which version is current" has two answers and the
   * read fails. Named here so the intent is in the code rather than in the
   * schema's primary key.
   */
  const { error: currentError } = await supabase
    .from("form_template_current")
    .upsert(
      { template_id: draft.templateId, version_id: versionId, updated_at: new Date().toISOString() },
      { onConflict: "template_id" },
    );
  if (currentError) throw new Error(`Could not activate the version: ${currentError.message}`);

  if (previous && previous.id !== versionId) {
    await supabase
      .from("form_template_versions")
      .update({ status: "archived", archived_at: new Date().toISOString() })
      .eq("id", previous.id);
  }

  return mapVersion(data);
}

export async function discardDraft(versionId: string): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from("form_template_versions")
    .delete()
    .eq("id", versionId)
    .eq("status", "draft");
  if (error) throw new Error(`Could not discard the draft: ${error.message}`);
}

/* --------------------------------------------------------------- assets --- */

export async function listAssets(templateId: string): Promise<TemplateAssetRow[]> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("form_template_assets")
    .select("*")
    .eq("template_id", templateId)
    .order("version", { ascending: false });
  if (error) throw new Error(`Could not read the PDF versions: ${error.message}`);
  return (data ?? []).map(mapAsset);
}

export interface RecordedAsset {
  fileName: string;
  storagePath: string;
  contentSha256: string;
  sizeBytes: number;
  pageCount: number | null;
  acroform: Record<string, unknown>;
  validation: Record<string, unknown>;
  /** A rejected upload is recorded and never becomes active. */
  accepted: boolean;
  uploadedBy: string;
}

/**
 * Adds a PDF version. Never overwrites one.
 *
 * An accepted upload becomes active and the previous active row is marked
 * superseded, keeping its bytes and its record. A rejected upload is stored
 * with its reason and changes nothing about what the app serves — which is what
 * "fail closed" means here.
 */
export async function recordAssetVersion(
  templateId: string,
  asset: RecordedAsset,
): Promise<TemplateAssetRow> {
  const supabase = getSupabaseAdmin();
  const existing = await listAssets(templateId);
  const nextVersion = (existing[0]?.version ?? 0) + 1;
  const active = existing.find((entry) => entry.status === "active");

  if (asset.accepted && active) {
    const { error } = await supabase
      .from("form_template_assets")
      .update({ status: "superseded", superseded_at: new Date().toISOString() })
      .eq("id", active.id);
    if (error) throw new Error(`Could not supersede the previous PDF: ${error.message}`);
  }

  const { data, error } = await supabase
    .from("form_template_assets")
    .insert({
      template_id: templateId,
      version: nextVersion,
      kind: "upload",
      status: asset.accepted ? "active" : "rejected",
      file_name: asset.fileName,
      storage_bucket: FORMS_BUCKET,
      storage_path: asset.storagePath,
      content_sha256: asset.contentSha256,
      size_bytes: asset.sizeBytes,
      page_count: asset.pageCount,
      acroform: asset.acroform,
      validation: asset.validation,
      uploaded_by: asset.uploadedBy,
    })
    .select("*")
    .single();
  if (error || !data) throw new Error(`Could not record the PDF: ${error?.message}`);

  if (asset.accepted && active) {
    await supabase
      .from("form_template_assets")
      .update({ superseded_by: data.id })
      .eq("id", active.id);
  }

  return mapAsset(data);
}

/**
 * Reverts to an earlier PDF version — including the bundled default.
 *
 * Nothing is deleted: the version being left is marked superseded and the one
 * being returned to becomes active again, so the chain still reads as a
 * history.
 */
export async function activateAssetVersion(
  templateId: string,
  assetId: string,
): Promise<TemplateAssetRow> {
  const supabase = getSupabaseAdmin();
  const assets = await listAssets(templateId);
  const target = assets.find((entry) => entry.id === assetId);
  if (!target) throw new Error("That PDF version does not belong to this template.");
  if (target.status === "rejected") {
    throw new Error("A rejected upload cannot be activated.");
  }

  const active = assets.find((entry) => entry.status === "active");
  if (active && active.id !== assetId) {
    await supabase
      .from("form_template_assets")
      .update({ status: "superseded", superseded_at: new Date().toISOString() })
      .eq("id", active.id);
  }

  const { data, error } = await supabase
    .from("form_template_assets")
    .update({ status: "active", superseded_at: null, superseded_by: null })
    .eq("id", assetId)
    .select("*")
    .single();
  if (error || !data) throw new Error(`Could not activate that PDF: ${error?.message}`);
  return mapAsset(data);
}
