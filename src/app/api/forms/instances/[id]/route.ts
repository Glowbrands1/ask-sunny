import { NextResponse } from "next/server";

import { cardChangePlanRebuildEnabled } from "@/lib/config/chat-quality-flags";
import { syncCorrectiveActionPlan } from "@/lib/forms/ca-action-plan-sync";
import { PAYROLL_AMOUNT_KEY } from "@/lib/forms/payroll-amount-field";
import { errorResponse } from "@/lib/api/respond";
import { POLICY_ACKNOWLEDGEMENT_REQUIRED } from "@/lib/forms/policy-verification";
import {
  authorizeInstance,
  InstanceNotVisibleError,
} from "@/lib/forms/instance-scope";
import {
  archiveInstance,
  deleteInstance,
  finalizeInstance,
  UnverifiedPolicyError,
  InstanceProtectedError,
  loadInstance,
  saveInstanceValues,
} from "@/lib/forms/instances";
import { reviseFinalizedForm, RevisionReasonRequiredError } from "@/lib/forms/revision-chain";

/**
 * One form.
 *
 *   GET    the form, its template version, its values and its history
 *   PATCH  save what a person typed — hand-filled lines and signatures refused
 *   POST   finalize, or open a revision / re-evaluation
 *   PUT    archive or restore — hides a form from the active list, changing
 *          nothing about what it says
 *   DELETE remove a DRAFT outright, values and events with it. Refused on a
 *          finalized form: a signed HR document is archived, never destroyed.
 *
 * Finalizing freezes the values; the database refuses later edits, and the way
 * to correct a finalized form is a revision that points back at it. That is
 * also how the DMIT EPP's re-evaluation stage works, which is why it is the
 * same call with a different kind rather than a separate feature.
 *
 * ============================================================================
 * EVERY VERB GOES THROUGH `authorizeInstance`
 * ============================================================================
 *
 * It does two things no route here used to do: it authorizes on the TEMPLATE'S
 * OWN permission rather than a hard-coded `create_coaching_form` — so a role
 * that may write a coaching form cannot save, draft or finalize a DPOA — and it
 * checks the form's salon against the caller's `AccessScope`.
 *
 * An unauthorized form answers exactly as a missing one does. A 403 here would
 * confirm that a guessed UUID names a real record at somebody else's salon.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const { loaded } = await authorizeInstance(request, id, "view");
    // CARD_CHANGE_PLAN_REBUILD_ENABLED: the Change something panel offers the Payroll deduction amount.
    return NextResponse.json(cardChangePlanRebuildEnabled() ? { ...loaded, cardChangeAmount: true } : loaded);
  } catch (error) {
    if (error instanceof InstanceNotVisibleError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    return errorResponse(error, "forms/instance");
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const { actor } = await authorizeInstance(request, id, "edit");
    const body = (await request.json().catch(() => null)) as {
      values?: Record<string, string>;
      checked?: Record<string, string[]>;
      /** "card-change": the finalized form's Change something panel (`finalized-change-panel.tsx`). */
      source?: unknown;
    } | null;

    const result = await saveInstanceValues(
      id,
      { values: body?.values ?? {}, checked: body?.checked ?? {} },
      actor.id,
    );
    /*
     * CARD_CHANGE_PLAN_REBUILD_ENABLED (Pau, 28 Oct 2026): payroll deduct
     * changed from the Change something panel rebuilds the Corrective Action
     * Form's Action Plan on this draft, the way a payroll answer in chat does
     * (`syncCorrectiveActionPlan`; only a plan the app built is touched). The
     * draft only: a finalized form is never written here.
     */
    /*
     * The panel's Payroll deduction amount (same flag): the rebuilt plan says
     * "<first name> will be payroll deducted <amount>.", and an amount changed
     * on its own rebuilds it too.
     */
    const saved = (key: string) => !result.rejected.some((item) => item.key === key);
    const planRebuilt =
      cardChangePlanRebuildEnabled() &&
      body?.source === "card-change" &&
      ((Array.isArray(body.checked?.payroll_deduct) && saved("payroll_deduct")) ||
        (typeof body.values?.[PAYROLL_AMOUNT_KEY] === "string" && saved(PAYROLL_AMOUNT_KEY)))
        ? (await syncCorrectiveActionPlan(id, actor.id, { amountSentence: true })).length > 0
        : false;
    const loaded = await loadInstance(id);
    return NextResponse.json({ ...loaded, rejected: result.rejected, ...(planRebuilt ? { actionPlanRebuilt: true } : {}) });
  } catch (error) {
    if (error instanceof InstanceNotVisibleError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    return errorResponse(error, "forms/instance/save");
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const { actor } = await authorizeInstance(request, id, "edit");
    const body = (await request.json().catch(() => null)) as {
      action?: "finalize" | "revise" | "reevaluate";
      followUpDate?: string | null;
      /**
       * The manager was shown the unverified-policy warning and chose to
       * continue. Only ever true because a person clicked it — the browser
       * cannot obtain it any other way, and the server never defaults it.
       */
      acknowledgeUnverifiedPolicy?: boolean;
      /**
       * Why a finalized form is being edited. Required with
       * `FORM_REVISIONS_ENABLED` on, recorded on the revision's `created`
       * event; ignored with it off. See `reviseFinalizedForm`.
       */
      reason?: string;
    } | null;

    if (body?.action === "finalize") {
      const instance = await finalizeInstance(id, actor.id, body.followUpDate ?? null, {
        acknowledgeUnverifiedPolicy: body.acknowledgeUnverifiedPolicy === true,
      });
      return NextResponse.json({ instance });
    }
    if (body?.action === "revise" || body?.action === "reevaluate") {
      const instance = await reviseFinalizedForm(
        id,
        actor.id,
        body.action === "reevaluate" ? "reevaluated" : "revised",
        body.reason,
      );
      return NextResponse.json({ instance });
    }

    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  } catch (error) {
    if (error instanceof InstanceNotVisibleError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    /*
     * 409, AND THE FIELDS, so the browser can open the acknowledgement dialog
     * rather than showing a dead end. `code` is what the client keys off — the
     * message is for a person, and a client that matched on prose would break
     * the first time the wording improved.
     */
    /*
     * 400 WITH A CODE: the edit needs a reason (`FORM_REVISIONS_ENABLED`).
     * The message tells the manager why, and that the new printout is signed
     * again; the code is what the reason dialog keys off.
     */
    if (error instanceof RevisionReasonRequiredError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 400 });
    }
    if (error instanceof UnverifiedPolicyError) {
      return NextResponse.json(
        {
          error: error.message,
          code: POLICY_ACKNOWLEDGEMENT_REQUIRED,
          fields: error.fields,
        },
        { status: 409 },
      );
    }
    return errorResponse(error, "forms/instance/action");
  }
}

/**
 * Archive, or put back.
 *
 * Separate from DELETE because it is a different act with a different rule:
 * archiving is reversible, applies to any status, and touches only where the
 * form is SHOWN. It never alters `status`, `finalized_at`, or a single value —
 * so finalized immutability is untouched by it.
 */
export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const { actor } = await authorizeInstance(request, id, "manage");
    const body = (await request.json().catch(() => null)) as { archived?: boolean } | null;

    const instance = await archiveInstance(id, actor.id, body?.archived !== false);
    return NextResponse.json({ instance });
  } catch (error) {
    if (error instanceof InstanceNotVisibleError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    return errorResponse(error, "forms/instance/archive");
  }
}

/**
 * Delete one form.
 *
 * AUTHORIZED SERVER-SIDE, on `manage_form_records` — a permission of its own
 * rather than a side effect of being able to read the monitoring list, because
 * deleting somebody's draft destroys their work. In live mode
 * `authorizeRequest` resolves a real identity in live mode,
 * so this is reachable in preview only.
 *
 * The status rule lives in `deleteInstance`, not here: a route is the wrong
 * place for it, since the same rule has to hold for any future caller.
 */
export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    await authorizeInstance(request, id, "manage");
    const deleted = await deleteInstance(id);
    return NextResponse.json({
      deleted: { id: deleted.id, employeeName: deleted.employeeName },
    });
  } catch (error) {
    // A refusal is the expected answer for a finalized form, not a fault, so it
    // gets 409 and its own sentence rather than a generic 500.
    if (error instanceof InstanceNotVisibleError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    if (error instanceof InstanceProtectedError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    return errorResponse(error, "forms/instance/delete");
  }
}
