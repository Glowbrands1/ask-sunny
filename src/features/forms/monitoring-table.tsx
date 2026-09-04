"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Archive,
  ArchiveRestore,
  CalendarPlus,
  CheckCircle2,
  Download,
  Loader2,
  MoreHorizontal,
  RotateCcw,
  Trash2,
} from "lucide-react";

import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Notice } from "@/components/ui/feedback";
import { ScrollTable } from "@/components/ui/layout";
import { Input, Label, Select } from "@/components/ui/field";
import {
  Dialog,
  DialogActions,
  DialogContent,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/overlays";
import {
  attentionSentence,
  followUpCounts,
  followUpState,
  FOLLOW_UP_FILTERS,
  FOLLOW_UP_LABEL,
  matchesFollowUpFilter,
  relativeBusinessDay,
  type AttentionSummary,
  type FollowUpFilter,
  type FollowUpState,
} from "@/lib/forms/follow-up";
import { useSession } from "@/lib/session/session-context";
import { cn } from "@/lib/utils/cn";
import { formatDate } from "@/lib/utils/date";
import { downloadFormPdf, formsFetch } from "./forms-fetch";

/**
 * FORM MONITORING — the system of record, and the screen follow-ups are worked
 * from.
 *
 * It answers two different questions about every filed form, and keeping them
 * apart is the whole design:
 *
 *   WHAT THE DOCUMENT IS — draft, finalized, revised, and which template
 *   version it was filled from. Immutable history; nothing on this screen can
 *   change it.
 *
 *   WHETHER THE CONVERSATION HAPPENED — scheduled, overdue, done. Operational,
 *   editable, and the reason a manager opens the page. This is the STATUS
 *   column, because it is the status somebody acts on; the document's own
 *   lifecycle rides along under the form name where it can be checked without
 *   competing for attention.
 *
 * Every count here is derived from the rows on screen and today's business
 * date. Nothing is stored as "overdue" and nothing is hard-coded.
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
  followedUpAt: string | null;
  followedUpBy: string | null;
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
const ACTIONS_COLUMN = "​";

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

/**
 * ONE COLOUR PER MEANING.
 *
 * `followupStrong` is the approved follow-up pink at full strength, and it
 * appears here and nowhere else: OVERDUE is the only state that is somebody's
 * problem right now. Everything else is deliberately quieter —
 *
 *   open         neutral: scheduled and not yet due is not a warning
 *   followed_up  the success token: the conversation happened
 *   drafted      neutral: unfinished, not late
 *   untracked    outline: no commitment exists to be late for
 *   archived     neutral: off the active list entirely
 *
 * Making every follow-up state pink would leave the manager no way to see which
 * one needs them.
 */
const FOLLOW_UP_TONE: Record<FollowUpState, BadgeTone> = {
  overdue: "followupStrong",
  open: "neutral",
  followed_up: "ready",
  drafted: "neutral",
  untracked: "outline",
  archived: "neutral",
};

/** The document's own lifecycle, shown small under the form name. */
const DOC_STATUS_LABEL = {
  draft: "draft",
  finalized: "finalized",
  revised: "revised",
} as const;

export function MonitoringTable({
  forms,
  notice,
  view,
  followUp,
  today,
  attention,
  demo,
}: {
  forms: MonitoredForm[];
  notice: string | null;
  /** Which shelf the server read. Changing it re-reads on the server. */
  view: MonitoringView;
  /** Which follow-up state the pills are filtered to. */
  followUp: FollowUpFilter;
  /**
   * Today's BUSINESS date, resolved on the server.
   *
   * Passed in rather than computed here so the server-rendered markup and the
   * browser cannot disagree about what day it is — a hydration mismatch that
   * would show a different badge for a split second, and would silently drift
   * for anyone whose machine clock is wrong.
   */
  today: string;
  /**
   * Outstanding work across the ACTIVE set, counted on the server by the same
   * query the Overview uses. Not derived from the rows on screen: those are
   * shelf- and pill-filtered, so a banner taken from them would say "nothing
   * needs attention" the moment somebody looked at Followed up.
   */
  attention: AttentionSummary;
  /**
   * What a demo sweep would do, counted on the SERVER across every shelf — not
   * from the rows on screen, which are filtered and would give a wrong number
   * the moment somebody switches to Archived.
   */
  demo: { deletable: number; protected: number };
}) {
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
  /** The row whose empty date box is being filled in, after Start tracking. */
  const [starting, setStarting] = React.useState<string | null>(null);
  const { role, user, can, demoMode } = useSession();
  const router = useRouter();

  /*
   * WHO SEES THE MANAGEMENT CONTROLS, and why preview is deliberately open.
   *
   * The server is the authority: every call below goes through
   * `authorizeForms`. In preview that guard resolves the permission and carries
   * it rather than refusing, because the role arrives in a header the browser
   * sets and nobody has configured roles yet — so a client-side refusal here
   * would only hide the button from the owner doing the QA while changing
   * nothing about what a request can do.
   *
   * The two are separate permissions on purpose: saying a conversation happened
   * is ordinary forms work, where deleting a filed record is not.
   */
  const mayManage = demoMode || can("manage_form_records");
  const mayTrack = demoMode || can("create_coaching_form");

  const call = React.useCallback(
    <T,>(url: string, init: RequestInit = {}) => formsFetch<T>(url, role, user.name, init),
    [role, user.name],
  );

  /** Every write ends the same way: say what happened, then re-read the server. */
  async function run(id: string, note: string, work: () => Promise<unknown>) {
    setBusy(id);
    setProblem(null);
    setMessage(null);
    try {
      await work();
      setMessage(note);
      router.refresh();
    } catch (error) {
      setProblem((error as Error).message);
    } finally {
      setBusy(null);
      setConfirming(null);
      setStarting(null);
    }
  }

  /**
   * DELETE, and why the dialog is not optional.
   *
   * This destroys a draft and everything filled into it. The confirmation names
   * the employee, the form and the status, because "are you sure?" on its own
   * is a dialog people learn to dismiss without reading.
   */
  const removeForm = (form: MonitoredForm) =>
    run(form.id, `Deleted the ${form.templateShortName} for ${form.employeeName}.`, () =>
      // `formsFetch` turns the route's 409 — "this form is finalized, archive
      // it instead" — into a thrown message shown as the problem notice, so
      // the refusal reaches the person in the server's own words.
      call(`/api/forms/instances/${form.id}`, { method: "DELETE" }),
    );

  /** Archive, or put back. Never touches status or a single filled value. */
  const setArchived = (form: MonitoredForm, archived: boolean) =>
    run(
      form.id,
      archived
        ? `Archived the ${form.templateShortName} for ${form.employeeName}. The record is kept.`
        : `Restored the ${form.templateShortName} for ${form.employeeName}.`,
      () =>
        call(`/api/forms/instances/${form.id}`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ archived }),
        }),
    );

  /** Set or move the follow-up date. Persists immediately — there is no Save. */
  const changeFollowUpDate = (form: MonitoredForm, date: string) =>
    run(
      form.id,
      form.followUpDate
        ? `Follow-up for ${form.employeeName} moved to ${formatDate(date)}.`
        : `Now tracking a follow-up for ${form.employeeName} on ${formatDate(date)}.`,
      () =>
        call(`/api/forms/instances/${form.id}/follow-up`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ date }),
        }),
    );

  const markFollowedUp = (form: MonitoredForm) =>
    run(form.id, `Marked the follow-up for ${form.employeeName} as done.`, () =>
      call(`/api/forms/instances/${form.id}/follow-up`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "complete" }),
      }),
    );

  const reopenFollowUp = (form: MonitoredForm) =>
    run(form.id, `Reopened the follow-up for ${form.employeeName}.`, () =>
      call(`/api/forms/instances/${form.id}/follow-up`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "reopen" }),
      }),
    );

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

  /*
   * The pills count the SHELF, before the pill filter is applied — otherwise
   * selecting Overdue would leave every other pill reading zero. The form-type
   * dropdown does narrow them, because it narrows what the screen is about.
   */
  const inScope = forms.filter(
    (form) => templateName === "all" || form.templateName === templateName,
  );
  const counts = followUpCounts(inScope, today);
  const shown = inScope.filter((form) => matchesFollowUpFilter(form, followUp, today));

  /**
   * Both filters live in the URL, so a view survives a refresh and can be
   * linked to — which is what lets the Overview send somebody straight to
   * `?followup=overdue`.
   */
  function go(next: { view?: MonitoringView; followUp?: FollowUpFilter }) {
    const params = new URLSearchParams();
    const nextView = next.view ?? view;
    const nextFollowUp = next.followUp ?? followUp;
    if (nextView !== "active") params.set("view", nextView);
    if (nextFollowUp !== "all") params.set("followup", nextFollowUp);
    const query = params.toString();
    router.push(query ? `/forms/monitoring?${query}` : "/forms/monitoring");
  }

  const banner = attentionSentence(attention);

  const emptyMessage =
    followUp !== "all"
      ? `Nothing is ${FOLLOW_UP_LABEL[followUp as FollowUpState].toLowerCase()}.`
      : view === "archived"
        ? "Nothing is archived."
        : null;

  return (
    <div className="space-y-4">
      {notice ? <Notice tone="attention">{notice}</Notice> : null}
      {problem ? <Notice tone="attention">{problem}</Notice> : null}
      {message ? <Notice tone="accent">{message}</Notice> : null}

      {/*
        * THE LIVE BANNER. It appears only when something is actually
        * outstanding: a permanent bar saying "0 follow-ups need attention"
        * teaches a reader to skip the place where the real number appears. The
        * number is queried, never written down.
        */}
      {banner ? (
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-[var(--radius-md)] border border-[color-mix(in_srgb,var(--followup-attention)_30%,transparent)] bg-followup-attention-soft px-4 py-3">
          <p className="text-[13px] font-medium text-followup-attention-soft-foreground">
            {banner}
          </p>
          <p className="text-[12px] text-muted-foreground">
            Have the conversation, then mark the item followed up — or move its date.
          </p>
        </div>
      ) : null}

      <Card>
        <CardContent className="space-y-3 p-4">
          {/*
            * SEGMENTED PILLS, not a sixth dropdown. Five states with live
            * counts are the question the manager came to ask, and a pill row
            * answers it and filters by it in one control.
            */}
          <div
            className="flex flex-wrap items-center gap-1.5"
            role="group"
            aria-label="Follow-up state"
          >
            {FOLLOW_UP_FILTERS.map((filter) => {
              const selected = followUp === filter;
              const label = filter === "all" ? "All" : FOLLOW_UP_LABEL[filter as FollowUpState];
              return (
                <button
                  key={filter}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => go({ followUp: filter })}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[13px] transition-colors",
                    selected
                      ? "border-selected bg-selected text-selected-foreground"
                      : "border-border-strong bg-surface text-muted-foreground hover:bg-hover-surface hover:text-foreground",
                  )}
                >
                  {label}
                  <span
                    className={cn(
                      "tabular-nums",
                      selected
                        ? "text-selected-foreground/70"
                        : // The overdue count is the one number on this row that
                          // means somebody has to act, so it carries the colour
                          // — and only while there is something to act on.
                          filter === "overdue" && counts.overdue > 0
                          ? "font-semibold text-followup-attention"
                          : "text-subtle-foreground",
                    )}
                  >
                    {filter === "all" ? counts.all : counts[filter]}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <Label htmlFor="monitoring-view" className="text-muted-foreground">
                Show
              </Label>
              <Select
                id="monitoring-view"
                value={view}
                onChange={(event) => go({ view: event.target.value as MonitoringView })}
                className="h-9 w-36"
              >
                <option value="active">Active forms</option>
                <option value="archived">Archived</option>
                <option value="all">All</option>
              </Select>
            </div>
            <Select
              aria-label="Form"
              value={templateName}
              onChange={(event) => setTemplateName(event.target.value)}
              className="h-9 w-52"
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
          </div>
        </CardContent>
      </Card>

      {shown.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-[13px] text-muted-foreground">
            {emptyMessage ?? (
              <>
                No forms yet. Create one from{" "}
                <span className="text-foreground">Create a Form</span>.
              </>
            )}
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
                      "Employee",
                      "Form",
                      "Location",
                      "Created by",
                      "Form date",
                      "Follow-up",
                      "Status",
                      ACTIONS_COLUMN,
                    ].map((heading) => (
                      <th
                        key={heading}
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
                    const state = followUpState(form, today);
                    const working = busy === form.id;
                    const outstanding = state === "open" || state === "overdue";
                    const tracking = starting === form.id;

                    return (
                      <tr key={form.id} className="border-b border-border last:border-0">
                        <td className="px-2.5 py-2 whitespace-nowrap text-foreground">
                          {form.employeeName}
                        </td>

                        {/*
                          * The FORM cell carries the audit facts that used to
                          * have columns of their own — template version, the
                          * document's lifecycle, and whether Ask Sunny drafted
                          * it. Three columns for three rarely-read facts made
                          * the table unreadable and pushed the actions off
                          * screen; one small line keeps them all reachable.
                          */}
                        <td className="px-2.5 py-2 whitespace-nowrap">
                          <span className="block text-foreground">
                            {form.templateShortName}
                            {form.variantKey ? (
                              <span className="ml-1.5 text-[11px] text-subtle-foreground">
                                {form.variantKey}
                              </span>
                            ) : null}
                          </span>
                          <span className="block text-[11px] text-subtle-foreground">
                            v{form.templateVersion} · {DOC_STATUS_LABEL[form.status]}
                            {form.source === "ask_sunny" ? " · Ask Sunny" : ""}
                          </span>
                        </td>

                        <td
                          className="max-w-[130px] truncate px-2.5 py-2 text-muted-foreground"
                          title={form.locationName ?? undefined}
                        >
                          {form.locationName ?? "—"}
                        </td>
                        <td
                          className="max-w-[120px] truncate px-2.5 py-2 text-muted-foreground"
                          title={form.createdBy}
                        >
                          {form.createdBy}
                        </td>
                        <td className="px-2.5 py-2 whitespace-nowrap tabular-nums">
                          {formatDate(form.formDate)}
                        </td>

                        {/*
                          * THE FOLLOW-UP CELL IS THE WORKFLOW.
                          *
                          * Changing the date is the common act, so it is a date
                          * box in the row rather than something behind a dialog
                          * — it persists on change, and there is no Save to
                          * forget. Deleting and archiving live in the menu,
                          * where a destructive action belongs.
                          */}
                        <td className="px-2.5 py-2 whitespace-nowrap">
                          {form.followedUpAt ? (
                            <span className="text-muted-foreground">
                              <span className="tabular-nums">
                                {formatDate(form.followUpDate)}
                              </span>
                              <span className="block text-[11px] text-subtle-foreground">
                                done {formatDate(form.followedUpAt)}
                              </span>
                            </span>
                          ) : form.followUpDate || tracking ? (
                            <span className="flex items-center gap-1.5">
                              <Input
                                type="date"
                                aria-label={`Follow-up date for ${form.employeeName}`}
                                defaultValue={form.followUpDate ?? ""}
                                disabled={working || !mayTrack || Boolean(form.archivedAt)}
                                autoFocus={tracking}
                                onChange={(event) => {
                                  const value = event.target.value;
                                  // An empty box means the picker was cleared,
                                  // which is not a request to un-track: there is
                                  // no such action, and treating it as one would
                                  // silently discard a commitment.
                                  if (value && value !== form.followUpDate) {
                                    void changeFollowUpDate(form, value);
                                  }
                                }}
                                className="h-8 w-[148px] px-2 text-[13px] tabular-nums"
                              />
                              {form.followUpDate ? (
                                <span className="text-[11px] text-subtle-foreground">
                                  {relativeBusinessDay(form.followUpDate, today)}
                                </span>
                              ) : null}
                            </span>
                          ) : mayTrack && !form.archivedAt ? (
                            <button
                              type="button"
                              onClick={() => setStarting(form.id)}
                              className="inline-flex items-center gap-1.5 rounded-[var(--radius-xs)] border border-dashed border-border-strong px-2 py-1 text-[12px] text-muted-foreground transition-colors hover:bg-hover-surface hover:text-foreground"
                            >
                              <CalendarPlus className="size-3.5" />
                              Start tracking
                            </button>
                          ) : (
                            <span className="text-subtle-foreground">—</span>
                          )}
                        </td>

                        <td className="px-2.5 py-2">
                          <div className="flex items-center gap-2">
                            <Badge tone={FOLLOW_UP_TONE[state]} size="sm">
                              {FOLLOW_UP_LABEL[state]}
                            </Badge>
                            {outstanding && mayTrack ? (
                              <button
                                type="button"
                                onClick={() => markFollowedUp(form)}
                                disabled={working}
                                className="inline-flex items-center gap-1 text-[12px] whitespace-nowrap text-muted-foreground underline-offset-4 transition-colors hover:text-status-ready hover:underline disabled:opacity-60"
                              >
                                {working ? (
                                  <Loader2 className="size-3.5 animate-spin" />
                                ) : (
                                  <CheckCircle2 className="size-3.5" />
                                )}
                                Mark followed up
                              </button>
                            ) : null}
                          </div>
                        </td>

                        <td className={cn(PINNED, "px-2.5 py-2")}>
                          <div className="flex items-center justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => download(form.id)}
                              disabled={downloading === form.id}
                              className="inline-flex items-center gap-1 text-[12px] text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline disabled:opacity-60"
                            >
                              <Download className="size-3.5" />
                              {downloading === form.id ? "Preparing…" : "PDF"}
                            </button>

                            {mayManage || mayTrack ? (
                              <DropdownMenu>
                                <DropdownMenuTrigger
                                  aria-label={`More actions for ${form.employeeName}`}
                                  className="inline-flex size-7 items-center justify-center rounded-[var(--radius-xs)] text-muted-foreground transition-colors hover:bg-hover-surface hover:text-foreground"
                                >
                                  <MoreHorizontal className="size-4" />
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  {form.followedUpAt && mayTrack ? (
                                    <DropdownMenuItem onSelect={() => reopenFollowUp(form)}>
                                      <RotateCcw />
                                      Reopen follow-up
                                    </DropdownMenuItem>
                                  ) : null}
                                  {mayManage ? (
                                    <>
                                      {form.followedUpAt && mayTrack ? (
                                        <DropdownMenuSeparator />
                                      ) : null}
                                      {/*
                                        * DELETE OR ARCHIVE — decided by status,
                                        * not offered as a pair one of which the
                                        * server will refuse. A draft can be
                                        * deleted; anything finalized or revised
                                        * is a signed HR document, so the only
                                        * offer is Archive.
                                        */}
                                      {form.archivedAt ? (
                                        <DropdownMenuItem
                                          onSelect={() => setArchived(form, false)}
                                        >
                                          <ArchiveRestore />
                                          Restore
                                        </DropdownMenuItem>
                                      ) : form.status === "draft" ? (
                                        <DropdownMenuItem
                                          tone="danger"
                                          onSelect={() =>
                                            setConfirming({ kind: "delete", form })
                                          }
                                        >
                                          <Trash2 />
                                          Delete
                                        </DropdownMenuItem>
                                      ) : (
                                        <DropdownMenuItem
                                          onSelect={() =>
                                            setConfirming({ kind: "archive", form })
                                          }
                                        >
                                          <Archive />
                                          Archive
                                        </DropdownMenuItem>
                                      )}
                                    </>
                                  ) : null}
                                </DropdownMenuContent>
                              </DropdownMenu>
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
