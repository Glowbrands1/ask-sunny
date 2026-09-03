import { NextResponse } from "next/server";

import { assertWithinRateLimit, errorResponse } from "@/lib/api/respond";
import { authorizeForms } from "@/lib/forms/access";
import { ensureTemplateLibrary, listTemplateSummaries } from "@/lib/forms/repository";

/**
 * GET  /api/forms/templates   the library, with each template's current
 *                             version, open draft and active PDF
 * POST /api/forms/templates   installs the nine templates if they are missing
 *
 * Both need `manage_form_templates`. Seeding is idempotent by key and never
 * overwrites an existing template — a published version an administrator
 * edited is not something the code's idea of the form may replace.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    await authorizeForms(request, "manage_form_templates");
    const templates = await listTemplateSummaries();
    return NextResponse.json({ templates });
  } catch (error) {
    return errorResponse(error, "forms/templates");
  }
}

export async function POST(request: Request) {
  try {
    const actor = await authorizeForms(request, "manage_form_templates");
    assertWithinRateLimit(request, "upload");
    const result = await ensureTemplateLibrary(actor.id);
    return NextResponse.json(result);
  } catch (error) {
    return errorResponse(error, "forms/templates/seed");
  }
}
