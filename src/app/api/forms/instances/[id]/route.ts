import { NextResponse } from "next/server";

import { cardChangePlanRebuildEnabled } from "@/lib/config/chat-quality-flags";
import { syncCorrectiveActionPlan } from "@/lib/forms/ca-action-plan-sync";
import { PAYROLL_AMOUNT_KEY } from "@/lib/forms/payroll-amount-field";
import { errorResponse } from "@/lib/api/respond";
import { REQUIRED_FIELDS_BLANK } from "@/lib/forms/required-fields";
import { POLICY_ACKNOWLEDGEMENT_REQUIRED } from "@/lib/forms/policy-verification";
import {
  actorMaySeeInstance,
  authorizeInstance,
  InstanceNotVisibleError,
} from "@/lib/forms/instance-scope";
import {
  deleteInstance,
  finalizeInstance,
  RequiredFieldsBlankError,
  UnverifiedPolicyError,
  InstanceProtectedError,
  loadInstance,
  saveInstanceValues,
} from "@/lib/forms/instances";
import { reviseFinalizedForm, RevisionReasonRequiredError } from "@/lib/forms/revision-chain";
import {
  commentOnHrApproval,
  decideHrApproval,
  finalizeGoesToHr,
  HrApprovalError,
  hrApprovalViewFor,
  mayEditWhileWithHr,
  recordHrEdit,
  sendForHrApproval,
  withdrawnFromHr,
} from "@/lib/forms/hr-approval";
import {
  awaitingHr,
  FormNotEditableNowError,
  hiddenWhileAwaitingHr,
  isCreatorOrSender,
  isHeldForHr,
  redactHrApproval,
  redactLoadedHrApproval,
} from "@/lib/forms/hr-approval-rules";

/**
 * One form.
 *
 *   GET    the form, its template version, its values and its history
 *   PATCH  save what a person typed — hand-filled lines and signatures refused
 *   POST   finalize, or open a revision / re-evaluation
 *   DELETE remove a DRAFT outright, values and events with it. A finalized form
 *          is a signed HR document and is kept on file: refused (409) for everyone
 *          but the accounts on FINALIZED_FORM_DELETE_EMAILS (Pau, 26 Nov 2026).
 *          The deletion record (who, when, a snapshot) is written either way.
 *
 * There is no archive verb (Pau, 23 Nov 2026): a form is Draft or Finalized.
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
    const { actor, loaded } = await authorizeInstance(request, id, "view");
    /*
     * HR APPROVAL: the approval panel — state, waiting time, HR's notes — for the form's creator and HR only; null for
     * every other reader. `finalizeToHr` tells the card to label its button "Finalize and send for approval".
     */
    const hrApproval = await hrApprovalViewFor(actor, loaded.instance);
    const finalizeToHr = await finalizeGoesToHr(actor, loaded.instance).catch(() => false);
    // The approval columns only for those who may read HR's decision (`redactHrApproval`).
    const withHr = {
      ...redactLoadedHrApproval(actor, loaded),
      ...(hrApproval ? { hrApproval } : {}),
      ...(finalizeToHr ? { finalizeToHr: true } : {}),
    };
    // CARD_CHANGE_PLAN_REBUILD_ENABLED: the Change something panel offers the Payroll deduction amount.
    return NextResponse.json(cardChangePlanRebuildEnabled() ? { ...withHr, cardChangeAmount: true } : withHr);
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
    const { actor, loaded: before } = await authorizeInstance(request, id, "edit");
    const body = (await request.json().catch(() => null)) as {
      values?: Record<string, string>;
      checked?: Record<string, string[]>;
      /** "card-change": the finalized form's Change something panel (`finalized-change-panel.tsx`). */
      source?: unknown;
      /** The values as the card loaded them: only what the person changed from these is written (`touchedSinceLoad`). */
      base?: { values?: Record<string, string>; checked?: Record<string, string[]> };
    } | null;

    /*
     * HR APPROVAL: HR may edit a form waiting for them (owner, 23 Nov 2026), and so may its creator and anyone who sent
     * it (owner, 24 Nov 2026: "have the option to edit the form but also make sure the edited form carries over to [HR]
     * so she sees the updated version"). The change is written through the one path the database lets past the hold,
     * to the same form HR reviews, and is recorded in the approval history; a manager's change rings HR's bell.
     * Anybody else's save of a waiting form is refused (`HeldForHrError`).
     */
    const pastHrHold = mayEditWhileWithHr(actor, before.instance);
    // HR's edit of a form with them in ANY state (sent back, rejected too) goes in the approval history only.
    const hrHistoryOnly =
      actor.hrApprover === true && awaitingHr(before.instance.hrApprovalState) && !isCreatorOrSender(actor, before.instance);
    const result = await saveInstanceValues(
      id,
      { values: body?.values ?? {}, checked: body?.checked ?? {} },
      actor.id,
      { pastHrHold, hrHistoryOnly, ...(sentBase(body?.base) ? { base: sentBase(body?.base)! } : {}) },
    );
    if (pastHrHold || hrHistoryOnly) await recordHrEdit(id, actor);
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
    return NextResponse.json({
      ...(loaded ? redactLoadedHrApproval(actor, loaded) : loaded),
      rejected: result.rejected,
      ...(planRebuilt ? { actionPlanRebuilt: true } : {}),
    });
  } catch (error) {
    if (error instanceof InstanceNotVisibleError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    if (isHeldForHr(error)) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 409 });
    }
    return errorResponse(error, "forms/instance/save");
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const { actor, loaded } = await authorizeInstance(request, id, "edit");
    const body = (await request.json().catch(() => null)) as {
      action?: "finalize" | "revise" | "reevaluate" | "hr_approve" | "hr_reject" | "hr_send_back" | "hr_comment";
      /** HR's note: required to reject or send back; the text of a comment. */
      note?: string;
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
      /*
       * HR APPROVAL (FORMS_HR_APPROVAL_ENABLED): every form but the two coaching forms is sent to HR instead of being
       * finalized — the same checks first, so a blank required field or an unacknowledged policy is still refused
       * while the manager can fix it. HR's own forms finalize as before.
       */
      if (await finalizeGoesToHr(actor, loaded.instance)) {
        const instance = await sendForHrApproval(
          id,
          actor,
          body.followUpDate ?? null,
          { acknowledgeUnverifiedPolicy: body.acknowledgeUnverifiedPolicy === true },
          // The optional "Note to HR" typed beside the button.
          body.note,
        );
        return NextResponse.json({ instance: redactHrApproval(actor, instance), sentToHr: true });
      }
      const instance = await finalizeInstance(id, actor.id, body.followUpDate ?? null, {
        acknowledgeUnverifiedPolicy: body.acknowledgeUnverifiedPolicy === true,
      });
      return NextResponse.json({ instance: redactHrApproval(actor, instance) });
    }
    if (body?.action === "hr_approve" || body?.action === "hr_reject" || body?.action === "hr_send_back") {
      const decision = body.action === "hr_approve" ? "approve" : body.action === "hr_reject" ? "reject" : "send_back";
      const instance = await decideHrApproval(id, actor, decision, body.note);
      return NextResponse.json({ instance: redactHrApproval(actor, instance), hrApproval: await hrApprovalViewFor(actor, instance) });
    }
    if (body?.action === "hr_comment") {
      await commentOnHrApproval(id, actor, body.note);
      return NextResponse.json({ hrApproval: await hrApprovalViewFor(actor, loaded.instance) });
    }
    if (body?.action === "revise" || body?.action === "reevaluate") {
      const instance = await reviseFinalizedForm(
        id,
        actor.id,
        body.action === "reevaluate" ? "reevaluated" : "revised",
        body.reason,
      );
      /*
       * AN OPEN REVISION THIS READER MAY NOT SEE (owner, 23 Nov 2026: no leaks). "Edit as new draft" returns the
       * revision already open, which may be someone else's waiting for HR. It is not handed back, nor is why. An
       * administrator may open such a form by its link (owner, 27 Nov 2026: "yes admin"), but is not steered into it here.
       */
      if (instance.id !== id && (!actorMaySeeInstance(actor, instance) || hiddenWhileAwaitingHr(actor, instance))) throw new FormNotEditableNowError();
      return NextResponse.json({ instance: redactHrApproval(actor, instance) });
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
    if (error instanceof HrApprovalError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (isHeldForHr(error)) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 409 });
    }
    if (error instanceof FormNotEditableNowError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 409 });
    }
    if (error instanceof RevisionReasonRequiredError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 400 });
    }
    if (error instanceof RequiredFieldsBlankError) {
      // `missing` names each blank field so the form can open its pop-up and highlight them (Pau, 25 Nov 2026).
      return NextResponse.json(
        { error: error.message, code: REQUIRED_FIELDS_BLANK, fields: error.fields.map((field) => field.key), missing: error.fields },
        { status: 422 },
      );
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
    const { actor } = await authorizeInstance(request, id, "manage");
    /*
     * ONLY THE NAMED ACCOUNT MAY DELETE A FINALIZED FORM (Pau, 26 Nov 2026: "pls allow delete for finalized form in my
     * account only"; port from the sibling app. Until then every administrator could, 24 Nov). The list is
     * FINALIZED_FORM_DELETE_EMAILS, matched on the verified email (`finalized-delete.ts`). Everybody else with
     * `manage_form_records` deletes drafts only.
     */
    const allowFinalized = actor.mayDeleteFinalized === true;
    const deleted = await deleteInstance(id, { id: actor.id, role: actor.role, via: "route" }, { allowFinalized });
    // HR APPROVAL: a deleted waiting form leaves HR's bell.
    await withdrawnFromHr(deleted);
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

/** The card's `base`, when it is the shape the card sends: string values and string-array ticks. Anything else is ignored. */
function sentBase(base: unknown): { values: Record<string, string>; checked: Record<string, string[]> } | null {
  if (!base || typeof base !== "object") return null;
  const { values, checked } = base as { values?: unknown; checked?: unknown };
  const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
  if (!isRecord(values) || !isRecord(checked)) return null;
  if (!Object.values(values).every((value) => typeof value === "string")) return null;
  if (!Object.values(checked).every((ticks) => Array.isArray(ticks) && ticks.every((tick) => typeof tick === "string"))) return null;
  return { values: values as Record<string, string>, checked: checked as Record<string, string[]> };
}
