import { errorResponse } from "@/lib/api/respond";
import { authorizeForms } from "@/lib/forms/access";
import { fieldsForVariant } from "@/lib/forms/document";
import { renderFormPdf } from "@/lib/forms/pdf-render";
import { getCurrentVersion, getTemplateByKey, listVersions } from "@/lib/forms/repository";

/**
 * GET /api/forms/templates/[key]/preview
 *
 * The Preview button. Renders the template — the open draft if there is one,
 * otherwise the published version — with PLACEHOLDER text in every field, so an
 * administrator can see what the printed form looks like before publishing.
 *
 * The placeholders are obviously placeholders ("[Manager completes]"), never
 * plausible employee content: a preview that reads like a real record is one
 * screenshot away from being filed as one.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ key: string }> }) {
  try {
    await authorizeForms(request, "manage_form_templates");
    const { key } = await context.params;
    const template = await getTemplateByKey(key);
    if (!template) {
      return new Response(JSON.stringify({ error: "No such template." }), {
        status: 404,
        headers: { "content-type": "application/json" },
      });
    }

    const versions = await listVersions(template.id);
    const draft = versions.find((version) => version.status === "draft");
    const version = draft ?? (await getCurrentVersion(template.id));
    if (!version) {
      return new Response(JSON.stringify({ error: "Nothing to preview yet." }), {
        status: 409,
        headers: { "content-type": "application/json" },
      });
    }

    const { searchParams } = new URL(request.url);
    const variantKey = searchParams.get("variant");
    const variant =
      version.variants.find((entry) => entry.key === variantKey) ?? version.variants[0] ?? null;

    const values: Record<string, string> = {};
    for (const field of fieldsForVariant(version.document, variant?.key ?? null)) {
      values[field.key] =
        field.responsibility === "ai"
          ? "[Ask Sunny drafts this]"
          : field.responsibility === "manual"
            ? ""
            : field.responsibility === "system"
              ? "[from the record]"
              : "[Manager completes]";
    }

    const bytes = renderFormPdf(version.document, variant, { values, checked: {} }, {
      templateName: `${template.name} — preview`,
      templateVersion: version.version,
      employeeName: "[Employee]",
      formDate: new Date().toISOString().slice(0, 10),
      reference: version.status === "draft" ? "DRAFT PREVIEW" : "PREVIEW",
      status: "draft",
    });

    return new Response(bytes as BodyInit, {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `inline; filename="${key}-preview.pdf"`,
        "cache-control": "no-store, private",
      },
    });
  } catch (error) {
    return errorResponse(error, "forms/template/preview");
  }
}
