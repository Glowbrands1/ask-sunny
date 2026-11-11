import { errorResponse } from "@/lib/api/respond";
import { isDemoMode } from "@/lib/config/runtime";
import { authorizeForms } from "@/lib/forms/access";
import { demoFormById, demoFormVersion, isDemoFormId } from "@/lib/demo/forms-fixtures";
import { authorizeInstance, InstanceNotVisibleError } from "@/lib/forms/instance-scope";
import { markExported } from "@/lib/forms/instances";
import { parseFormVariants } from "@/lib/forms/document";
import { pdfFileName, renderFormPdf } from "@/lib/forms/pdf-render";
import { formRevisionsEnabled } from "@/lib/config/chat-quality-flags";
import { loadRevisionHistory, marksFor } from "@/lib/forms/revision-chain";

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
    /*
     * DEMO: the seeded form printed from the real template it names — the
     * blank official layout under the record's own header. Nothing is marked
     * exported, because nothing is written. See `lib/demo/forms-fixtures.ts`.
     */
    if (isDemoMode() && isDemoFormId(id)) {
      await authorizeForms(request, "view_form_monitoring");
      const form = demoFormById(id);
      const version = form ? demoFormVersion(form) : null;
      if (form && version) {
        const variants = parseFormVariants(version.variants);
        const meta = {
          templateName: form.templateName,
          templateVersion: form.templateVersion,
          employeeName: form.employeeName,
          formDate: form.formDate,
          locationName: form.locationName,
          reference: form.id.slice(-8),
          status: form.status,
        };
        const bytes = renderFormPdf(
          version.document,
          variants.find((entry) => entry.key === form.variantKey) ?? null,
          { values: {}, checked: {} },
          meta,
        );
        return new Response(bytes as BodyInit, {
          headers: {
            "content-type": "application/pdf",
            "content-disposition": `attachment; filename="${pdfFileName(meta)}"`,
            "cache-control": "no-store, private",
          },
        });
      }
    }
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

    /*
     * REVISED AND SUPERSEDED, ON PAPER (`FORM_REVISIONS_ENABLED`). The marks
     * name only references; a record in the chain the caller could not open
     * is still named by its reference, which is what a filed page needs to
     * be matched up, and nothing else about it is printed.
     */
    const history = formRevisionsEnabled() ? await loadRevisionHistory(id) : null;
    const marks = history ? marksFor(history) : [];
    const printed = marks.length > 0 ? { ...meta, revisionMarks: marks } : meta;

    const bytes = renderFormPdf(loaded.version.document, variant, { values, checked }, printed);
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
