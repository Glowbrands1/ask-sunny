import { NextResponse } from "next/server";

import { errorResponse } from "@/lib/api/respond";
import { authorizeForms } from "@/lib/forms/access";
import {
  finalizeInstance,
  loadInstance,
  reviseInstance,
  saveInstanceValues,
} from "@/lib/forms/instances";

/**
 * One form.
 *
 *   GET    the form, its template version, its values and its history
 *   PATCH  save what a person typed — hand-filled lines and signatures refused
 *   POST   finalize, or open a revision / re-evaluation
 *
 * Finalizing freezes the values; the database refuses later edits, and the way
 * to correct a finalized form is a revision that points back at it. That is
 * also how the DMIT EPP's re-evaluation stage works, which is why it is the
 * same call with a different kind rather than a separate feature.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await authorizeForms(request, "view_form_monitoring");
    const { id } = await context.params;
    const loaded = await loadInstance(id);
    if (!loaded) return NextResponse.json({ error: "No such form." }, { status: 404 });
    return NextResponse.json(loaded);
  } catch (error) {
    return errorResponse(error, "forms/instance");
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await authorizeForms(request, "create_coaching_form");
    const { id } = await context.params;
    const body = (await request.json().catch(() => null)) as {
      values?: Record<string, string>;
      checked?: Record<string, string[]>;
    } | null;

    const result = await saveInstanceValues(
      id,
      { values: body?.values ?? {}, checked: body?.checked ?? {} },
      actor.id,
    );
    const loaded = await loadInstance(id);
    return NextResponse.json({ ...loaded, rejected: result.rejected });
  } catch (error) {
    return errorResponse(error, "forms/instance/save");
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await authorizeForms(request, "create_coaching_form");
    const { id } = await context.params;
    const body = (await request.json().catch(() => null)) as {
      action?: "finalize" | "revise" | "reevaluate";
      followUpDate?: string | null;
    } | null;

    if (body?.action === "finalize") {
      const instance = await finalizeInstance(id, actor.id, body.followUpDate ?? null);
      return NextResponse.json({ instance });
    }
    if (body?.action === "revise" || body?.action === "reevaluate") {
      const instance = await reviseInstance(
        id,
        actor.id,
        body.action === "reevaluate" ? "reevaluated" : "revised",
      );
      return NextResponse.json({ instance });
    }

    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  } catch (error) {
    return errorResponse(error, "forms/instance/action");
  }
}
