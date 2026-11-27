import { createElement } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { requirePagePermission } from "@/lib/auth/page";
import { HrApprovalScreen } from "@/features/forms/hr-approval-screen";
import { HR_PENDING_TAB_HREF } from "@/lib/forms/hr-approval-bells";
import { awaitingHr, hrApprovalEnabled, mayReadHrDecision } from "@/lib/forms/hr-approval-rules";
import { actorMaySeeInstance, opensAsAdmin } from "@/lib/forms/instance-scope";
import { loadInstance } from "@/lib/forms/instances";
import { pageFormsAccess } from "@/lib/forms/page-scope";

export const metadata: Metadata = { title: "HR approval" };
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A FORM THAT WENT TO HR, FOR ITS CREATOR, HR AND ADMINISTRATORS (owner, 27 Nov
 * 2026: "yes admin"). Every other reader — their District or Regional Manager,
 * another manager — gets the same 404 a
 * missing form gets, so the page never confirms that the form exists. Off with
 * FORMS_HR_APPROVAL_ENABLED. Every write the card makes is authorized again by
 * its own route.
 */
export default async function HrApprovalFormPage({ params }: { params: Promise<{ id: string }> }) {
  const identity = await requirePagePermission("view_form_monitoring");
  if (!hrApprovalEnabled()) notFound();

  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const access = await pageFormsAccess(identity);
  const loaded = await loadInstance(id);
  if (!loaded || !actorMaySeeInstance(access.actor, loaded.instance)) notFound();
  // Administrators open it too (owner, 27 Nov 2026: "yes admin"); the card shows them the form, not HR's notes.
  if (!mayReadHrDecision(access.actor, loaded.instance) && !(opensAsAdmin(access.actor) && awaitingHr(loaded.instance.hrApprovalState))) notFound();

  const hr = access.actor.hrApprover === true;
  return createElement(HrApprovalScreen, {
    instanceId: id,
    templateName: loaded.instance.templateName,
    backHref: hr ? HR_PENDING_TAB_HREF : "/forms/monitoring",
    backLabel: hr ? "Back to Pending HR approval" : "Back to Form Monitoring",
  });
}
