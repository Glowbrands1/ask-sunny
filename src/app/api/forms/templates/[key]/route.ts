import { NextResponse } from "next/server";

import { errorResponse } from "@/lib/api/respond";
import { authorizeForms } from "@/lib/forms/access";
import {
  getTemplateByKey,
  getCurrentVersion,
  listAssets,
  listVersions,
} from "@/lib/forms/repository";

/**
 * GET /api/forms/templates/[key]
 *
 * One template with everything the editor needs: its version history, which
 * version is current, and every PDF asset ever attached — superseded and
 * rejected ones included, because the history is the point.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ key: string }> },
) {
  try {
    await authorizeForms(request, "manage_form_templates");
    const { key } = await context.params;

    const template = await getTemplateByKey(key);
    if (!template) {
      return NextResponse.json({ error: "No such form template." }, { status: 404 });
    }

    const [versions, current, assets] = await Promise.all([
      listVersions(template.id),
      getCurrentVersion(template.id),
      listAssets(template.id),
    ]);

    return NextResponse.json({ template, versions, current, assets });
  } catch (error) {
    return errorResponse(error, "forms/template");
  }
}
