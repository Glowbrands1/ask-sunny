"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, Save } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/feedback";
import { SectionHeader } from "@/components/ui/layout";
import type { CodeCount, SyncDiagnostics, TriState } from "@/lib/employees/woven/diagnostics";
import type { SavedCounts, SyncOutcome, SyncSummary } from "@/lib/employees/woven/sync";
import { STORED_SYNC_REQUEST } from "@/lib/employees/woven/sync-request";

/**
 * "Run employee sync" — kept apart from "Test Woven connection" on purpose.
 *
 * DISABLED WHILE `WOVEN_SYNC_ENABLED` IS OFF, whatever the validation switch
 * says; the server refuses it too (`runWovenEmployeeSync` returns "disabled"
 * before it reaches Woven or the database), so the button being off is not
 * the only lock.
 *
 * "RUN EMPLOYEE SYNC" IS A DRY RUN, ALWAYS. It sends `{ "dryRun": true }` and
 * nothing else.
 *
 * "SAVE TO DIRECTORY" IS THE ONLY WAY THIS PAGE SAVES, and it takes three
 * deliberate steps:
 *   1. it is shown only when the sync is available, WOVEN_SYNC_WRITES_ENABLED
 *      is on, and a dry run has succeeded during this page visit;
 *   2. clicking it sends NOTHING — it opens a confirmation panel with that dry
 *      run's counts, the six tables it writes and what it never touches;
 *   3. only "Confirm and save" sends `{ "dryRun": false, "confirmSave": true }`,
 *      once: a ref blocks a second submission before React re-renders, and the
 *      database's run lock refuses a concurrent run anyway.
 * The server refuses `dryRun: false` without `confirmSave: true`, and refuses
 * any save while WOVEN_SYNC_WRITES_ENABLED is off — independently of this page.
 *
 * AFTER A SAVE THE PAGE RE-READS THE SERVER. The Overview cards, the setup
 * steps and the status are rendered on the server when the page loads; a save
 * made from this panel changes what they should say, so any save the server
 * answered as a run (succeeded, failed, refused, or busy with another run)
 * calls `router.refresh()`. A dry run writes nothing, so it refreshes nothing.
 *
 * THE RESULT IS COUNTS ONLY. The dry-run summary carries no name, e-mail, id
 * or other per-person detail, by construction (`SyncSummary`), so nothing here
 * can display one.
 */

type SyncResponse = SyncOutcome | { status: "confirmation_required"; reason: string };

function outcomeText(outcome: SyncResponse): string {
  switch (outcome.status) {
    case "succeeded":
      return outcome.summary.dryRun
        ? `Dry run finished. ${outcome.summary.employeesReceived} employees read; nothing was saved.`
        : `Saved to the directory. ${outcome.summary.employeesReceived} employees read.`;
    case "confirmation_required":
      return outcome.reason;
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

const codes = (list: CodeCount[]) =>
  list.map((c) => `${c.code ?? "none"}${c.label ? ` ${c.label}` : ""} (${c.count})`).join(", ") || "none";
const tri = (t: TriState) => `${t.yes} yes · ${t.no} no · ${t.unset} unset`;

/**
 * Why the counts above are what they are — counts and field combinations only.
 * The one list is of LOCATIONS outside Woven's /locations catalog (salons, not
 * people). No employee name, email, id or date is in `SyncDiagnostics`.
 */
export function DryRunDiagnostics({ diagnostics }: { diagnostics: SyncDiagnostics }) {
  const c = diagnostics.statusTerminationConflict;
  const l = diagnostics.locationsOutsideCatalog;
  const d = diagnostics.detailSelection;
  const n = diagnostics.detailsNotFound;
  const p = diagnostics.missingPositionId;
  /* Absent from a response built before these were added. */
  const r = diagnostics.statusReads as SyncDiagnostics["statusReads"] | undefined;
  const t = diagnostics.pastTerminationDate as SyncDiagnostics["pastTerminationDate"] | undefined;
  return (
    <dl
      data-testid="woven-dry-run-diagnostics"
      className="mt-3 grid gap-x-6 gap-y-2 rounded-[var(--radius-md)] border border-border bg-surface px-4 py-3 text-[13px] sm:grid-cols-[max-content_1fr]"
    >
      <dt className="col-span-full font-medium">Diagnostics (counts only)</dt>
      <Row label="Status/termination conflicts">
        {c.total} Active with a past TerminationDate · Status {codes(c.statusCodes)} · TerminationType {codes(c.terminationTypeCodes)} ·{" "}
        {c.withLastDayWorked} with a last day worked · {c.hiredOrStartedAfterTermination} hired/started after the termination (rehire
        shape) · {c.hiredOrStartedOnOrBeforeTermination} hired/started on or before it · {c.noHireOrStartDate} no hire/start date ·
        termination {c.terminationDateAge.within30Days} ≤30 days ago, {c.terminationDateAge.within365Days} ≤1 year,{" "}
        {c.terminationDateAge.over365Days} older, {c.terminationDateAge.before2000} before 2000 · {c.inCurrentList} in the default
        list, {c.onlyInWithTerminatedList} only with terminated · Woven login allowed {tri(c.wovenLoginAllowed)}
      </Row>
      <Row label="Locations outside /locations">
        {l.outside.length === 0
          ? "none"
          : l.outside.map((o) => `${o.name ?? o.wovenLocationId} (${o.asPrimary} as primary, ${o.inDetails} in details)`).join("; ")}{" "}
        · {l.referencedLocations} referenced · {l.referencedInCatalog} of {l.catalogSize} catalog locations referenced
      </Row>
      <Row label="Detail-read selection">
        {d.candidates} needed a read ({d.candidatesMultipleLocationFlagTrue} multiple-location flag on,{" "}
        {d.candidatesMultipleLocationFlagUnset} flag unset, {d.candidatesAllLocationAccess} all-location,{" "}
        {d.candidatesAllLocationWithoutMultipleFlag} all-location without the multiple flag) · budget {d.budget} · {d.attempted}{" "}
        attempted · {d.fetched} read · {d.notFound} not found · {d.noUsableLocationList} without a usable list
        {d.interrupted ? " · interrupted" : ""}
      </Row>
      <Row label="Details not found">
        {n.total} · {n.inCurrentList} in the default list · {n.withPrimaryLocation} with a primary location ({n.primaryInCatalog} in
        /locations) · {n.primaryRetained} primary retained · {n.markedAffiliationsNotVerified} marked not verified · login id{" "}
        {n.withEmployeeLoginId} · email {n.withEmail} · PositionID {n.withPositionId} · Status {codes(n.statusCodes)} · multiple-location{" "}
        {tri(n.hasMultipleLocationAccess)} · all-location {tri(n.hasAllLocationAccess)} · Woven login allowed {tri(n.wovenLoginAllowed)}{" "}
        · vendor {n.vendorEmployees}
      </Row>
      {r && t ? (
        <>
      <Row label="Status by read">
        default {r.currentRecords} · with terminated {r.withTerminatedRecords} ({r.withTerminatedAdded} added) · terminated-status filter{" "}
        {r.terminatedStatusRead === "read"
          ? `(Status ${r.terminatedStatusCodes.join(", ")}): ${r.terminatedStatusRecords} returned, ${r.terminatedStatusMatched} also in the lists, ${r.terminatedStatusMatchedOnFile ?? 0} on file and gone from the lists (received as terminated), ${r.terminatedStatusNotInListReads} only there (not imported)`
          : r.terminatedStatusRead === "failed"
            ? "failed"
            : "not run (no Terminated status in /lists/enums)"}{" "}
        · {r.detailsWithStatus} details reads carried a Status · {r.statusDiffersBetweenReads} employees whose Status differed between
        reads
      </Row>
      <Row label="Past TerminationDate">
        {t.total} · {t.activeInEveryRead} Active in every read · {t.terminatedInWoven} Terminated in Woven ·{" "}
        {t.statusDiffersBetweenReads} reads disagree · {t.listedByTerminatedFilterButActive} returned by the terminated filter but
        Active · {t.detailsStatusRead} with a details Status
      </Row>
        </>
      ) : null}
      <Row label="Missing PositionID">
        {p.total} · {p.withPositionName} with a PositionName · Status {codes(p.statusCodes)}
      </Row>
    </dl>
  );
}

/** The tables a stored sync writes, and what it never touches. Stated, not derived: the tests pin both. */
export const SAVE_WRITES_TO = [
  "employee_sync_runs",
  "employee_access_directory",
  "employee_location_affiliations",
  "employee_directory_changes",
  "woven_location_map",
  "woven_position_map",
] as const;
export const SAVE_NEVER_MODIFIES = [
  "app_users",
  "authentication",
  "login access",
  "roles",
  "scope",
  "salon permissions/access",
] as const;

/** Save outcomes that mean a run row exists or changed, so the server-rendered Overview is out of date. */
const REFRESH_AFTER: ReadonlySet<string> = new Set(["succeeded", "failed", "rejected", "busy"]);

/** The confirmation step: the latest dry run's counts, and exactly what saving does and does not do. */
function SaveConfirmation({
  dryRun,
  saving,
  onCancel,
  onConfirm,
}: {
  dryRun: SyncSummary;
  saving: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => cancelRef.current?.focus(), []);
  const issues = dryRun.issueCounts;
  return (
    <section
      role="alertdialog"
      aria-labelledby="woven-save-title"
      aria-describedby="woven-save-description"
      data-testid="woven-save-confirmation"
      className="mb-4 rounded-[var(--radius-md)] border border-border bg-surface px-4 py-3 text-[13px]"
    >
      <h3 id="woven-save-title" className="mb-1 text-[14px] font-medium">
        Save this sync to the employee directory?
      </h3>
      <p id="woven-save-description" className="mb-3 text-muted-foreground">
        This runs the sync again and saves it. The counts below are from the dry run you just ran.
      </p>
      <dl className="mb-3 grid gap-x-6 gap-y-1 sm:grid-cols-[max-content_1fr]">
        <Row label="Employees received">{dryRun.employeesReceived}</Row>
        <Row label="Active / terminated / unknown">
          {dryRun.employeesActive} / {dryRun.employeesTerminated} / {dryRun.employeesStatusUnknown}
        </Row>
        <Row label="Status/termination conflicts">{issues.status_termination_conflict ?? 0}</Row>
        <Row label="Unmapped locations">{dryRun.unmappedLocations}</Row>
        <Row label="Unmapped positions">{dryRun.unmappedPositions}</Row>
        <Row label="Details not found">{issues.details_not_found ?? 0}</Row>
      </dl>
      <div className="mb-3 grid gap-3 sm:grid-cols-2">
        <div>
          <p className="font-medium">Will write only to:</p>
          <ul className="list-disc pl-5" data-testid="woven-save-writes">
            {SAVE_WRITES_TO.map((t) => (
              <li key={t} className="font-mono text-[12px]">
                {t}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className="font-medium">Will NOT modify:</p>
          <ul className="list-disc pl-5" data-testid="woven-save-never">
            {SAVE_NEVER_MODIFIES.map((t) => (
              <li key={t}>{t === "app_users" ? <span className="font-mono text-[12px]">{t}</span> : t}</li>
            ))}
          </ul>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button ref={cancelRef} variant="secondary" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button onClick={onConfirm} disabled={saving}>
          <Save />
          {saving ? "Saving…" : "Confirm and save to directory"}
        </Button>
      </div>
    </section>
  );
}

function SavedResult({ saved }: { saved: SavedCounts }) {
  return (
    <dl
      data-testid="woven-saved-result"
      className="mb-4 grid gap-x-6 gap-y-2 rounded-[var(--radius-md)] border border-border bg-surface px-4 py-3 text-[13px] sm:grid-cols-[max-content_1fr]"
    >
      <dt className="col-span-full font-medium">Saved to the directory</dt>
      <Row label="Directory records">
        {saved.directoryCreated} created · {saved.directoryUpdated} updated · {saved.directoryUnchanged} unchanged
      </Row>
      <Row label="Change events recorded">{saved.changesRecorded}</Row>
      <Row label="Affiliations saved">{saved.affiliationsSaved}</Row>
      <Row label="Locations queued">{saved.locationsQueued}</Row>
      <Row label="Positions queued">{saved.positionsQueued}</Row>
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
  /** WOVEN_SYNC_WRITES_ENABLED. Shows "Save to directory" after a dry run; the server enforces it on its own. */
  writesEnabled?: boolean;
}) {
  const [running, setRunning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [summary, setSummary] = useState<SyncSummary | null>(null);
  /** The last dry run that SUCCEEDED in this page visit. Saving is offered only after one. */
  const [lastDryRun, setLastDryRun] = useState<SyncSummary | null>(null);
  const [saved, setSaved] = useState<SavedCounts | null>(null);
  /* Set synchronously, so a double click cannot send two saves before React re-renders. */
  const saveInFlight = useRef(false);
  const router = useRouter();

  async function post(body: object): Promise<{ response: Response | null; outcome: SyncResponse | null }> {
    try {
      const response = await fetch("/api/admin/employees/woven/sync", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const outcome = (await response.json().catch(() => null)) as SyncResponse | null;
      return { response, outcome: outcome && "status" in outcome ? outcome : null };
    } catch {
      return { response: null, outcome: null };
    }
  }

  async function run() {
    setRunning(true);
    setResult(null);
    setSummary(null);
    setSaved(null);
    setConfirming(false);
    setLastDryRun(null);
    const { response, outcome } = await post({ dryRun: true });
    if (outcome) {
      setResult(outcomeText(outcome));
      if (outcome.status === "succeeded" || outcome.status === "rejected") setSummary(outcome.summary);
      if (outcome.status === "succeeded" && outcome.summary.dryRun) setLastDryRun(outcome.summary);
    } else {
      setResult(response ? `The sync could not run (HTTP ${response.status}).` : "The sync could not reach Ask Sunny's server.");
    }
    setRunning(false);
  }

  async function save() {
    if (saveInFlight.current) return;
    saveInFlight.current = true;
    setSaving(true);
    const { response, outcome } = await post(STORED_SYNC_REQUEST);
    if (outcome) {
      setResult(outcomeText(outcome));
      if (outcome.status === "succeeded" && !outcome.summary.dryRun) {
        setSummary(null);
        setSaved(outcome.summary.saved ?? null);
        /* Another save needs a fresh dry run first. */
        setLastDryRun(null);
      }
    } else {
      setResult(response ? `The save could not run (HTTP ${response.status}).` : "The save could not reach Ask Sunny's server.");
    }
    setConfirming(false);
    setSaving(false);
    saveInFlight.current = false;
    if (outcome && REFRESH_AFTER.has(outcome.status)) router.refresh();
  }

  const canOfferSave = available && writesEnabled && lastDryRun !== null;

  return (
    <section className="mb-8" data-testid="woven-sync-panel">
      <SectionHeader
        title="Run employee sync"
        description="Reads every employee from Woven and compares with the directory. Separate from the connection test above, and off until WOVEN_SYNC_ENABLED is on. Run employee sync is always a dry run: it saves nothing, and the result is counts only. Save to directory appears after a successful dry run when stored syncs are on, and asks you to confirm before it saves."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={run} disabled={!available || running || saving}>
              <RefreshCw />
              {running ? "Running…" : "Run employee sync"}
            </Button>
            {canOfferSave ? (
              <Button onClick={() => setConfirming(true)} disabled={running || saving || confirming}>
                <Save />
                Save to directory
              </Button>
            ) : null}
          </div>
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
      {confirming && lastDryRun ? (
        <SaveConfirmation dryRun={lastDryRun} saving={saving} onCancel={() => setConfirming(false)} onConfirm={save} />
      ) : null}
      {result ? (
        <Notice tone="neutral" className="mb-4">
          {result}
        </Notice>
      ) : null}
      {saved ? <SavedResult saved={saved} /> : null}
      {summary ? <DryRunSummary summary={summary} /> : null}
      {summary?.diagnostics ? <DryRunDiagnostics diagnostics={summary.diagnostics} /> : null}
    </section>
  );
}
