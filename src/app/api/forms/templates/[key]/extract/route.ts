import { NextResponse } from "next/server";

import { assertWithinRateLimit, errorResponse } from "@/lib/api/respond";
import { authorizeForms } from "@/lib/forms/access";
import { ingestSourceDocument } from "@/lib/forms/ingest";
import {
  FORMS_BUCKET,
  getCurrentVersion,
  getTemplateByKey,
  listAssets,
  openProposalDraft,
} from "@/lib/forms/repository";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import type { SourceFormat } from "@/lib/forms/source-format";

/**
 * POST /api/forms/templates/[key]/extract
 *
 * READS A STORED DOCUMENT INTO A PROPOSED FORM.
 *
 * The upload route runs this same library function on the way in, so the common
 * path needs no second call. This endpoint exists for the two cases that one
 * cannot serve: RE-READING a document after an extraction failed or after a
 * draft was cleared, and reading an EARLIER stored version rather than the
 * active one. Both are the same operation against bytes that are already
 * stored, which is why they are one endpoint and not two.
 *
 * WHAT IT CANNOT DO. It cannot publish. It cannot touch the current version. It
 * cannot overwrite an open draft — `openProposalDraft` refuses, and the refusal
 * is returned as a 409 with what to do. The worst outcome of calling this is a
 * new draft nobody has to accept.
 *
 * AUTHORIZED ON `manage_form_templates`, the same permission the template
 * editor and the upload require. There is deliberately no lower gate: this
 * writes a version of a form, and being able to upload a file is not the same
 * right as being able to change what a form asks.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(request: Request, context: { params: Promise<{ key: string }> }) {
  try {
    const actor = await authorizeForms(request, "manage_form_templates");
    assertWithinRateLimit(request, "upload");
    const { key } = await context.params;

    const template = await getTemplateByKey(key);
    if (!template) {
      return NextResponse.json({ error: "No such form template." }, { status: 404 });
    }

    const body = (await request.json().catch(() => null)) as { assetId?: string } | null;
    const assets = await listAssets(template.id);
    const asset = body?.assetId
      ? assets.find((entry) => entry.id === body.assetId)
      : assets.find((entry) => entry.status === "active" && entry.storagePath);

    if (!asset) {
      return NextResponse.json(
        { error: "No stored document to read. Upload a PDF or Word file first." },
        { status: 404 },
      );
    }
    if (asset.status === "rejected" || !asset.storagePath) {
      return NextResponse.json(
        { error: "That upload was never stored, so there is nothing to read." },
        { status: 409 },
      );
    }

    const supabase = getSupabaseAdmin();
    const download = await supabase.storage.from(FORMS_BUCKET).download(asset.storagePath);
    if (download.error || !download.data) {
      throw new Error(`The stored document could not be read: ${download.error?.message}`);
    }
    const bytes = new Uint8Array(await download.data.arrayBuffer());

    const current = await getCurrentVersion(template.id);
    const result = await ingestSourceDocument({
      bytes,
      fileName: asset.fileName,
      current: current?.document ?? null,
      refine: true,
    });

    if (!result.ok) {
      /*
       * A FAILED EXTRACTION IS A 422 AND NOTHING ELSE HAPPENS. No draft, no
       * version, no change to what the template points at. The stored document
       * stays exactly where it was, so the answer to "did this damage the live
       * form" is that there was no code path by which it could.
       */
      return NextResponse.json(
        { extracted: false, reason: result.reason, format: result.format },
        { status: 422 },
      );
    }

    const opened = await openProposalDraft(
      template.id,
      {
        document: result.document,
        proposal: {
          assetId: asset.id,
          fileName: asset.fileName,
          format: result.format as SourceFormat,
          extractedAt: new Date().toISOString(),
          extractedBy: actor.id,
          ...result.report,
        },
        notes: `Proposed from ${asset.fileName}. Review it before publishing.`,
      },
      actor.id,
    );

    if ("refused" in opened) {
      return NextResponse.json({ extracted: false, reason: opened.refused }, { status: 409 });
    }

    return NextResponse.json({
      extracted: true,
      format: result.format,
      draft: { id: opened.draft.id, version: opened.draft.version },
      proposal: opened.draft.proposal,
      notes: result.notes,
    });
  } catch (error) {
    return errorResponse(error, "forms/template/extract");
  }
}
