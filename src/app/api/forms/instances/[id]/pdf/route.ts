import { errorResponse } from "@/lib/api/respond";
import { authorizeForms } from "@/lib/forms/access";
import { loadInstance, markExported } from "@/lib/forms/instances";
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
    const actor = await authorizeForms(request, "view_form_monitoring");
    const { id } = await context.params;

    const loaded = await loadInstance(id);
    if (!loaded) {
      return new Response(JSON.stringify({ error: "No such form." }), {
        status: 404,
        headers: { "content-type": "application/json" },
      });
    }

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
    return errorResponse(error, "forms/instance/pdf");
  }
}
