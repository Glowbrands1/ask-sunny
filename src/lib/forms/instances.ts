import "server-only";

import { getSupabaseAdmin } from "@/lib/supabase/server";

import { parseFormDocument, parseFormVariants, type FieldResponsibility } from "./document";
import { enforcePersonEdit, enforceResponsibilities, type DraftValues } from "./responsibility";
import { getCurrentVersion, getVersion, type TemplateVersionRow } from "./repository";

/**
 * THE FORMS THEMSELVES — one employee, one conversation, one record.
 *
 * Two rules are enforced by the database and relied on here rather than
 * re-checked: a finalized form's values cannot be edited, and the version a
 * form was filled from cannot be deleted or rewritten. So "what did this say
 * when it was signed" always has an answer.
 *
 * Everything a person or the assistant submits passes through the
 * responsibility guards on the way in. That is the only path into
 * `form_instance_values`, which is what makes "the assistant never fills a
 * signature" a property of the system rather than a promise about a prompt.
 */

export type InstanceStatus = "draft" | "finalized" | "revised";
export type InstanceSource = "manual" | "ask_sunny";

export interface InstanceRow {
  id: string;
  templateId: string;
  templateKey: string;
  templateName: string;
  templateShortName: string;
  layoutFamily: string;
  templateVersionId: string;
  templateVersion: number;
  variantKey: string | null;
  employeeName: string;
  employeeRole: string | null;
  locationId: string | null;
  locationName: string | null;
  createdBy: string;
  createdByRole: string | null;
  source: InstanceSource;
  status: InstanceStatus;
  formDate: string;
  followUpDate: string | null;
  finalizedAt: string | null;
  exportedAt: string | null;
  revisesInstanceId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface InstanceValueRow {
  fieldKey: string;
  value: string | null;
  checked: string[];
  filledBy: FieldResponsibility;
  provenance: Record<string, unknown>;
}

export interface InstanceEventRow {
  kind: string;
  actor: string;
  detail: Record<string, unknown>;
  createdAt: string;
}

function mapInstance(row: Record<string, unknown>): InstanceRow {
  return {
    id: String(row.id),
    templateId: String(row.template_id),
    templateKey: String(row.template_key ?? ""),
    templateName: String(row.template_name ?? ""),
    templateShortName: String(row.template_short_name ?? ""),
    layoutFamily: String(row.layout_family ?? ""),
    templateVersionId: String(row.template_version_id),
    templateVersion: Number(row.template_version ?? 0),
    variantKey: (row.variant_key as string | null) ?? null,
    employeeName: String(row.employee_name),
    employeeRole: (row.employee_role as string | null) ?? null,
    locationId: (row.location_id as string | null) ?? null,
    locationName: (row.location_name as string | null) ?? null,
    createdBy: String(row.created_by),
    createdByRole: (row.created_by_role as string | null) ?? null,
    source: row.source as InstanceSource,
    status: row.status as InstanceStatus,
    formDate: String(row.form_date),
    followUpDate: (row.follow_up_date as string | null) ?? null,
    finalizedAt: (row.finalized_at as string | null) ?? null,
    exportedAt: (row.exported_at as string | null) ?? null,
    revisesInstanceId: (row.revises_instance_id as string | null) ?? null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapValue(row: Record<string, unknown>): InstanceValueRow {
  return {
    fieldKey: String(row.field_key),
    value: (row.value as string | null) ?? null,
    checked: Array.isArray(row.checked) ? (row.checked as string[]) : [],
    filledBy: row.filled_by as FieldResponsibility,
    provenance: (row.provenance as Record<string, unknown>) ?? {},
  };
}

async function recordEvent(
  instanceId: string,
  kind: string,
  actor: string,
  detail: Record<string, unknown> = {},
): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from("form_instance_events")
    .insert({ instance_id: instanceId, kind, actor, detail });
  if (error) throw new Error(`Could not record the ${kind} event: ${error.message}`);
}

/* -------------------------------------------------------------- reading --- */

export async function listInstances(limit = 200): Promise<InstanceRow[]> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("form_instance_overview")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`Could not read form history: ${error.message}`);
  return (data ?? []).map(mapInstance);
}

export interface LoadedInstance {
  instance: InstanceRow;
  version: TemplateVersionRow;
  values: InstanceValueRow[];
  events: InstanceEventRow[];
}

export async function loadInstance(id: string): Promise<LoadedInstance | null> {
  const supabase = getSupabaseAdmin();

  const { data: row, error } = await supabase
    .from("form_instance_overview")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`Could not read that form: ${error.message}`);
  if (!row) return null;

  const instance = mapInstance(row);
  const version = await getVersion(instance.templateVersionId);
  if (!version) throw new Error("The template version this form was filled from is missing.");

  const [values, events] = await Promise.all([
    supabase.from("form_instance_values").select("*").eq("instance_id", id),
    supabase
      .from("form_instance_events")
      .select("*")
      .eq("instance_id", id)
      .order("created_at", { ascending: true }),
  ]);
  if (values.error) throw new Error(`Could not read the values: ${values.error.message}`);
  if (events.error) throw new Error(`Could not read the history: ${events.error.message}`);

  return {
    instance,
    version,
    values: (values.data ?? []).map(mapValue),
    events: (events.data ?? []).map((event) => ({
      kind: String(event.kind),
      actor: String(event.actor),
      detail: (event.detail as Record<string, unknown>) ?? {},
      createdAt: String(event.created_at),
    })),
  };
}

/* -------------------------------------------------------------- writing --- */

export interface NewInstance {
  templateKey: string;
  variantKey: string | null;
  employeeName: string;
  employeeRole?: string | null;
  locationId?: string | null;
  locationName?: string | null;
  createdBy: string;
  createdByRole?: string | null;
  source: InstanceSource;
  formDate?: string;
}

/**
 * Starts a form from the template's CURRENT published version.
 *
 * The version id is copied onto the form at creation and never re-resolved.
 * Publishing a new template version tomorrow leaves this form pointing at what
 * it was started from, which is the whole point of versioning.
 */
export async function createInstance(input: NewInstance): Promise<InstanceRow> {
  const supabase = getSupabaseAdmin();

  const { data: template, error: templateError } = await supabase
    .from("form_templates")
    .select("id, active")
    .eq("key", input.templateKey)
    .maybeSingle();
  if (templateError) throw new Error(`Could not read the template: ${templateError.message}`);
  if (!template) throw new Error(`No form template called "${input.templateKey}".`);
  if (!template.active) throw new Error("That form template is not active.");

  const version = await getCurrentVersion(String(template.id));
  if (!version) throw new Error("That template has no published version yet.");

  const { data, error } = await supabase
    .from("form_instances")
    .insert({
      template_id: template.id,
      template_version_id: version.id,
      variant_key: input.variantKey,
      employee_name: input.employeeName,
      employee_role: input.employeeRole ?? null,
      location_id: input.locationId ?? null,
      location_name: input.locationName ?? null,
      created_by: input.createdBy,
      created_by_role: input.createdByRole ?? null,
      source: input.source,
      status: "draft",
      ...(input.formDate ? { form_date: input.formDate } : {}),
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`Could not start the form: ${error?.message}`);

  await recordEvent(String(data.id), "created", input.createdBy, {
    templateKey: input.templateKey,
    templateVersion: version.version,
    variantKey: input.variantKey,
    source: input.source,
  });

  const loaded = await loadInstance(String(data.id));
  if (!loaded) throw new Error("The form vanished immediately after being created.");
  return loaded.instance;
}

async function writeValues(
  instanceId: string,
  accepted: DraftValues,
  filledBy: FieldResponsibility,
  provenance: Record<string, Record<string, unknown>> = {},
): Promise<void> {
  const supabase = getSupabaseAdmin();
  const rows = [
    ...Object.entries(accepted.values).map(([fieldKey, value]) => ({
      instance_id: instanceId,
      field_key: fieldKey,
      value,
      checked: [],
      filled_by: filledBy,
      provenance: provenance[fieldKey] ?? {},
      updated_at: new Date().toISOString(),
    })),
    ...Object.entries(accepted.checked).map(([fieldKey, checked]) => ({
      instance_id: instanceId,
      field_key: fieldKey,
      value: null,
      checked,
      filled_by: filledBy,
      provenance: provenance[fieldKey] ?? {},
      updated_at: new Date().toISOString(),
    })),
  ];
  if (rows.length === 0) return;

  const { error } = await supabase
    .from("form_instance_values")
    .upsert(rows, { onConflict: "instance_id,field_key" });
  if (error) throw new Error(`Could not save the form: ${error.message}`);
}

/** A person's edit. Hand-filled lines and signatures are refused. */
export async function saveInstanceValues(
  instanceId: string,
  submitted: Partial<DraftValues>,
  actor: string,
): Promise<{ rejected: { key: string; reason: string }[] }> {
  const loaded = await loadInstance(instanceId);
  if (!loaded) throw new Error("That form no longer exists.");
  if (loaded.instance.status !== "draft") {
    throw new Error("This form is finalized. Create a revision to change it.");
  }

  const document = parseFormDocument(loaded.version.document);
  const result = enforcePersonEdit(document, loaded.instance.variantKey, submitted);
  await writeValues(instanceId, { values: result.values, checked: result.checked }, "manager");
  await recordEvent(instanceId, "edited", actor, {
    fields: Object.keys(result.values).length,
    groups: Object.keys(result.checked).length,
    rejected: result.rejected,
  });

  return { rejected: result.rejected };
}

/**
 * The assistant's draft, after the guard.
 *
 * `filled_by: "ai"` is recorded on every value this writes, so Form Monitoring
 * can answer "did Ask Sunny write this, or did a manager?" per field rather
 * than per form.
 */
export async function applyAssistantDraft(
  instanceId: string,
  draft: Partial<DraftValues>,
  actor: string,
  provenance: Record<string, Record<string, unknown>> = {},
): Promise<{ accepted: DraftValues; rejected: { key: string; reason: string }[] }> {
  const loaded = await loadInstance(instanceId);
  if (!loaded) throw new Error("That form no longer exists.");
  if (loaded.instance.status !== "draft") {
    throw new Error("This form is finalized. Create a revision to change it.");
  }

  const document = parseFormDocument(loaded.version.document);
  const result = enforceResponsibilities(document, loaded.instance.variantKey, draft);
  await writeValues(
    instanceId,
    { values: result.values, checked: result.checked },
    "ai",
    provenance,
  );
  await recordEvent(instanceId, "drafted", actor, {
    fields: Object.keys(result.values),
    rejected: result.rejected,
  });

  return {
    accepted: { values: result.values, checked: result.checked },
    rejected: result.rejected,
  };
}

export async function finalizeInstance(
  instanceId: string,
  actor: string,
  followUpDate: string | null,
): Promise<InstanceRow> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("form_instances")
    .update({
      status: "finalized",
      finalized_at: new Date().toISOString(),
      follow_up_date: followUpDate,
    })
    .eq("id", instanceId)
    .eq("status", "draft")
    .select("id")
    .single();
  if (error || !data) throw new Error(`Could not finalize the form: ${error?.message}`);

  await recordEvent(instanceId, "finalized", actor, { followUpDate });
  const loaded = await loadInstance(instanceId);
  if (!loaded) throw new Error("The finalized form could not be read back.");
  return loaded.instance;
}

export async function markExported(instanceId: string, actor: string): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from("form_instances")
    .update({ exported_at: new Date().toISOString() })
    .eq("id", instanceId);
  if (error) throw new Error(`Could not record the export: ${error.message}`);
  await recordEvent(instanceId, "exported", actor);
}

/**
 * A revision, or the re-evaluation stage of an EPP.
 *
 * The new form copies the old one's values and points back at it, so the
 * DMIT lifecycle — review, plan, follow-up, re-evaluation — reads as one
 * history instead of unrelated documents that happen to share a name. The
 * original is marked `revised` and stays exactly as it was signed.
 */
export async function reviseInstance(
  instanceId: string,
  actor: string,
  kind: "revised" | "reevaluated",
): Promise<InstanceRow> {
  const supabase = getSupabaseAdmin();
  const loaded = await loadInstance(instanceId);
  if (!loaded) throw new Error("That form no longer exists.");
  if (loaded.instance.status === "revised") {
    throw new Error("That form has already been revised.");
  }

  const version = await getCurrentVersion(loaded.instance.templateId);
  const { data, error } = await supabase
    .from("form_instances")
    .insert({
      template_id: loaded.instance.templateId,
      // A revision is filled against the CURRENT version, which may be newer
      // than the original's — and the original keeps pointing at its own.
      template_version_id: version?.id ?? loaded.instance.templateVersionId,
      variant_key: loaded.instance.variantKey,
      employee_name: loaded.instance.employeeName,
      employee_role: loaded.instance.employeeRole,
      location_id: loaded.instance.locationId,
      location_name: loaded.instance.locationName,
      created_by: actor,
      created_by_role: loaded.instance.createdByRole,
      source: loaded.instance.source,
      status: "draft",
      revises_instance_id: loaded.instance.id,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`Could not open the revision: ${error?.message}`);

  const carried = loaded.values.filter((value) => value.filledBy !== "signature");
  if (carried.length > 0) {
    const { error: valueError } = await supabase.from("form_instance_values").insert(
      carried.map((value) => ({
        instance_id: data.id,
        field_key: value.fieldKey,
        value: value.value,
        checked: value.checked,
        filled_by: value.filledBy,
        provenance: value.provenance,
      })),
    );
    if (valueError) throw new Error(`Could not carry the values over: ${valueError.message}`);
  }

  if (loaded.instance.status === "finalized") {
    await supabase.from("form_instances").update({ status: "revised" }).eq("id", instanceId);
  }

  await recordEvent(instanceId, kind, actor, { revisionId: data.id });
  await recordEvent(String(data.id), "created", actor, { revisionOf: instanceId, kind });

  const revision = await loadInstance(String(data.id));
  if (!revision) throw new Error("The revision could not be read back.");
  return revision.instance;
}

/** Variants a form may be printed as, from its own version. */
export function variantsOf(version: TemplateVersionRow) {
  return parseFormVariants(version.variants);
}
