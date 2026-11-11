"use client";

import * as React from "react";

import { formRevisionsUiEnabled } from "@/lib/config/chat-quality-flags";
import type { ChatFormInstanceRef } from "@/types";

import { RevisionBanner } from "./revision-banner";
import { RevisionReasonDialog } from "./revision-reason-dialog";
import { openRevisionWithReason, useFormsCall, useRevisionHistory } from "./use-revision-history";

/** The form card's own button for editing a finalized form. */
export const EDIT_AS_NEW_DRAFT_LABEL = "Edit as new draft";

/**
 * ============================================================================
 * THE FORM CARD, WITH A REASON ON EVERY EDIT AND ITS HISTORY ABOVE IT
 * ============================================================================
 *
 * `NEXT_PUBLIC_FORM_REVISIONS_ENABLED`. Wraps the form card wherever it is
 * shown (the chat answer, the form page) without changing the card:
 *
 *   OFF, it renders the card and nothing else, so the page is exactly what
 *   it was.
 *
 *   ON, it shows the revision marks and history over the card, and the
 *   card's own "Edit as new draft" asks for the reason first: the click is
 *   caught on its way down, the reason dialog opens, and the revision is
 *   opened with the reason. The card then moves to the new draft through the
 *   same `onReplaced` its own button uses. When a revision is already open
 *   the click goes through untouched: the server answers that draft without
 *   asking again.
 *
 * Any other click on the card (finalizing, mainly) re-reads the history a
 * moment later, so the marks follow the record's status.
 *
 * `mayEdit` false (the form page, for a role without the permission the
 * server's edit check needs: `edit-permission.ts`) catches "Edit as new
 * draft" too, but says plainly that this role can read the form and not edit
 * it, instead of asking for a reason the server would answer with a 403.
 */
export function FormRevisionsMount({
  reference,
  onReplaced,
  mayEdit = true,
  children,
}: {
  reference: ChatFormInstanceRef;
  onReplaced?: (reference: ChatFormInstanceRef) => void;
  /** Whether this viewer may edit the form. The chat's card is its creator's, so it defaults to true. */
  mayEdit?: boolean;
  children: React.ReactNode;
}) {
  if (!formRevisionsUiEnabled()) return <>{children}</>;
  return (
    <ActiveMount key={reference.instanceId} reference={reference} onReplaced={onReplaced} mayEdit={mayEdit}>
      {children}
    </ActiveMount>
  );
}

function ActiveMount({
  reference,
  onReplaced,
  mayEdit,
  children,
}: {
  reference: ChatFormInstanceRef;
  onReplaced?: (reference: ChatFormInstanceRef) => void;
  mayEdit: boolean;
  children: React.ReactNode;
}) {
  const call = useFormsCall();
  const { state, reload } = useRevisionHistory(reference.instanceId);
  const [asking, setAsking] = React.useState(false);
  const [refused, setRefused] = React.useState(false);
  const timers = React.useRef<ReturnType<typeof setTimeout>[]>([]);
  React.useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const data = state.kind === "ready" ? state.data : null;
  const current = data?.history.entries.find((entry) => entry.id === reference.instanceId) ?? null;
  const openDraft = data?.history.entries.find(
    (entry) => entry.status === "draft" && entry.revisionNumber > (current?.revisionNumber ?? 0),
  );

  function onClickCapture(event: React.MouseEvent) {
    const button = (event.target as Element | null)?.closest?.("button");
    if (!button) return;
    if (button.textContent?.trim() === EDIT_AS_NEW_DRAFT_LABEL && !mayEdit) {
      event.preventDefault();
      event.stopPropagation();
      setRefused(true);
      return;
    }
    if (button.textContent?.trim() === EDIT_AS_NEW_DRAFT_LABEL && !openDraft) {
      event.preventDefault();
      event.stopPropagation();
      setAsking(true);
      return;
    }
    timers.current.push(setTimeout(reload, 1500), setTimeout(reload, 4000));
  }

  return (
    <>
      {data ? (
        <RevisionBanner
          data={data}
          onOpen={(entry) => onReplaced?.({ ...reference, instanceId: entry.id })}
        />
      ) : null}
      <div data-testid="form-revisions-mount" onClickCapture={onClickCapture}>
        {children}
      </div>
      {refused ? (
        <p role="status" aria-label="You may not edit this form" className="mt-2 text-xs text-muted-foreground">
          Your role can read this {reference.templateName} but not edit it.
        </p>
      ) : null}
      <RevisionReasonDialog
        open={asking}
        formName={reference.templateName}
        onCancel={() => setAsking(false)}
        onSubmit={async (reason) => {
          const next = await openRevisionWithReason(call, reference, reason);
          setAsking(false);
          onReplaced?.(next);
        }}
      />
    </>
  );
}
