"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { PageHeader, PageShell } from "@/components/ui/layout";
import { InlineForm } from "@/features/chat/inline-form";
import type { ChatFormInstanceRef } from "@/types";

import { formPageHref } from "./form-page-href";
import { FormRevisionsMount } from "./form-revisions-mount";
import { useMayEditForm } from "./use-revision-history";
import { REGISTER_HREF, REGISTER_NAME } from "./words";

/**
 * ============================================================================
 * ONE FORM, ON A PAGE OF ITS OWN
 * ============================================================================
 *
 * `FORM_REVISIONS_ENABLED`. The same live form card the chat shows, so a
 * form can be read, edited, finalized, revised with a reason and printed
 * without opening a conversation. Moving to another version (the new draft,
 * the previous one) moves the page, so the address always names the record
 * on screen.
 */
export function FormRecordScreen({ instanceId, templateName }: { instanceId: string; templateName: string }) {
  const router = useRouter();
  const reference: ChatFormInstanceRef = { instanceId, proposalId: "", templateName };
  const moveTo = (next: ChatFormInstanceRef) => router.replace(formPageHref(next.instanceId));
  /* The server's edit check, not the page's view permission: see `edit-permission.ts`. */
  const mayEdit = useMayEditForm(templateName);

  return (
    <PageShell>
      <PageHeader eyebrow="Forms" title={templateName} description="Edit, finalize and print this form, and see its history." />
      <Link
        href={REGISTER_HREF}
        className="mb-2 inline-flex items-center gap-1 text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
      >
        <ArrowLeft className="size-3.5" aria-hidden />
        Back to {REGISTER_NAME}
      </Link>
      <FormRevisionsMount reference={reference} onReplaced={moveTo} mayEdit={mayEdit}>
        <InlineForm reference={reference} prefill={{ kind: "complete" }} onReplaced={moveTo} />
      </FormRevisionsMount>
    </PageShell>
  );
}
