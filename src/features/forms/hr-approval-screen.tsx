"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { PageHeader, PageShell } from "@/components/ui/layout";
import { InlineForm } from "@/features/chat/inline-form";
import type { ChatFormInstanceRef } from "@/types";

/**
 * ONE FORM FOR HR APPROVAL (FORMS_HR_APPROVAL_ENABLED) — where every bell for
 * an approval leads. The same live form card the chat shows: HR reads it,
 * edits it, and decides in its approval panel; the manager who sent it reads
 * HR's answer and notes there. The page itself is served only to those two
 * (`app/(app)/forms/hr-approval/[id]/page.ts`).
 */
export function HrApprovalScreen({ instanceId, templateName, backHref, backLabel }: {
  instanceId: string;
  templateName: string;
  backHref: string;
  backLabel: string;
}) {
  const reference: ChatFormInstanceRef = { instanceId, proposalId: "", templateName };
  return (
    <PageShell>
      <PageHeader eyebrow="Forms" title={templateName} description="HR approval: review, edit, approve, send back or reject this form." />
      <Link
        href={backHref}
        className="mb-2 inline-flex items-center gap-1 text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
      >
        <ArrowLeft className="size-3.5" aria-hidden />
        {backLabel}
      </Link>
      <InlineForm reference={reference} prefill={{ kind: "complete" }} />
    </PageShell>
  );
}
