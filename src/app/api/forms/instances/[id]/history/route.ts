import { NextResponse } from "next/server";

import { errorResponse } from "@/lib/api/respond";
import { formRevisionsEnabled } from "@/lib/config/chat-quality-flags";
import { authorizeInstance, InstanceNotVisibleError } from "@/lib/forms/instance-scope";
import { loadRevisionHistory, marksFor } from "@/lib/forms/revision-chain";
import { revisionLabel } from "@/lib/forms/revision-history";

/**
 * GET /api/forms/instances/[id]/history
 *
 * A form's revision chain: every version, original first, each with its
 * number, its reason and its dates, plus the marks this record carries
 * ("Revised … (supersedes …)", "Superseded … by …"). Behind
 * `FORM_REVISIONS_ENABLED`; with it off the route answers as if it did not
 * exist.
 *
 * Every record in the chain is authorized as a read of its own. One the
 * caller may not open is left out of the list, never named.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!formRevisionsEnabled()) return NextResponse.json({ error: "Not found." }, { status: 404 });
  try {
    const { id } = await context.params;
    await authorizeInstance(request, id, "view");
    const history = await loadRevisionHistory(id, async (loaded) => {
      try {
        await authorizeInstance(request, loaded.instance.id, "view");
        return true;
      } catch (error) {
        if (error instanceof InstanceNotVisibleError) return false;
        throw error;
      }
    });
    if (!history) return NextResponse.json({ error: "No such form." }, { status: 404 });
    return NextResponse.json({ history, marks: marksFor(history), label: revisionLabel(history) });
  } catch (error) {
    if (error instanceof InstanceNotVisibleError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    return errorResponse(error, "forms/instance/history");
  }
}
