"use client";

import * as React from "react";
import { AlertTriangle, Loader2, PencilLine } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label, Textarea } from "@/components/ui/field";
import { Dialog, DialogActions, DialogContent } from "@/components/ui/overlays";
import {
  normalizeRevisionReason,
  REVISION_REASON_MAX_LENGTH,
  REVISION_REASON_REQUIRED_MESSAGE,
  REVISION_RESIGN_NOTICE,
} from "@/lib/forms/revision-history";

/**
 * ============================================================================
 * WHY IS THIS FINALIZED FORM BEING EDITED?
 * ============================================================================
 *
 * `FORM_REVISIONS_ENABLED`. Asked before a revision opens, from the form card,
 * the form page and the register alike. The button stays disabled until the
 * box holds a reason the server will accept (`normalizeRevisionReason`), and
 * the server refuses one without it anyway. The wording says the new
 * printout has to be signed again: signatures are paper-only, so nothing
 * carries over.
 */
export function RevisionReasonDialog({
  open,
  formName,
  onCancel,
  onSubmit,
}: {
  open: boolean;
  /** "Corrective Action Form · Employee Name", for the description line. */
  formName: string;
  onCancel: () => void;
  /** Opens the revision. A thrown error is shown in the dialog, which stays open. */
  onSubmit: (reason: string) => Promise<void>;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
    >
      {open ? (
        <ReasonBody
          formName={formName}
          onCancel={onCancel}
          onSubmit={onSubmit}
        />
      ) : null}
    </Dialog>
  );
}

/** Mounted only while the dialog is open, so every opening starts empty. */
function ReasonBody({
  formName,
  onCancel,
  onSubmit,
}: {
  formName: string;
  onCancel: () => void;
  onSubmit: (reason: string) => Promise<void>;
}) {
  const [text, setText] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const reason = normalizeRevisionReason(text);

  async function submit() {
    if (!reason || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit(reason);
    } catch (failure) {
      setError((failure as Error).message);
      setBusy(false);
    }
  }

  return (
    <DialogContent title="Edit this finalized form?" description={formName}>
      <div
        data-testid="revision-reason-dialog"
        className="space-y-3 text-[13px] leading-relaxed"
      >
        <p className="text-muted-foreground">
          The finalized form stays on file unchanged. A new draft opens with
          every answer carried over, and it replaces the finalized form once you
          finalize it.
        </p>
        <div className="space-y-1.5">
          <Label htmlFor="revision-reason">
            Reason for the edit (required)
          </Label>
          <Textarea
            id="revision-reason"
            value={text}
            maxLength={REVISION_REASON_MAX_LENGTH}
            rows={3}
            placeholder="For example: the incident date was entered wrong."
            onChange={(event) => setText(event.target.value)}
          />
          <p className="text-xs text-subtle-foreground">
            Kept on the form&apos;s history with your name and the date.
          </p>
        </div>
        <p className="text-xs font-medium text-foreground">
          {REVISION_RESIGN_NOTICE}
        </p>
        {error ? (
          <p
            role="alert"
            className="flex items-start gap-1 text-xs text-status-attention"
          >
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            {error}
          </p>
        ) : !reason && text.trim() !== "" ? (
          <p className="text-xs text-status-attention">
            {REVISION_REASON_REQUIRED_MESSAGE}
          </p>
        ) : null}
      </div>
      <DialogActions>
        <Button variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button
          variant="accent"
          onClick={() => void submit()}
          disabled={!reason || busy}
        >
          {busy ? <Loader2 className="animate-spin" /> : <PencilLine />}
          Open new draft
        </Button>
      </DialogActions>
    </DialogContent>
  );
}
