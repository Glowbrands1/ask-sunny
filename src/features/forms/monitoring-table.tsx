"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Archive, ArchiveRestore, Download, Loader2, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Notice } from "@/components/ui/feedback";
import { ScrollTable } from "@/components/ui/layout";
import { Label, Select } from "@/components/ui/field";
import { Dialog, DialogActions, DialogContent } from "@/components/ui/overlays";
import { useSession } from "@/lib/session/session-context";
import { cn } from "@/lib/utils/cn";
import { formatDate } from "@/lib/utils/date";
import { downloadFormPdf, formsFetch } from "./forms-fetch";

/**
 * FORM MONITORING — the system of record, not a list of what this browser did.
 *
 * Every column here answers a question somebody actually asks about a filed
 * form: which form, about whom, at which salon, who created it, when, what
 * state it is in, WHICH TEMPLATE VERSION it was filled from, whether Ask Sunny
 * drafted it or a manager typed it, and when the follow-up is due.
 *
 * The template version is the column people forget and then need: a form filled
 * from version 2 prints version 2 forever, and "why does this one look
 * different" has an answer in the table rather than an investigation.
 */

export type MonitoringView = "active" | "archived" | "all";

export interface MonitoredForm {
  id: string;
  templateName: string;
  templateShortName: string;
  templateVersion: number;
  variantKey: string | null;
  employeeName: string;
  locationName: string | null;
  createdBy: string;
  createdByRole: string | null;
  source: "manual" | "ask_sunny";
  status: "draft" | "finalized" | "revised";
  formDate: string;
  followUpDate: string | null;
  finalizedAt: string | null;
  exportedAt: string | null;
  revisesInstanceId: string | null;
  archivedAt: string | null;
  /**
   * True when the row carries `demo:` provenance — a fact written by the
   * server when it was created, not a guess from the employee's name.
   */
  isDemo: boolean;
  updatedAt: string;
}

/**
 * The actions column's heading is blank on purpose — "PDF / Delete" as a label
 * would read as data. It still needs a stable identity so the sticky treatment
 * can be applied to the right column rather than to a position in a list.
 */
const ACTIONS_COLUMN = "\u200b";

/*
 * Pinned, with a shadow rather than only a border.
 *
 * The columns are trimmed to fit a normal desktop, so at that width nothing is
 * covered. When the window is narrower the table scrolls and this column stays
 * put — and then it IS overlapping the column beside it, so it needs to read as
 * something floating above the table rather than as a column that has eaten its
 * neighbour. The shadow is what says that.
 */
const PINNED =
  "sticky right-0 bg-surface shadow-[-8px_0_8px_-6px_color-mix(in_srgb,var(--foreground)_12%,transparent)]";

const STATUS_TONE = {
  draft: "attention",
  finalized: "ready",
  revised: "neutral",
} as const;

export function MonitoringTable({
  forms,
  notice,
  view,
  demo,
}: {
  forms: MonitoredForm[];
  notice: string | null;
  /** Which shelf the server read. Changing it re-reads on the server. */
  view: MonitoringView;
  /**
   * What a demo sweep would do, counted on the SERVER across every shelf — not
   * from the rows on screen, which are filtered and would give a wrong number
   * the moment somebody switches to Archived.
   */
  demo: { deletable: number; protected: number };
}) {
  const [status, setStatus] = React.useState<string>("all");
  const [templateName, setTemplateName] = React.useState<string>("all");
  const [downloading, setDownloading] = React.useState<string | null>(null);
  const [problem, setProblem] = React.useState<string | null>(null);
  const [message, setMessage] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  /** The row a confirmation dialog is open for, and what it would do. */
  const [confirming, setConfirming] = React.useState<
    { kind: "delete" | "archive" | "restore"; form: MonitoredForm } | null
  >(null);
  const [sweeping, setSweeping] = React.useState(false);
  const { role, user, can, demoMode } = useSession();
  const router = useRouter();

  /*
   * WHO SEES THESE CONTROLS, and why preview is deliberately open.
   *
   * The server is the authority: every call below goes through
   * `authorizeForms(request, "manage_form_records")`. In preview that guard
   * resolves the permission and carries it rather than refusing, because the
   * role arrives in a header the browser sets and nobody has configured roles
   * yet — so a client-side refusal here would only hide the button from the
   * owner doing the QA while changing nothing about what a request can do.
   *
   * This mirrors that exactly: open in preview, matrix-gated once identity is
   * real. When enforcement moves into `authorizeRequest`, this line becomes
   * `can("manage_form_records")` alone and the two stay in step.
   */
  const mayManage = demoMode || can("manage_form_records");

  const call = React.useCallback(
    <T,>(url: string, init: RequestInit = {}) => formsFetch<T>(url, role, user.name, init),
    [role, user.name],
  );

  /**
   * DELETE, and why the dialog is not optional.
   *
   * This destroys a draft and everything filled into it. The confirmation names
   * the employee, the form and the status, because "are you sure?" on its own
   * is a dialog people learn to dismiss without reading.
   */
  async function removeForm(form: MonitoredForm) {
    setBusy(form.id);
    setProblem(null);
    setMessage(null);
    try {
      // `formsFetch` turns the route's 409 — "this form is finalized, archive
      // it instead" — into the thrown message shown below, so the refusal
      // reaches the person in the server's own words.
      await call(`/api/forms/instances/${form.id}`, { method: "DELETE" });
      setMessage(`Deleted the ${form.templateShortName} for ${form.employeeName}.`);
      router.refresh();
    } catch (error) {
      setProblem((error as Error).message);
    } finally {
      setBusy(null);
      setConfirming(null);
    }
  }

  /** Archive, or put back. Never touches status or a single filled value. */
  async function setArchived(form: MonitoredForm, archived: boolean) {
    setBusy(form.id);
    setProblem(null);
    setMessage(null);
    try {
      await call(`/api/forms/instances/${form.id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ archived }),
      });
      setMessage(
        archived
          ? `Archived the ${form.templateShortName} for ${form.employeeName}. The record is kept.`
          : `Restored the ${form.templateShortName} for ${form.employeeName}.`,
      );
      router.refresh();
    } catch (error) {
      setProblem((error as Error).message);
    } finally {
      setBusy(null);
      setConfirming(null);
    }
  }

  async function sweepDemo() {
    setBusy("sweep");
    setProblem(null);
    setMessage(null);
    try {
      // The count is sent back so a list that changed underneath aborts rather
      // than deleting a different set than was agreed to.
      const result = await call<{ deleted: number }>(
        `/api/forms/instances?scope=demo&expected=${demo.deletable}`,
        { method: "DELETE" },
      );
      setMessage(
        `Removed ${result.deleted} synthetic form${result.deleted === 1 ? "" : "s"} created during Preview QA.`,
      );
      router.refresh();
    } catch (error) {
      setProblem((error as Error).message);
    } finally {
      setBusy(null);
      setSweeping(false);
    }
  }

  /*
   * The PDF is FETCHED, not linked to. A plain <a href> navigation carries none
   * of the Forms headers, so the route answers 401 and the manager downloads an
   * error message instead of the record. See downloadFormPdf.
   */
  async function download(id: string) {
    setDownloading(id);
    setProblem(null);
    try {
      await downloadFormPdf(id, role, user.name);
    } catch (error) {
      setProblem((error as Error).message);
    } finally {
      setDownloading(null);
    }
  }

  const templateNames = [...new Set(forms.map((form) => form.templateName))].sort();

  const shown = forms.filter(
    (form) =>
      (status === "all" || form.status === status) &&
      (templateName === "all" || form.templateName === templateName),
  );

  const overdue = shown.filter(
    (form) =>
      form.followUpDate &&
      form.status !== "revised" &&
      new Date(form.followUpDate) < new Date(),
  ).length;

  /*
   * The shelf is a SERVER read, not a client filter: archived rows are not in
   * `forms` at all when the active list is showing, so switching has to go back
   * to the server. Status and Form stay client-side — those narrow what has
   * already been fetched.
   */
  function showView(next: MonitoringView) {
    router.push(next === "active" ? "/forms/monitoring" : `/forms/monitoring?view=${next}`);
  }

  const EMPTY_MESSAGE: Record<MonitoringView, React.ReactNode> = {
    active: (
      <>
        No forms yet. Create one from <span className="text-foreground">Create a Form</span>.
      </>
    ),
    archived: <>Nothing is archived.</>,
    all: (
      <>
        No forms yet. Create one from <span className="text-foreground">Create a Form</span>.
      </>
    ),
  };

  return (
    <div className="space-y-4">
      {notice ? <Notice tone="attention">{notice}</Notice> : null}
      {problem ? <Notice tone="attention">{problem}</Notice> : null}
      {message ? <Notice tone="accent">{message}</Notice> : null}

      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 p-4">
          <div className="flex items-center gap-2">
            <Label htmlFor="monitoring-view" className="text-muted-foreground">
              Show
            </Label>
            <Select
              id="monitoring-view"
              value={view}
              onChange={(event) => showView(event.target.value as MonitoringView)}
              className="h-9 w-40"
            >
              <option value="active">Active forms</option>
              <option value="archived">Archived</option>
              <option value="all">All</option>
            </Select>
          </div>
          <Select
            aria-label="Status"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            className="h-9 w-40"
          >
            <option value="all">All statuses</option>
            <option value="draft">Draft</option>
            <option value="finalized">Finalized</option>
            <option value="revised">Revised</option>
          </Select>
          <Select
            aria-label="Form"
            value={templateName}
            onChange={(event) => setTemplateName(event.target.value)}
            className="h-9 w-56"
          >
            <option value="all">All forms</option>
            {templateNames.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </Select>
          <p className="ml-auto text-[12px] text-muted-foreground">
            {shown.length} form{shown.length === 1 ? "" : "s"}
            {overdue > 0 ? (
              <>
                {" · "}
                {/* Overdue follow-ups are the one thing on this screen that
                    needs somebody to act, so they take the follow-up colour. */}
                <span className="font-medium text-followup-attention">
                  {overdue} follow-up{overdue === 1 ? "" : "s"} overdue
                </span>
              </>
            ) : null}
          </p>
          {/*
            * The sweep only appears when there is something for it to do, and
            * its count comes from the SERVER across every shelf — not from the
            * rows on screen, which are filtered.
            */}
          {mayManage && demo.deletable > 0 ? (
            <Button variant="secondary" size="sm" onClick={() => setSweeping(true)}>
              <Trash2 />
              Delete test forms
            </Button>
          ) : null}
        </CardContent>
      </Card>

      {shown.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-[13px] text-muted-foreground">
            {EMPTY_MESSAGE[view]}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <ScrollTable>
              <table className="w-full min-w-[900px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-border">
                    {[
                      "Form",
                      "Employee",
                      "Location",
                      "Created by",
                      "Date",
                      "Status",
                      "Version",
                      "Source",
                      "Follow-up",
                      "Updated",
                      ACTIONS_COLUMN,
                    ].map((heading) => (
                      <th
                        key={heading}
                        /*
                         * THE ACTIONS COLUMN IS PINNED TO THE RIGHT EDGE.
                         *
                         * The table is wider than the screen, and the first
                         * browser run showed Delete sitting off the right of the
                         * viewport — reachable only by scrolling sideways for a
                         * control people need on every row. Pinned, it is always
                         * where the eye already is.
                         */
                        className={cn(
                          "eyebrow px-2.5 py-2 text-left whitespace-nowrap",
                          heading === ACTIONS_COLUMN ? PINNED : "",
                        )}
                      >
                        {heading}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {shown.map((form) => {
                    const late =
                      form.followUpDate &&
                      form.status !== "revised" &&
                      new Date(form.followUpDate) < new Date();
                    const working = busy === form.id;
                    return (
                      <tr key={form.id} className="border-b border-border last:border-0">
                        <td className="px-2.5 py-2 whitespace-nowrap text-foreground">
                          {form.templateShortName}
                          {form.variantKey ? (
                            <span className="ml-1.5 text-[11px] text-subtle-foreground">
                              {form.variantKey}
                            </span>
                          ) : null}
                        </td>
                        <td className="px-2.5 py-2 whitespace-nowrap">{form.employeeName}</td>
                        <td
                          className="max-w-[140px] truncate px-2.5 py-2 text-muted-foreground"
                          title={form.locationName ?? undefined}
                        >
                          {form.locationName ?? "—"}
                        </td>
                        <td
                          className="max-w-[130px] truncate px-2.5 py-2 text-muted-foreground"
                          title={form.createdBy}
                        >
                          {form.createdBy}
                        </td>
                        <td className="px-2.5 py-2 whitespace-nowrap tabular-nums">
                          {formatDate(form.formDate)}
                        </td>
                        <td className="px-2.5 py-2">
                          <div className="flex items-center gap-1.5">
                            <Badge tone={STATUS_TONE[form.status]} size="sm">
                              {form.status}
                            </Badge>
                            {/* Archived is WHERE a form is shown, not what it
                                is, so it reads as a separate quiet mark rather
                                than replacing the status. */}
                            {form.archivedAt ? (
                              <span className="inline-flex items-center gap-1 text-[11px] text-subtle-foreground">
                                <Archive className="size-3" />
                                archived
                              </span>
                            ) : null}
                          </div>
                        </td>
                        <td className="px-2.5 py-2 whitespace-nowrap tabular-nums text-muted-foreground">
                          v{form.templateVersion}
                        </td>
                        <td className="px-2.5 py-2">
                          <Badge tone={form.source === "ask_sunny" ? "primary" : "neutral"} size="sm">
                            {form.source === "ask_sunny" ? "Ask Sunny" : "Manual"}
                          </Badge>
                        </td>
                        <td className="px-2.5 py-2 whitespace-nowrap tabular-nums">
                          {form.followUpDate ? (
                            <span className={late ? "font-medium text-followup-attention" : ""}>
                              {formatDate(form.followUpDate)}
                            </span>
                          ) : (
                            <span className="text-subtle-foreground">—</span>
                          )}
                        </td>
                        <td className="px-2.5 py-2 whitespace-nowrap text-muted-foreground tabular-nums">
                          {formatDate(form.updatedAt)}
                        </td>
                        <td className={cn(PINNED, "px-2.5 py-2")}>
                          <div className="flex items-center justify-end gap-3">
                            <button
                              type="button"
                              onClick={() => download(form.id)}
                              disabled={downloading === form.id}
                              className="inline-flex items-center gap-1 text-[12px] text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline disabled:opacity-60"
                            >
                              <Download className="size-3.5" />
                              {downloading === form.id ? "Preparing…" : "PDF"}
                            </button>
                            {/*
                              * DELETE OR ARCHIVE — decided by status, not by a
                              * dropdown that offers both and refuses one.
                              *
                              * A draft can be deleted. Anything finalized or
                              * revised is a signed HR document, so the only
                              * offer is Archive: it leaves the active list and
                              * stays on the record. The server enforces the
                              * same rule, so this is the honest button rather
                              * than the only guard.
                              */}
                            {mayManage ? (
                              form.archivedAt ? (
                                <button
                                  type="button"
                                  onClick={() => setArchived(form, false)}
                                  disabled={working}
                                  className="inline-flex items-center gap-1 text-[12px] text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline disabled:opacity-60"
                                >
                                  {working ? (
                                    <Loader2 className="size-3.5 animate-spin" />
                                  ) : (
                                    <ArchiveRestore className="size-3.5" />
                                  )}
                                  Restore
                                </button>
                              ) : form.status === "draft" ? (
                                <button
                                  type="button"
                                  onClick={() => setConfirming({ kind: "delete", form })}
                                  disabled={working}
                                  className="inline-flex items-center gap-1 text-[12px] text-status-failed underline-offset-4 transition-colors hover:underline disabled:opacity-60"
                                >
                                  {working ? (
                                    <Loader2 className="size-3.5 animate-spin" />
                                  ) : (
                                    <Trash2 className="size-3.5" />
                                  )}
                                  Delete
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => setConfirming({ kind: "archive", form })}
                                  disabled={working}
                                  className="inline-flex items-center gap-1 text-[12px] text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline disabled:opacity-60"
                                >
                                  {working ? (
                                    <Loader2 className="size-3.5 animate-spin" />
                                  ) : (
                                    <Archive className="size-3.5" />
                                  )}
                                  Archive
                                </button>
                              )
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </ScrollTable>
          </CardContent>
        </Card>
      )}

      {/*
        * THE CONFIRMATION NAMES THE RECORD.
        *
        * "Are you sure?" is a dialog people learn to dismiss without reading,
        * so this one states the employee, the form and the status — the three
        * things somebody would check before destroying a record.
        */}
      <Dialog
        open={confirming !== null}
        onOpenChange={(open) => {
          if (!open) setConfirming(null);
        }}
      >
        {confirming ? (
          <DialogContent
            title={confirming.kind === "delete" ? "Delete this form?" : "Archive this form?"}
            description={
              confirming.kind === "delete"
                ? "This removes the form instance and its draft data."
                : "The form leaves the active list. Nothing it says changes, and it stays on the record."
            }
          >
            <dl className="space-y-3 text-[13px]">
              <div>
                <dt className="eyebrow">Employee</dt>
                <dd className="mt-0.5 text-foreground">{confirming.form.employeeName}</dd>
              </div>
              <div>
                <dt className="eyebrow">Form</dt>
                <dd className="mt-0.5 text-foreground">
                  {confirming.form.templateName}
                  {confirming.form.variantKey ? ` · ${confirming.form.variantKey}` : ""}
                </dd>
              </div>
              <div>
                <dt className="eyebrow">Status</dt>
                <dd className="mt-0.5 text-foreground capitalize">{confirming.form.status}</dd>
              </div>
            </dl>

            <DialogActions>
              <Button variant="ghost" onClick={() => setConfirming(null)}>
                Cancel
              </Button>
              {confirming.kind === "delete" ? (
                <Button
                  variant="destructive"
                  onClick={() => removeForm(confirming.form)}
                  disabled={busy === confirming.form.id}
                >
                  {busy === confirming.form.id ? <Loader2 className="animate-spin" /> : <Trash2 />}
                  Delete
                </Button>
              ) : (
                <Button
                  variant="primary"
                  onClick={() => setArchived(confirming.form, true)}
                  disabled={busy === confirming.form.id}
                >
                  {busy === confirming.form.id ? <Loader2 className="animate-spin" /> : <Archive />}
                  Archive
                </Button>
              )}
            </DialogActions>
          </DialogContent>
        ) : null}
      </Dialog>

      {/*
        * THE SWEEP — the one destructive action that does not name a row, so it
        * states the count first and says what it will NOT touch.
        */}
      <Dialog open={sweeping} onOpenChange={setSweeping}>
        <DialogContent
          title={`Delete ${demo.deletable} demo form${demo.deletable === 1 ? "" : "s"}?`}
          description={`This will permanently remove ${demo.deletable} synthetic Forms record${
            demo.deletable === 1 ? "" : "s"
          } created during Preview QA.`}
        >
          <div className="space-y-3 text-[13px] leading-relaxed text-muted-foreground">
            <p>
              Only records created by a preview session are included — Ask Sunny matches on the{" "}
              <code className="rounded-[var(--radius-xs)] bg-surface-muted px-1 py-0.5 text-[12px] text-foreground">
                demo:
              </code>{" "}
              provenance written when the form was created, not on the employee&rsquo;s name. A real
              record cannot be in this set.
            </p>
            {demo.protected > 0 ? (
              <p>
                {demo.protected} finalized demo form{demo.protected === 1 ? " is" : "s are"} kept.
                Finalized forms are archived, never deleted.
              </p>
            ) : null}
          </div>

          <DialogActions>
            <Button variant="ghost" onClick={() => setSweeping(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={sweepDemo} disabled={busy === "sweep"}>
              {busy === "sweep" ? <Loader2 className="animate-spin" /> : <Trash2 />}
              Delete {demo.deletable} test form{demo.deletable === 1 ? "" : "s"}
            </Button>
          </DialogActions>
        </DialogContent>
      </Dialog>
    </div>
  );
}
