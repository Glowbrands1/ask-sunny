"use client";

import { useState, type ReactNode } from "react";
import { RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/feedback";
import { SectionHeader } from "@/components/ui/layout";
import type { SyncOutcome, SyncSummary } from "@/lib/employees/woven/sync";

/**
 * "Run employee sync" — kept apart from "Test Woven connection" on purpose.
 *
 * DISABLED WHILE `WOVEN_SYNC_ENABLED` IS OFF, whatever the validation switch
 * says; the server refuses it too (`runWovenEmployeeSync` returns "disabled"
 * before it reaches Woven or the database), so the button being off is not
 * the only lock.
 *
 * A DRY RUN, ALWAYS. This button sends `{ "dryRun": true }` and nothing else;
 * no control on this page can ask for a save. Saving also needs
 * `WOVEN_SYNC_WRITES_ENABLED`, which the server enforces on its own — a
 * hand-written request for a save is refused while it is off.
 *
 * THE RESULT IS COUNTS ONLY. The dry-run summary carries no name, e-mail, id
 * or other per-person detail, by construction (`SyncSummary`), so nothing here
 * can display one.
 */

function outcomeText(outcome: SyncOutcome): string {
  switch (outcome.status) {
    case "succeeded":
      return `Dry run finished. ${outcome.summary.employeesReceived} employees read; nothing was saved.`;
    case "disabled":
    case "writes_disabled":
      return outcome.reason;
    case "not_configured":
      return `Not configured: ${outcome.missing.join(", ")}.`;
    case "busy":
      return "Another sync is running.";
    case "rejected":
    case "failed":
      return `${outcome.status === "rejected" ? "Refused" : "Failed"} (${outcome.code}). ${outcome.reason}`;
  }
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="break-words tabular-nums">{children}</dd>
    </>
  );
}

const listCounts = (counts: Record<string, number>) =>
  Object.entries(counts)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `${k.replaceAll("_", " ")} (${n})`)
    .join(", ") || "none";

/** The dry-run summary, in the order the pre-sync review reads it. Counts only. */
export function DryRunSummary({ summary }: { summary: SyncSummary }) {
  const c = summary.changesByKind;
  const n = summary.newEmployeesByClassification;
  const f = summary.fieldCoverage;
  return (
    <dl
      data-testid="woven-dry-run-summary"
      className="grid gap-x-6 gap-y-2 rounded-[var(--radius-md)] border border-border bg-surface px-4 py-3 text-[13px] sm:grid-cols-[max-content_1fr]"
    >
      <Row label="Mode">{summary.dryRun ? "Dry run — nothing was saved" : "Stored sync"}</Row>
      <Row label="Employees received">{summary.employeesReceived}</Row>
      <Row label="Status">
        {summary.employeesActive} active · {summary.employeesTerminated} terminated · {summary.employeesStatusUnknown} unknown
        {summary.statusSource === "none" ? " · status values could not be resolved" : ""}
      </Row>
      <Row label="New employees">
        {c.new_employee} · {n.initial_load} initial load · {n.new_hire} new hires · {n.newly_visible} newly visible
      </Row>
      <Row label="Terminations and rehires">
        {c.terminated} terminated · {c.reactivated} reactivated
      </Row>
      <Row label="Position changes">{c.position_changed}</Row>
      <Row label="Primary-location changes">{c.primary_location_changed}</Row>
      <Row label="Location access">
        {c.location_access_added} added · {c.location_access_removed} removed
      </Row>
      <Row label="Other changes">
        {c.email_changed} email changes · {c.missing_from_source} missing from Woven · {summary.employeesMissing} on file but not
        received
      </Row>
      <Row label="Employee-detail reads">
        {summary.detailsFetched} read · {summary.issueCounts.details_not_found ?? 0} not found · {summary.detailsSkipped} skipped
      </Row>
      <Row label="Unmapped">
        {summary.unmappedLocations} locations · {summary.unmappedPositions} positions
      </Row>
      <Row label="Records rejected">{summary.recordsRejected}</Row>
      <Row label="Issue counts">{listCounts(summary.issueCounts)}</Row>
      <Row label="Field coverage">
        EmailAddress {f.emailAddress} · PositionID {f.positionId} · PositionName {f.positionName} · PrimaryLocationID{" "}
        {f.primaryLocationId} · HireDate {f.hireDate} · TerminationDate (terminated) {f.terminationDateAmongTerminated} · multiple-location
        flag {f.multipleLocationFlag} (of {summary.employeesReceived})
      </Row>
      <Row label="Requests">
        {summary.requestsMade} requests · {summary.pagesFetched} pages
      </Row>
    </dl>
  );
}

export function SyncPanel({
  available,
  reason,
  writesEnabled = false,
}: {
  available: boolean;
  reason: string | null;
  /** WOVEN_SYNC_WRITES_ENABLED, for the note only. This panel never asks for a save either way. */
  writesEnabled?: boolean;
}) {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [summary, setSummary] = useState<SyncSummary | null>(null);

  async function run() {
    setRunning(true);
    setResult(null);
    setSummary(null);
    try {
      const response = await fetch("/api/admin/employees/woven/sync", {
        method: "POST",
        headers: { "content-type": "application/json" },
        /* The only body this page ever sends. */
        body: JSON.stringify({ dryRun: true }),
      });
      const body = (await response.json().catch(() => null)) as (SyncOutcome & { error?: string }) | null;
      if (body && "status" in body) {
        setResult(outcomeText(body));
        if (body.status === "succeeded" || body.status === "rejected") setSummary(body.summary);
      } else {
        setResult(`The sync could not run (HTTP ${response.status}).`);
      }
    } catch {
      setResult("The sync could not reach Ask Sunny's server.");
    } finally {
      setRunning(false);
    }
  }

  return (
    <section className="mb-8" data-testid="woven-sync-panel">
      <SectionHeader
        title="Run employee sync"
        description="Reads every employee from Woven and compares with the directory. Separate from the connection test above, and off until WOVEN_SYNC_ENABLED is on. This button always runs a dry run: it saves nothing, and the result is counts only."
        actions={
          <Button variant="secondary" onClick={run} disabled={!available || running}>
            <RefreshCw />
            {running ? "Running…" : "Run employee sync"}
          </Button>
        }
      />
      {!available && reason ? (
        <Notice tone="neutral" className="mb-4">
          {reason}
        </Notice>
      ) : null}
      {available && !writesEnabled ? (
        <p className="mb-4 text-[13px] text-muted-foreground">
          Stored syncs are off (WOVEN_SYNC_WRITES_ENABLED is not on). Only dry runs can run on this deployment.
        </p>
      ) : null}
      {result ? (
        <Notice tone="neutral" className="mb-4">
          {result}
        </Notice>
      ) : null}
      {summary ? <DryRunSummary summary={summary} /> : null}
    </section>
  );
}
