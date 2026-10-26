import { createElement } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { pageCan, requirePagePermission } from "@/lib/auth/page";
import { formRevisionsEnabled } from "@/lib/config/chat-quality-flags";
import { actorMaySeeInstance, withoutUnreadable } from "@/lib/forms/instance-scope";
import { loadInstance } from "@/lib/forms/instances";
import { pageFormsAccess } from "@/lib/forms/page-scope";
import { FormRecordScreen } from "@/form-revisions/form-record-screen";

export const metadata: Metadata = { title: "Form" };
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * ONE FORM, OUTSIDE CHAT (`FORM_REVISIONS_ENABLED`).
 *
 * A route module only: the screen is `src/form-revisions/form-record-screen.tsx`,
 * shared by both apps. With the flag off the route does not exist (404).
 *
 * The same reads as the forms list: the page permission first, then the
 * caller's forms scope (`actorMaySeeInstance`) and the exit-form rule
 * (`withoutUnreadable`). A form the caller may not see answers as a missing
 * one. Every write the card makes is authorized again by its own route.
 */
export default async function FormRecordPage({ params }: { params: Promise<{ id: string }> }) {
  const identity = await requirePagePermission("view_form_monitoring");
  if (!formRevisionsEnabled()) notFound();

  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const access = await pageFormsAccess(identity);
  if (access.noSalon) notFound();
  const loaded = await loadInstance(id);
  if (!loaded || !actorMaySeeInstance(access.actor, loaded.instance)) notFound();
  const readsExit = await pageCan("create_exit_form");
  const readable = withoutUnreadable([loaded.instance], (permission) =>
    permission === "create_exit_form" ? readsExit : false,
  );
  if (readable.length === 0) notFound();

  return createElement(FormRecordScreen, { instanceId: id, templateName: loaded.instance.templateName });
}
