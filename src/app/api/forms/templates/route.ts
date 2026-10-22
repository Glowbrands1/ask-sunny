import { NextResponse } from "next/server";

import { assertWithinRateLimit, errorResponse } from "@/lib/api/respond";
import { authorizeForms } from "@/lib/forms/access";
import { ensureTemplateLibrary, listTemplateSummaries } from "@/lib/forms/repository";

/**
 * GET  /api/forms/templates   the library, with each template's current
 *                             version, open draft and active PDF
 * POST /api/forms/templates   installs the library's templates if they are missing
 *                             and publishes newer seed revisions
 *
 * Both need `manage_form_templates`. Seeding is idempotent by key and never
 * overwrites an existing template — a published version an administrator
 * edited is not something the code's idea of the form may replace. POST is
 * refused (409) on a Vercel Preview, which shares Production's database.
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
    /*
     * REFUSED ON A PREVIEW, AND SAID SO. A 200 with empty lists would read as
     * "already up to date" — the opposite of what happened. See
     * `template-sync-policy.ts`: Preview shares Production's database.
     */
    if (result.skipped) {
      return NextResponse.json(
        { error: result.skipped.reason, code: "template_sync_disabled", environment: result.skipped.environment },
        { status: 409 },
      );
    }
    /*
     * A PARTIAL FAILURE IS NOT A 200. Each template is attempted on its own, so
     * some may have been published while others failed; 207 says both things
     * and the body lists them (`revised`, `heldBack`, `failed` with a redacted
     * reason). The same lines are in the server log.
     */
    return NextResponse.json(result, { status: result.failed.length > 0 ? 207 : 200 });
  } catch (error) {
    return errorResponse(error, "forms/templates/seed");
  }
}
