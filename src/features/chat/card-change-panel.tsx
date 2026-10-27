"use client";

import * as React from "react";
import { Pencil } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/field";
import { cardChangeEnabled } from "@/lib/forms/card-change-flag";
import { cardChangeSentence, managerDate, type CardChange } from "@/lib/forms/card-change-sentence";
import { isProposalSuperseded } from "@/lib/forms/proposal-continuation";
import { templateHasWarningLevel } from "@/lib/forms/warning-level";
import type { ChatFormProposal, ChatMessage } from "@/types";

/**
 * ============================================================================
 * "CHANGE SOMETHING" UNDER THE FORM CARD
 * ============================================================================
 *
 * NEXT_PUBLIC_CARD_CHANGE_ENABLED (owner and QA, 27 Oct 2026; same file in
 * both apps). The panel edits nothing in the browser: Send puts the manager's
 * choices into one ordinary chat turn (`cardChangeSentence`) through the same
 * path a suggestion chip uses, and the chat reads it like anything typed. The
 * server still decides what is taken.
 *
 * Offered only on the current proposal, before a form exists. Off, or on any
 * other card, it renders nothing.
 */
export function CardChangePanel({
  proposal,
  created,
  conversation,
  placeLabel,
  onSend,
}: {
  proposal: ChatFormProposal | null | undefined;
  /** A form already exists for this card: its editor is the place to change it. */
  created: boolean;
  conversation: ChatMessage[];
  /** "Salon" or "Store", as the card labels it. */
  placeLabel: string;
  onSend: (turn: string) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [change, setChange] = React.useState<CardChange>({});
  const [problem, setProblem] = React.useState<string | null>(null);

  if (!cardChangeEnabled() || !proposal || created) return null;
  if (isProposalSuperseded(conversation, proposal.proposalId)) return null;

  const id = proposal.proposalId;
  const hasWarning = templateHasWarningLevel({ key: proposal.templateKey, name: proposal.templateName });
  // A year past next year is a typo, not a form date; the native picker stops there.
  const maxDate = `${new Date().getFullYear() + 1}-12-31`;
  const set = (next: CardChange) => {
    setChange((current) => ({ ...current, ...next }));
    setProblem(null);
  };

  if (!open) {
    return (
      <div className="mt-2">
        <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
          <Pencil aria-hidden />
          Change something
        </Button>
      </div>
    );
  }

  const send = () => {
    if (change.formDate && !managerDate(change.formDate)) {
      setProblem("That date is not a real day.");
      return;
    }
    const turn = cardChangeSentence(
      change,
      {
        formDate: proposal.formDate,
        warningLevel: proposal.warningLevel,
        payrollDeduct: proposal.payrollDeduct,
        locationName: null,
        employeeRole: proposal.employeeRole,
      },
      placeLabel,
    );
    if (!turn) {
      setProblem("Nothing is changed yet.");
      return;
    }
    onSend(turn);
    setOpen(false);
    setChange({});
  };

  return (
    <div className="mt-2 min-w-0 rounded-[var(--radius-md)] border border-border bg-surface px-4 py-3" data-card-change="">
      <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="min-w-0 space-y-1.5">
          <Label htmlFor={`change-date-${id}`}>Date</Label>
          <Input
            id={`change-date-${id}`}
            type="date"
            min="2000-01-01"
            max={maxDate}
            value={change.formDate ?? proposal.formDate ?? ""}
            onChange={(event) => set({ formDate: event.target.value })}
          />
        </div>
        {hasWarning ? (
          <div className="min-w-0 space-y-1.5">
            <Label htmlFor={`change-warning-${id}`}>Type of warning</Label>
            <Select
              id={`change-warning-${id}`}
              value={change.warningLevel ?? ""}
              onChange={(event) => set({ warningLevel: (event.target.value || null) as CardChange["warningLevel"] })}
            >
              <option value="">Keep as is</option>
              <option value="verbal">Verbal Warning</option>
              <option value="written">Written Warning</option>
            </Select>
          </div>
        ) : null}
        {hasWarning ? (
          <div className="min-w-0 space-y-1.5">
            <Label htmlFor={`change-payroll-${id}`}>Payroll deduct</Label>
            <Select
              id={`change-payroll-${id}`}
              value={change.payrollDeduct ?? ""}
              onChange={(event) => set({ payrollDeduct: (event.target.value || null) as CardChange["payrollDeduct"] })}
            >
              <option value="">Keep as is</option>
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </Select>
          </div>
        ) : null}
        <div className="min-w-0 space-y-1.5">
          <Label htmlFor={`change-place-${id}`}>{placeLabel}</Label>
          <Input
            id={`change-place-${id}`}
            placeholder="Keep as is"
            value={change.locationName ?? ""}
            onChange={(event) => set({ locationName: event.target.value })}
          />
        </div>
        <div className="min-w-0 space-y-1.5">
          <Label htmlFor={`change-title-${id}`}>Job title</Label>
          <Input
            id={`change-title-${id}`}
            placeholder={proposal.employeeRole ?? "Keep as is"}
            value={change.employeeRole ?? ""}
            onChange={(event) => set({ employeeRole: event.target.value })}
          />
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button size="sm" onClick={send}>
          Send change
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setOpen(false);
            setChange({});
            setProblem(null);
          }}
        >
          Cancel
        </Button>
        {problem ? (
          <span className="text-xs text-status-attention" role="alert">
            {problem}
          </span>
        ) : null}
      </div>
    </div>
  );
}
