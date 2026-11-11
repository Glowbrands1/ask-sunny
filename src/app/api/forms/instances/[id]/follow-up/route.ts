import { NextResponse } from "next/server";
import { isDemoMode } from "@/lib/config/runtime";
import { authorizeForms } from "@/lib/forms/access";
import {
  demoMarkFollowedUp,
  demoReopenFollowUp,
  demoSetFollowUpDate,
  isDemoFormId,
} from "@/lib/demo/forms-fixtures";

import { errorResponse } from "@/lib/api/respond";
import { authorizeInstance, InstanceNotVisibleError } from "@/lib/forms/instance-scope";
import {
  FollowUpError,
  markFollowedUp,
  reopenFollowUp,
  setFollowUpDate,
} from "@/lib/forms/instances";

/**
 * ONE FORM'S FOLLOW-UP.
 *
 *   PUT   set or move the date   { date: "2026-09-10" }
 *   POST  { action: "complete" | "reopen" }
 *
 * A ROUTE OF ITS OWN rather than more branches on the instance route, because
 * this is a different kind of write with a different rule: it touches
 * operational metadata and never the document. `PATCH /instances/[id]` saves
 * what somebody typed into the form and goes through the responsibility guards;
 * nothing here can reach `form_instance_values` at all.
 *
 * AUTHORIZED SERVER-SIDE as an `edit` on THIS FORM'S TEMPLATE. Deliberately not
 * `manage_form_records`: that one gates destroying and hiding records, and a
 * Salon Director who may document a coaching conversation must be able to say
 * the conversation happened without also being able to delete filed forms.
 *
 * NOT `create_coaching_form` EITHER, which is what it asked for on every
 * template — a role that may document a coaching conversation could set the
 * follow-up on an EPP it holds no permission for, at a salon it does not cover.
 * `authorizeInstance` resolves the template's own permission and checks the
 * form's salon against the caller's `AccessScope`.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    /* DEMO: a seeded form, changed in memory. See `lib/demo/forms-fixtures.ts`. */
    if (isDemoMode() && isDemoFormId(id)) {
      await authorizeForms(request, "view_form_monitoring");
      const body = (await request.json().catch(() => null)) as { date?: string } | null;
      if (!body?.date || !/^\d{4}-\d{2}-\d{2}$/.test(body.date)) {
        return NextResponse.json({ error: "A follow-up date is required." }, { status: 400 });
      }
      return NextResponse.json({ instance: demoSetFollowUpDate(id, body.date), demo: true });
    }
    const { actor } = await authorizeInstance(request, id, "edit");
    const body = (await request.json().catch(() => null)) as { date?: string } | null;

    if (!body?.date) {
      return NextResponse.json({ error: "A follow-up date is required." }, { status: 400 });
    }

    const instance = await setFollowUpDate(id, body.date, actor.id);
    return NextResponse.json({ instance });
  } catch (error) {
    // A refusal here is an answer, not a fault: the form is archived, already
    // complete, or the date was not a date.
    if (error instanceof InstanceNotVisibleError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    if (error instanceof FollowUpError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    return errorResponse(error, "forms/instance/follow-up");
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    if (isDemoMode() && isDemoFormId(id)) {
      const demoActor = await authorizeForms(request, "view_form_monitoring");
      const body = (await request.json().catch(() => null)) as { action?: string } | null;
      if (body?.action === "complete") {
        const name = demoActor.id.split(":").slice(2).join(":") || "Demo user";
        return NextResponse.json({ instance: demoMarkFollowedUp(id, name), demo: true });
      }
      if (body?.action === "reopen") {
        return NextResponse.json({ instance: demoReopenFollowUp(id), demo: true });
      }
      return NextResponse.json({ error: "Unknown follow-up action." }, { status: 400 });
    }
    const { actor } = await authorizeInstance(request, id, "edit");
    const body = (await request.json().catch(() => null)) as {
      action?: "complete" | "reopen";
    } | null;

    if (body?.action === "complete") {
      return NextResponse.json({ instance: await markFollowedUp(id, actor.id) });
    }
    if (body?.action === "reopen") {
      return NextResponse.json({ instance: await reopenFollowUp(id, actor.id) });
    }

    return NextResponse.json({ error: "Unknown follow-up action." }, { status: 400 });
  } catch (error) {
    if (error instanceof InstanceNotVisibleError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    if (error instanceof FollowUpError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    return errorResponse(error, "forms/instance/follow-up/action");
  }
}
