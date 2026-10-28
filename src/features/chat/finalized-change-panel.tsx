"use client";

import * as React from "react";
import { Loader2, SlidersHorizontal } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/field";
import { FormsFetchError } from "@/features/forms/forms-fetch";
import { RevisionReasonDialog } from "@/form-revisions/revision-reason-dialog";
import { useMayEditForm } from "@/form-revisions/use-revision-history";
import { cardChangeFinalizedEnabled } from "@/lib/forms/card-change-flag";
import { formRevisionsUiEnabled } from "@/lib/config/chat-quality-flags";
import { managerDate } from "@/lib/forms/card-change-sentence";
import { templateHasWarningLevel } from "@/lib/forms/warning-level";

/**
 * ============================================================================
 * "CHANGE SOMETHING" ON A FINALIZED FORM
 * ============================================================================
 *
 * NEXT_PUBLIC_CARD_CHANGE_FINALIZED_ENABLED (Pau and QA, 28 Oct 2026; same
 * file in both apps). Beside "Edit as new draft", for a manager who may edit
 * this form: the date, and on a Corrective Action Form the type of warning and
 * payroll deduct, prefilled with what the form says. Send opens the revision
 * the same way "Edit as new draft" does — with the same reason dialog when
 * form revisions are on — and saves only the changed values onto that new
 * draft through the form's own save. No chat turn and no model: the server's
 * own checks (the edit permission, the location scope, the template's fields)
 * decide. The signed form is never written; the card then shows the draft.
 */
type Call = <T>(url: string, init?: RequestInit) => Promise<T>;

interface Current {
  readonly values: Record<string, string>;
  readonly checked: Record<string, string[]>;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const LEVELS = ["verbal", "written"] as const;

type PanelProps = Parameters<typeof Panel>[0];

/** Off, nothing — not even the session read (cards rendered without a session provider stay as they were). */
export function FinalizedChangePanel(props: PanelProps) {
  if (!cardChangeFinalizedEnabled()) return null;
  return <Panel {...props} />;
}

function Panel({
  instanceId,
  templateName,
  employeeName,
  current,
  call,
  onOpened,
}: {
  instanceId: string;
  templateName: string;
  employeeName: string;
  current: Current;
  call: Call;
  /** The new draft, which the card shows from now on. */
  onOpened: (draftId: string, templateName: string) => void;
}) {
  const mayEdit = useMayEditForm(templateName);
  const [open, setOpen] = React.useState(false);
  const [asking, setAsking] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [problem, setProblem] = React.useState<string | null>(null);
  const [opened, setOpened] = React.useState<{ id: string; name: string; note: string } | null>(null);

  const ca = templateHasWarningLevel({ name: templateName });
  const was = {
    date: ISO.test(current.values.form_date ?? "") ? current.values.form_date! : "",
    warning: LEVELS.find((level) => (current.checked.warning_type ?? []).includes(level)) ?? "",
    payroll: (current.checked.payroll_deduct ?? [])[0] ?? "",
  };
  const [date, setDate] = React.useState(was.date);
  const [warning, setWarning] = React.useState(was.warning);
  const [payroll, setPayroll] = React.useState(was.payroll);

  if (!mayEdit) return null;

  if (opened) {
    return (
      <div className="w-full min-w-0 rounded-[var(--radius-md)] border border-border bg-surface px-4 py-3" role="status">
        <p className="text-xs text-foreground">{opened.note}</p>
        <Button className="mt-2" size="sm" onClick={() => onOpened(opened.id, opened.name)}>
          Open the new draft
        </Button>
      </div>
    );
  }

  if (!open) {
    return (
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        <SlidersHorizontal aria-hidden />
        Change something
      </Button>
    );
  }

  const changes = () => {
    const values: Record<string, string> = {};
    const checked: Record<string, string[]> = {};
    if (date && date !== was.date) values.form_date = date;
    if (ca && warning && warning !== was.warning) checked.warning_type = [warning];
    if (ca && payroll && payroll !== was.payroll) checked.payroll_deduct = [payroll];
    return { values, checked };
  };

  async function apply(reason: string | null) {
    const { values, checked } = changes();
    const revision = await call<{ instance: { id: string; templateName?: string } }>(`/api/forms/instances/${instanceId}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(reason ? { action: "revise", reason } : { action: "revise" }),
    });
    const draftId = revision.instance.id;
    const name = revision.instance.templateName || templateName;
    const saved = await call<{ rejected?: { key: string; reason: string }[]; actionPlanRebuilt?: boolean }>(`/api/forms/instances/${draftId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ values, checked, source: "card-change" }),
    });
    const rejected = saved.rejected ?? [];
    if (rejected.length > 0) {
      setOpened({
        id: draftId,
        name,
        note: `The new draft is open, but these did not save: ${rejected.map((item) => item.key).join(", ")}. Set them on the draft.`,
      });
      return;
    }
    // CARD_CHANGE_PLAN_REBUILD_ENABLED: the server rebuilt the Action Plan, so there is nothing to check.
    if (checked.payroll_deduct && !saved.actionPlanRebuilt) {
      setOpened({
        id: draftId,
        name,
        note: "Your changes are on a new draft of this form; the signed form is unchanged. Payroll deduct changed: check the Action Plan on the draft, it was not rewritten.",
      });
      return;
    }
    onOpened(draftId, name);
  }

  async function send() {
    if (busy) return;
    if (date && !managerDate(date)) {
      setProblem("That date is not a real day.");
      return;
    }
    const { values, checked } = changes();
    if (Object.keys(values).length === 0 && Object.keys(checked).length === 0) {
      setProblem("Nothing is changed yet.");
      return;
    }
    setProblem(null);
    // Form revisions on: the same reason dialog as "Edit as new draft".
    if (formRevisionsUiEnabled()) {
      setAsking(true);
      return;
    }
    setBusy(true);
    try {
      await apply(null);
    } catch (error) {
      // The server asks for a reason (its revisions flag is on): ask it here too.
      if (error instanceof FormsFetchError && error.code === "REVISION_REASON_REQUIRED") setAsking(true);
      else setProblem((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const id = instanceId;
  // A year past next year is a typo, not a form date; the native picker stops there.
  const maxDate = `${new Date().getFullYear() + 1}-12-31`;

  return (
    <div className="w-full min-w-0 rounded-[var(--radius-md)] border border-border bg-surface px-4 py-3" data-finalized-change="">
      <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="min-w-0 space-y-1.5">
          <Label htmlFor={`fin-date-${id}`}>Date</Label>
          <Input id={`fin-date-${id}`} type="date" min="2000-01-01" max={maxDate} value={date} onChange={(event) => setDate(event.target.value)} />
        </div>
        {ca ? (
          <div className="min-w-0 space-y-1.5">
            <Label htmlFor={`fin-warning-${id}`}>Type of warning</Label>
            <Select id={`fin-warning-${id}`} value={warning} onChange={(event) => setWarning(event.target.value)}>
              <option value="">Not set</option>
              <option value="verbal">Verbal Warning</option>
              <option value="written">Written Warning</option>
            </Select>
          </div>
        ) : null}
        {ca ? (
          <div className="min-w-0 space-y-1.5">
            <Label htmlFor={`fin-payroll-${id}`}>Payroll deduct</Label>
            <Select id={`fin-payroll-${id}`} value={payroll} onChange={(event) => setPayroll(event.target.value)}>
              <option value="">Not set</option>
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </Select>
          </div>
        ) : null}
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        Changes go on a new draft of this form. The signed form stays as it is.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button size="sm" onClick={() => void send()} disabled={busy}>
          {busy ? <Loader2 className="animate-spin" /> : null}
          Send change
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setOpen(false);
            setProblem(null);
            setDate(was.date);
            setWarning(was.warning);
            setPayroll(was.payroll);
          }}
          disabled={busy}
        >
          Cancel
        </Button>
        {problem ? (
          <span className="text-xs text-status-attention" role="alert">
            {problem}
          </span>
        ) : null}
      </div>
      <RevisionReasonDialog
        open={asking}
        formName={`${templateName} · ${employeeName}`}
        onCancel={() => setAsking(false)}
        onSubmit={async (reason) => {
          await apply(reason);
          setAsking(false);
        }}
      />
    </div>
  );
}
