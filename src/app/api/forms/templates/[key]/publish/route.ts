import { NextResponse } from "next/server";

import { errorResponse } from "@/lib/api/respond";
import { authorizeForms } from "@/lib/forms/access";
import { getTemplateByKey, publishDraft } from "@/lib/forms/repository";

/**
 * POST /api/forms/templates/[key]/publish
 *
 * Publishes the open draft and points the template at it. The version that was
 * current is archived rather than deleted: forms filled from it still reference
 * it, and re-rendering one has to find the document it was signed against.
 *
 * From this moment the published version is immutable — enforced by a database
 * trigger, not by this route.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ key: string }> }) {
  try {
    const actor = await authorizeForms(request, "manage_form_templates");
    const { key } = await context.params;

    const template = await getTemplateByKey(key);
    if (!template) {
      return NextResponse.json({ error: "No such form template." }, { status: 404 });
    }

    const body = (await request.json().catch(() => null)) as { versionId?: string } | null;
    if (!body?.versionId) {
      return NextResponse.json({ error: "Which draft?" }, { status: 400 });
    }

    const published = await publishDraft(body.versionId, actor.id);
    return NextResponse.json({ published });
  } catch (error) {
    return errorResponse(error, "forms/template/publish");
  }
}
