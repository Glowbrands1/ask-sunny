import { errorResponse } from "@/lib/api/respond";
import { authorizeInstance, InstanceNotVisibleError } from "@/lib/forms/instance-scope";
import { markExported } from "@/lib/forms/instances";
import { parseFormVariants } from "@/lib/forms/document";
import { pdfFileName, renderFormPdf } from "@/lib/forms/pdf-render";

/**
 * GET /api/forms/instances/[id]/pdf
 *
 * The download. Rendered from the template version this form was FILLED FROM —
 * not the current one — so a form downloaded a year later still prints the
 * document that was signed.
 *
 * The export is recorded on the form's history, because "who took a copy of
 * this and when" is a reasonable question about an HR record.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    /*
     * A PDF IS THE WHOLE RECORD, so this needs the same salon check as reading
     * it on screen. It asked only for `view_form_monitoring`, which every
     * manager role holds — so a guessed UUID returned another salon's finalized
     * disciplinary document as a downloadable file.
     */
    const { actor, loaded } = await authorizeInstance(request, id, "view");

    const variants = parseFormVariants(loaded.version.variants);
    const variant = variants.find((entry) => entry.key === loaded.instance.variantKey) ?? null;

    const values: Record<string, string> = {};
    const checked: Record<string, string[]> = {};
    for (const row of loaded.values) {
      if (row.value !== null) values[row.fieldKey] = row.value;
      if (row.checked.length > 0) checked[row.fieldKey] = row.checked;
    }

    const meta = {
      templateName: loaded.instance.templateName,
      templateVersion: loaded.instance.templateVersion,
      employeeName: loaded.instance.employeeName,
      formDate: loaded.instance.formDate,
      locationName: loaded.instance.locationName,
      reference: loaded.instance.id.slice(0, 8),
      status: loaded.instance.status,
    };

    const bytes = renderFormPdf(loaded.version.document, variant, { values, checked }, meta);
    await markExported(id, actor.id);

    return new Response(bytes as BodyInit, {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `attachment; filename="${pdfFileName(meta)}"`,
        // An HR record must not sit in a shared cache.
        "cache-control": "no-store, private",
      },
    });
  } catch (error) {
    // The same answer a missing form gets — see `instance-scope.ts`.
    if (error instanceof InstanceNotVisibleError) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 404,
        headers: { "content-type": "application/json" },
      });
    }
    return errorResponse(error, "forms/instance/pdf");
  }
}
