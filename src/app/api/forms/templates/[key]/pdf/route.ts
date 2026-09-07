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
import { buildAssetPath, sha256Hex, validateFieldMap } from "@/lib/forms/pdf-inspect";
import { inspectSourceDocument } from "@/lib/forms/source-document";
import { FORMAT_LABEL, type SourceFormat } from "@/lib/forms/source-format";
import { getSupabaseAdmin } from "@/lib/supabase/server";

/**
 * REPLACE THE OFFICIAL COPY — and the part that is not magic.
 *
 * POST  multipart upload of a replacement PDF **or Word document**
 * PUT   activate an earlier version again (revert, including to the bundled
 *       default)
 *
 * THE ROUTE IS STILL CALLED `pdf`, and that is deliberate rather than lazy: it
 * is the endpoint every existing caller and every stored link already names,
 * and adding a second route for the same job would leave two ways to replace
 * one file — which is exactly the duplication this endpoint's own versioning
 * rules exist to avoid. What changed is what it accepts, not what it does.
 *
 * The upload is inspected BEFORE anything about the app's behaviour changes,
 * and what the inspection can say depends on the format — see
 * `lib/forms/source-document.ts`:
 *
 *   neither PDF nor Word     -> rejected. The row is written with the reason
 *                               so the attempt is on the record, the bytes are
 *                               not stored, and the previous version stays
 *                               active.
 *   an unreadable Word file  -> rejected the same way.
 *   a Word document          -> accepted as the official reference copy, stored
 *                               byte for byte under its own content type.
 *                               Nothing is converted, so the format cannot be
 *                               broken on the way in.
 *   PDF, no AcroForm fields  -> accepted as the official reference copy.
 *                               Generated downloads keep coming from the
 *                               structured renderer.
 *   PDF with AcroForm fields -> accepted, fields enumerated, and offered for
 *                               mapping. It becomes fillable only once a
 *                               mapping validates against both the PDF and the
 *                               template version. A Word file NEVER reaches
 *                               this case: nothing here can write into one, so
 *                               it reports no fillable fields at all.
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
      return NextResponse.json({ error: "No file was included." }, { status: 400 });
    }
    // Checked before the bytes are read into memory.
    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        { error: `That file is larger than the ${MAX_BYTES / (1024 * 1024)} MB limit.` },
        { status: 413 },
      );
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const inspection = await inspectSourceDocument(bytes);
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
        fileName: file.name || "upload",
        storagePath: `${key}/rejected/${digest.slice(0, 16)}`,
        contentSha256: digest,
        sizeBytes: bytes.byteLength,
        mimeType: inspection.contentType,
        pageCount: inspection.pageCount,
        acroform: { ...inspection.acroform },
        validation: {
          format: inspection.format,
          rejected: inspection.rejection,
          notes: inspection.notes,
        },
        accepted: false,
        uploadedBy: actor.id,
      });
      return NextResponse.json(
        { accepted: false, reason: inspection.rejection, asset: recorded },
        { status: 422 },
      );
    }

    /*
     * THE FORMAT COMES FROM THE INSPECTION, NOT FROM THE FILE NAME. The stored
     * path keeps the uploaded name and its extension; where a browser sent none,
     * the extension the bytes actually are is used. The content type is the one
     * the inspection determined, so a Word document is served back as a Word
     * document rather than as a PDF that will not open.
     */
    const format = inspection.format as SourceFormat;
    const storagePath = buildAssetPath(
      key,
      nextVersion,
      digest,
      file.name || "",
      inspection.extension,
    );
    const supabase = getSupabaseAdmin();
    const { error: uploadError } = await supabase.storage
      .from(FORMS_BUCKET)
      .upload(storagePath, bytes, { contentType: inspection.contentType, upsert: false });
    if (uploadError && !/already exists/i.test(uploadError.message)) {
      throw new Error(`The file could not be stored: ${uploadError.message}`);
    }

    const recorded = await recordAssetVersion(template.id, {
      fileName: file.name || `upload${inspection.extension}`,
      storagePath,
      contentSha256: digest,
      sizeBytes: bytes.byteLength,
      mimeType: inspection.contentType,
      pageCount: inspection.pageCount,
      acroform: { ...inspection.acroform },
      validation: {
        format,
        formatLabel: FORMAT_LABEL[format],
        renderer: inspection.renderer,
        notes: inspection.notes,
        ...(inspection.word ? { word: inspection.word } : {}),
        // Recorded so the screen can say WHY a file is or is not fillable
        // without re-opening it.
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
      return NextResponse.json({ error: "Which stored version?" }, { status: 400 });
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
        return NextResponse.json({ error: "That file is not this template's." }, { status: 404 });
      }
      const version = await getCurrentVersion(template.id);
      if (!version) {
        return NextResponse.json({ error: "This template has no published version." }, { status: 409 });
      }
      /*
       * Only a PDF can ever get here with fields to map: `hasFields` is false
       * for every Word upload, so `pdfFields` is empty and any mapping naming a
       * field is refused with "the PDF has no field called …". That is the
       * correct refusal — there is nothing in this app that can write into a
       * .docx — and it falls out of the inspection rather than needing a
       * separate format check here.
       */
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
