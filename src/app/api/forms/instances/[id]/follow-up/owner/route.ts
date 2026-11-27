import { NextResponse } from "next/server";

import { errorResponse } from "@/lib/api/respond";
import { accountNames, assignFollowUpOwner, followUpOwnerChoices, FollowUpOwnerError } from "@/lib/forms/follow-up-owner";
import { redactHrApproval } from "@/lib/forms/hr-approval-rules";
import { authorizeInstance, InstanceNotVisibleError } from "@/lib/forms/instance-scope";

/**
 * WHO OWNS ONE FORM'S FOLLOW-UP (the owner, 27 Nov 2026: hand a form's follow-up to someone else, e.g. the DM).
 *
 *   GET   { owner: { id, name } | null, creator: { id, name }, choices: [{ id, name }] }
 *   PUT   { ownerId: "<account id>" | null }   null gives it back to the creator
 *
 * Authorized as the follow-up's own route is: an `edit` on THIS form (`authorizeInstance`: the template's permission and
 * the form's salon against the caller's scope; refused as a 404). The person named must be one of `followUpOwnerChoices`
 * — someone who may open this form and edit it themselves — or the write is refused (`assignFollowUpOwner`). Form
 * Monitoring, the form itself and the AI all write through `assignFollowUpOwner`.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const { loaded } = await authorizeInstance(request, id, "edit");
    const form = loaded.instance;
    const [choices, names] = await Promise.all([followUpOwnerChoices(form), accountNames([form.createdBy, form.followUpOwner])]);
    const nameOf = (account: string) => choices.find((choice) => choice.id === account)?.name ?? names.get(account) ?? "A manager";
    return NextResponse.json({
      owner: form.followUpOwner ? { id: form.followUpOwner, name: nameOf(form.followUpOwner) } : null,
      creator: { id: form.createdBy, name: nameOf(form.createdBy) },
      choices: choices.filter((choice) => choice.id !== form.createdBy).map(({ id: account, name }) => ({ id: account, name })),
    });
  } catch (error) {
    if (error instanceof InstanceNotVisibleError) return NextResponse.json({ error: error.message }, { status: 404 });
    if (error instanceof FollowUpOwnerError) return NextResponse.json({ error: error.message }, { status: 503 });
    return errorResponse(error, "forms/instance/follow-up/owner");
  }
}

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const { actor, loaded } = await authorizeInstance(request, id, "edit");
    const body = (await request.json().catch(() => null)) as { ownerId?: unknown } | null;
    if (!body || !("ownerId" in body) || (body.ownerId !== null && (typeof body.ownerId !== "string" || body.ownerId.length === 0 || body.ownerId.length > 200))) {
      return NextResponse.json({ error: "Say who owns the follow-up (ownerId), or null for the form's creator." }, { status: 400 });
    }
    const { instance, owner } = await assignFollowUpOwner(loaded.instance, body.ownerId as string | null, actor.id);
    return NextResponse.json({ instance: redactHrApproval(actor, instance), owner: owner ? { id: owner.id, name: owner.name } : null });
  } catch (error) {
    if (error instanceof InstanceNotVisibleError) return NextResponse.json({ error: error.message }, { status: 404 });
    if (error instanceof FollowUpOwnerError) {
      return NextResponse.json({ error: error.message }, { status: error.code === "not_allowed" ? 403 : 503 });
    }
    return errorResponse(error, "forms/instance/follow-up/owner/put");
  }
}
