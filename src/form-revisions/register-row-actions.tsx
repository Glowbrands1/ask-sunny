"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { History, PencilLine } from "lucide-react";

import { formRevisionsUiEnabled } from "@/lib/config/chat-quality-flags";

import { RevisionReasonDialog } from "./revision-reason-dialog";
import { openRevisionWithReason, useFormsCall, useMayEditForm } from "./use-revision-history";
import { formPageHref } from "./form-page-href";

const LINK =
  "inline-flex min-h-8 items-center gap-1 px-1 text-[12px] whitespace-nowrap text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline";

/** A row of the forms list: the fields of `MonitoredForm` these actions read. */
interface RowForm {
  id: string;
  status: "draft" | "finalized" | "revised";
  templateName: string;
  templateShortName: string;
  employeeName: string;
}

/**
 * ============================================================================
 * EDIT AND HISTORY ON A ROW OF THE FORMS LIST
 * ============================================================================
 *
 * `NEXT_PUBLIC_FORM_REVISIONS_ENABLED`; renders nothing with it off.
 *
 *   EDIT on a finalized form asks for the reason, opens the revision and goes
 *   to its form page. On a draft it goes straight to the form page. A form
 *   already superseded has no Edit: its newer version is the one to change,
 *   and History leads there.
 *
 *   HISTORY opens the form page at its history.
 *
 *   EDIT ONLY FOR SOMEBODY WHO MAY EDIT THAT FORM. The server's edit check
 *   needs the template's own permission (`edit-permission.ts`); seeing the
 *   list is not enough. A role that may read the list but not edit this
 *   template (one that creates no form, or lacks this template's permission)
 *   gets History alone, not a reason dialog that ends in a 403.
 */
export function RegisterRowActions({
  form,
}: {
  form: RowForm;
}) {
  if (!formRevisionsUiEnabled()) return null;
  return <ActiveRowActions form={form} />;
}

function ActiveRowActions({
  form,
}: {
  form: RowForm;
}) {
  const router = useRouter();
  const call = useFormsCall();
  const [asking, setAsking] = React.useState(false);
  const mayEdit = useMayEditForm(form.templateName);

  return (
    <>
      {!mayEdit ? null : form.status === "draft" ? (
        <Link href={formPageHref(form.id)} className={LINK} aria-label={`Edit the ${form.templateShortName} for ${form.employeeName}`}>
          <PencilLine className="size-3.5" />
          Edit
        </Link>
      ) : form.status === "finalized" ? (
        <button
          type="button"
          onClick={() => setAsking(true)}
          className={LINK}
          aria-label={`Edit the ${form.templateShortName} for ${form.employeeName}`}
        >
          <PencilLine className="size-3.5" />
          Edit
        </button>
      ) : null}
      <Link href={`${formPageHref(form.id)}#history`} className={LINK} aria-label={`History of the ${form.templateShortName} for ${form.employeeName}`}>
        <History className="size-3.5" />
        History
      </Link>
      <RevisionReasonDialog
        open={asking}
        formName={`${form.templateShortName} · ${form.employeeName}`}
        onCancel={() => setAsking(false)}
        onSubmit={async (reason) => {
          const next = await openRevisionWithReason(
            call,
            { instanceId: form.id, proposalId: "", templateName: form.templateShortName },
            reason,
          );
          setAsking(false);
          router.push(formPageHref(next.instanceId));
        }}
      />
    </>
  );
}
