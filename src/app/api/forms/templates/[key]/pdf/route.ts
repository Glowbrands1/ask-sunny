import { NextResponse } from "next/server";

import { assertWithinRateLimit, errorResponse } from "@/lib/api/respond";
import { authorizeForms } from "@/lib/forms/access";
import { fieldsForVariant } from "@/lib/forms/document";
import {
  activateAssetVersion,
  FORMS_BUCKET,
  getCurrentVersion,
  getTemplateByKey,
  listAssets,
  recordAssetVersion,
} from "@/lib/forms/repository";
import { buildAssetPath, inspectPdf, sha256Hex, validateFieldMap } from "@/lib/forms/pdf-inspect";
import { getSupabaseAdmin } from "@/lib/supabase/server";

/**
 * REPLACE WITH NEW PDF — and the part that is not magic.
 *
 * POST  multipart upload of a replacement PDF
 * PUT   activate an earlier version again (revert, including to the bundled
 *       default)
 *
 * The upload is inspected BEFORE anything about the app's behaviour changes:
 *
 *   not a PDF, or unreadable  -> rejected. The row is written with the reason
 *                                so the attempt is on the record, the bytes are
 *                                not stored, and the previous version stays
 *                                active.
 *   no AcroForm fields        -> accepted as the official reference copy.
 *                                Generated downloads keep coming from the
 *                                structured renderer.
 *   AcroForm fields present   -> accepted, fields enumerated, and offered for
 *                                mapping. It becomes fillable only once a
 *                                mapping validates against both the PDF and the
 *                                template version.
 *
 * Nothing is ever overwritten. Each replacement is a new version and the
 * previous one keeps its bytes, so reverting is a pointer change rather than a
 * restore from somewhere.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const MAX_BYTES = 25 * 1024 * 1024;

export async function POST(request: Request, context: { params: Promise<{ key: string }> }) {
  try {
    const actor = await authorizeForms(request, "manage_form_templates");
    assertWithinRateLimit(request, "upload");
    const { key } = await context.params;

    const template = await getTemplateByKey(key);
    if (!template) {
      return NextResponse.json({ error: "No such form template." }, { status: 404 });
    }

    const form = await request.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No PDF was included." }, { status: 400 });
    }
    // Checked before the bytes are read into memory.
    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        { error: `That PDF is larger than the ${MAX_BYTES / (1024 * 1024)} MB limit.` },
        { status: 413 },
      );
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const inspection = await inspectPdf(bytes);
    const digest = await sha256Hex(bytes);
    const assets = await listAssets(template.id);
    const nextVersion = (assets[0]?.version ?? 0) + 1;

    if (!inspection.ok) {
      /*
       * FAIL CLOSED. The rejection is recorded — an administrator uploading the
       * wrong file is a normal event worth being able to see — but the bytes
       * are not stored and the active version does not move.
       */
      const recorded = await recordAssetVersion(template.id, {
        fileName: file.name || "upload.pdf",
        storagePath: `${key}/rejected/${digest.slice(0, 16)}`,
        contentSha256: digest,
        sizeBytes: bytes.byteLength,
        pageCount: inspection.pageCount,
        acroform: { ...inspection.acroform },
        validation: { rejected: inspection.rejection, notes: inspection.notes },
        accepted: false,
        uploadedBy: actor.id,
      });
      return NextResponse.json(
        { accepted: false, reason: inspection.rejection, asset: recorded },
        { status: 422 },
      );
    }

    const storagePath = buildAssetPath(key, nextVersion, digest, file.name || "upload.pdf");
    const supabase = getSupabaseAdmin();
    const { error: uploadError } = await supabase.storage
      .from(FORMS_BUCKET)
      .upload(storagePath, bytes, { contentType: "application/pdf", upsert: false });
    if (uploadError && !/already exists/i.test(uploadError.message)) {
      throw new Error(`The PDF could not be stored: ${uploadError.message}`);
    }

    const recorded = await recordAssetVersion(template.id, {
      fileName: file.name || "upload.pdf",
      storagePath,
      contentSha256: digest,
      sizeBytes: bytes.byteLength,
      pageCount: inspection.pageCount,
      acroform: { ...inspection.acroform },
      validation: {
        renderer: inspection.renderer,
        notes: inspection.notes,
        // Recorded so the screen can say WHY a PDF is or is not fillable
        // without re-opening the file.
        fillable: inspection.acroform.hasFields ? "needs_mapping" : "not_fillable",
      },
      accepted: true,
      uploadedBy: actor.id,
    });

    return NextResponse.json({ accepted: true, asset: recorded, inspection });
  } catch (error) {
    return errorResponse(error, "forms/template/pdf/replace");
  }
}

export async function PUT(request: Request, context: { params: Promise<{ key: string }> }) {
  try {
    await authorizeForms(request, "manage_form_templates");
    const { key } = await context.params;

    const template = await getTemplateByKey(key);
    if (!template) {
      return NextResponse.json({ error: "No such form template." }, { status: 404 });
    }

    const body = (await request.json().catch(() => null)) as {
      assetId?: string;
      fieldMap?: Record<string, string>;
    } | null;
    if (!body?.assetId) {
      return NextResponse.json({ error: "Which PDF version?" }, { status: 400 });
    }

    /*
     * A MAPPING IS VALIDATED AGAINST BOTH SIDES BEFORE IT IS ACCEPTED. A PDF
     * field the file does not have would drop a value silently; a template key
     * the version does not have would write one nobody can see.
     */
    if (body.fieldMap) {
      const assets = await listAssets(template.id);
      const asset = assets.find((entry) => entry.id === body.assetId);
      if (!asset) {
        return NextResponse.json({ error: "That PDF is not this template's." }, { status: 404 });
      }
      const version = await getCurrentVersion(template.id);
      if (!version) {
        return NextResponse.json({ error: "This template has no published version." }, { status: 409 });
      }
      const pdfFields = Array.isArray(asset.acroform.fieldNames)
        ? (asset.acroform.fieldNames as string[])
        : [];
      const templateKeys = fieldsForVariant(version.document, version.variants[0]?.key ?? null).map(
        (field) => field.key,
      );
      const result = validateFieldMap(body.fieldMap, pdfFields, templateKeys);
      if (!result.ok) {
        return NextResponse.json({ error: "That mapping does not fit.", problems: result.problems }, { status: 422 });
      }
    }

    const asset = await activateAssetVersion(template.id, body.assetId);
    return NextResponse.json({ asset });
  } catch (error) {
    return errorResponse(error, "forms/template/pdf/activate");
  }
}
