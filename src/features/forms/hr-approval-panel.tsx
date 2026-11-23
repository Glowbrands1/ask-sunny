"use client";

import * as React from "react";
import { Check, Clock, Loader2, MessageSquare, Send, Undo2, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label, Textarea } from "@/components/ui/field";
import { Notice } from "@/components/ui/feedback";
import { formatBusinessTime } from "@/lib/business-date";

/**
 * ============================================================================
 * THE HR APPROVAL PANEL — on the form card, for its creator and HR only
 * ============================================================================
 *
 * The server sends `hrApproval` with a form only to the manager who created it
 * and to HR (`hrApprovalViewFor`); anybody else's card never receives it, so
 * this panel cannot render for them.
 *
 *   HR, while the form waits    Approve · Send back for changes · Reject, a note
 *                               required for the last two; a note box for comments
 *   the creator                 the state, how long it has waited, and every note
 */

export interface HrApprovalPanelView {
  state: "pending" | "changes_requested" | "rejected" | "approved";
  label: string;
  requestedAt: string | null;
  waiting: string | null;
  overdue: boolean;
  canDecide: boolean;
  canEdit: boolean;
  /** Pending, but HR approval is off or nobody can approve: the creator may finalize it themselves. */
  released?: boolean;
  history: { action: string; by: string; note: string | null; at: string }[];
}

const ACTION_WORDS: Record<string, string> = {
  submitted: "sent it for approval",
  approved: "approved it",
  rejected: "rejected it",
  changes_requested: "sent it back for changes",
  edited: "edited the form",
  commented: "added a note",
  withdrawn: "withdrew it",
};

type Busy = null | "approve" | "reject" | "send_back" | "comment";

export function HrApprovalPanel({
  instanceId,
  view,
  call,
  onChanged,
}: {
  instanceId: string;
  view: HrApprovalPanelView;
  call: (url: string, init: RequestInit) => Promise<unknown>;
  onChanged: () => Promise<void> | void;
}) {
  const [note, setNote] = React.useState("");
  const [busy, setBusy] = React.useState<Busy>(null);
  const [error, setError] = React.useState<string | null>(null);

  async function act(action: Exclude<Busy, null>) {
    if (busy) return;
    const trimmed = note.trim();
    if ((action === "reject" || action === "send_back") && !trimmed) {
      setError(action === "reject" ? "Add a note saying why the form is rejected." : "Add a note saying what needs to change.");
      return;
    }
    if (action === "comment" && !trimmed) {
      setError("Write a note first.");
      return;
    }
    setBusy(action);
    setError(null);
    try {
      const apiAction =
        action === "approve" ? "hr_approve" : action === "reject" ? "hr_reject" : action === "send_back" ? "hr_send_back" : "hr_comment";
      await call(`/api/forms/instances/${instanceId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: apiAction, ...(trimmed ? { note: trimmed } : {}) }),
      });
      setNote("");
      await onChanged();
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const tone = view.state === "approved" ? "outline" : view.state === "pending" ? "accent" : "outline";

  return (
    <section
      aria-label="HR approval"
      data-testid="hr-approval-panel"
      className="mt-3 rounded-[var(--radius-md)] border border-border bg-surface p-3"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={tone} size="sm">
          {view.label}
        </Badge>
        {view.waiting ? (
          <span className="inline-flex items-center gap-1 text-xs text-subtle-foreground">
            <Clock className="size-3.5" aria-hidden />
            {view.waiting}
          </span>
        ) : null}
        {view.overdue ? (
          <Badge tone="attention" size="sm">
            Overdue
          </Badge>
        ) : null}
      </div>

      {view.history.length > 0 ? (
        <ol className="mt-2 space-y-1.5 text-xs">
          {view.history.map((entry, index) => (
            <li key={`${entry.at}-${index}`} className="text-muted-foreground">
              <span className="font-medium text-foreground">{entry.by}</span> {ACTION_WORDS[entry.action] ?? entry.action}
              {formatBusinessTime(entry.at) ? <span className="text-subtle-foreground"> · {formatBusinessTime(entry.at)}</span> : null}
              {entry.note ? <p className="mt-0.5 whitespace-pre-wrap text-foreground">{entry.note}</p> : null}
            </li>
          ))}
        </ol>
      ) : null}

      {view.released ? (
        <p className="mt-2 text-xs text-muted-foreground">
          HR approval is not running right now, so this form is yours again: you can change it and finalize it.
        </p>
      ) : view.state === "pending" && !view.canDecide ? (
        <p className="mt-2 text-xs text-muted-foreground">
          HR is reviewing this form. It is finalized when they approve it, and you will see their answer in the bell.
        </p>
      ) : null}
      {view.state === "changes_requested" || view.state === "rejected" ? (
        !view.canDecide ? (
          <p className="mt-2 text-xs text-muted-foreground">
            Make the changes on the form, save, then press Finalize and send for approval again.
          </p>
        ) : null
      ) : null}

      <div className="mt-3 space-y-2">
        <Label htmlFor={`hr-note-${instanceId}`} className="text-xs">
          {view.canDecide ? "Note to the manager" : "Note"}
        </Label>
        <Textarea
          id={`hr-note-${instanceId}`}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          rows={3}
          maxLength={4000}
          placeholder={view.canDecide ? "Required to reject or send back. Optional to approve." : "Add a note"}
        />
        <div className="flex flex-wrap items-center gap-2">
          {view.canDecide ? (
            <>
              <Button variant="accent" size="sm" onClick={() => void act("approve")} disabled={busy !== null}>
                {busy === "approve" ? <Loader2 className="animate-spin" /> : <Check />}
                Approve
              </Button>
              <Button size="sm" onClick={() => void act("send_back")} disabled={busy !== null}>
                {busy === "send_back" ? <Loader2 className="animate-spin" /> : <Undo2 />}
                Send back for changes
              </Button>
              <Button variant="secondary" size="sm" onClick={() => void act("reject")} disabled={busy !== null}>
                {busy === "reject" ? <Loader2 className="animate-spin" /> : <X />}
                Reject
              </Button>
            </>
          ) : null}
          <Button variant="ghost" size="sm" onClick={() => void act("comment")} disabled={busy !== null}>
            {busy === "comment" ? <Loader2 className="animate-spin" /> : view.canDecide ? <MessageSquare /> : <Send />}
            Add note
          </Button>
        </div>
        {view.canDecide ? (
          <p className="text-xs text-subtle-foreground">
            You can edit the form above before approving. Approving finalizes it.
          </p>
        ) : null}
      </div>

      {error ? (
        <Notice tone="attention" className="mt-2">
          {error}
        </Notice>
      ) : null}
    </section>
  );
}
