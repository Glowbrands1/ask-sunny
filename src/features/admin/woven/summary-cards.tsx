import { Badge, StatusDot, type BadgeTone } from "@/components/ui/badge";
import { SectionHeader } from "@/components/ui/layout";
import type { OverviewCounts, RunRow } from "@/lib/employees/woven/view-types";
import { cn } from "@/lib/utils/cn";
import { when } from "./format";

/**
 * THE OVERVIEW'S ELEVEN CARDS — counts and times only.
 *
 * No card names a person, which is why the Overview needs only Manage
 * integrations. "Since last sync" is the last SUCCESSFUL run: a refused or
 * failed run saved nothing. On the very first run every employee is new, so
 * the New Hires card says "Initial load" rather than report a hiring wave.
 */

const RUN_TONE: Record<RunRow["status"], BadgeTone> = {
  succeeded: "ready",
  running: "processing",
  rejected: "attention",
  failed: "failed",
};

const RUN_LABEL: Record<RunRow["status"], string> = {
  succeeded: "Healthy",
  running: "Running",
  rejected: "Last run refused",
  failed: "Last run failed",
};

/** A successful sync older than this, with the schedule on, reads as stale. */
const STALE_AFTER_MS = 36 * 60 * 60 * 1000;

export function syncHealth(counts: OverviewCounts, scheduleOn: boolean, now = Date.now()): { label: string; tone: BadgeTone } {
  if (counts.lastAttemptStatus === null) return { label: "Never run", tone: "outline" };
  if (counts.lastAttemptStatus !== "succeeded") {
    return { label: RUN_LABEL[counts.lastAttemptStatus], tone: RUN_TONE[counts.lastAttemptStatus] };
  }
  const last = counts.lastSuccessAt ? Date.parse(counts.lastSuccessAt) : NaN;
  if (scheduleOn && Number.isFinite(last) && now - last > STALE_AFTER_MS) return { label: "Stale", tone: "attention" };
  return { label: RUN_LABEL.succeeded, tone: "ready" };
}

function Card({
  label,
  value,
  sub,
  alert,
  small,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  alert?: boolean;
  small?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex min-w-0 flex-col gap-1 rounded-[var(--radius-md)] border bg-surface px-3 py-2.5",
        alert ? "border-status-attention" : "border-border",
      )}
    >
      <dt className="text-[10px] font-semibold tracking-[0.07em] text-muted-foreground uppercase">{label}</dt>
      <dd className={cn("leading-none font-semibold tabular-nums", small ? "text-[15px]" : "text-[22px]")}>{value}</dd>
      {sub ? <dd className="text-[12px] text-muted-foreground">{sub}</dd> : null}
    </div>
  );
}

export function SummaryCards({ counts, scheduleOn }: { counts: OverviewCounts; scheduleOn: boolean }) {
  const health = syncHealth(counts, scheduleOn);
  const issues = counts.lastRunErrorCount + counts.unmappedLocations + counts.unmappedPositions + counts.employeesMissingEmail;
  const maxFetched = Math.max(1, ...counts.recentRuns.map((r) => r.employeesFetched));

  return (
    <section className="mb-8" aria-labelledby="woven-summary">
      <SectionHeader title="Sync summary" description="Counts only. “Since last sync” is the last successful sync." />
      <h2 id="woven-summary" className="sr-only">
        Sync summary
      </h2>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <Card label="Last successful sync" value={when(counts.lastSuccessAt)} sub="Central" small />
        <Card
          label="Last attempted sync"
          value={when(counts.lastAttemptAt)}
          sub={counts.lastAttemptStatus ? counts.lastAttemptStatus : "no run yet"}
          small
        />
        <Card
          label="Sync status"
          value={
            <Badge tone={health.tone} size="md">
              <StatusDot />
              {health.label}
            </Badge>
          }
          small
        />
        <Card
          label="Active employees"
          value={counts.totalActive}
          sub={counts.totalStatusUnknown > 0 ? `${counts.totalStatusUnknown} with an unrecognised status` : "from Woven"}
        />
        <Card label="Terminated employees" value={counts.totalTerminated} sub="kept for history" />
        <Card
          label="New hires since last sync"
          value={counts.newHiresSinceLast ?? "—"}
          sub={counts.initialLoadCount !== null ? `Initial load: ${counts.initialLoadCount} employees` : "hired or started in the last 30 days"}
        />
        <Card label="Terminations since last sync" value={counts.terminationsSinceLast} />
        <Card
          label="Position changes since last sync"
          value={counts.positionChangesSinceLast}
          sub={`${counts.confirmedPromotionsDemotionsSinceLast} confirmed promotion or demotion`}
        />
        <Card label="Location transfers since last sync" value={counts.transfersSinceLast} sub="primary salon moved" />
        <Card
          label="Location access changes"
          value={counts.locationAccessAddedSinceLast + counts.locationAccessRemovedSinceLast}
          sub={`${counts.locationAccessAddedSinceLast} added · ${counts.locationAccessRemovedSinceLast} removed`}
        />
        <Card
          label="Sync errors / unmapped records"
          value={issues}
          alert={issues > 0}
          sub={`${counts.lastRunErrorCount} errors · ${counts.unmappedLocations} locations · ${counts.unmappedPositions} positions · ${counts.employeesMissingEmail} missing email`}
        />
        <Card label="Changes to review" value={counts.unreviewedChanges} sub={`${counts.recordsWithIssues} records with data issues`} />
      </dl>

      {counts.recentRuns.length > 0 ? (
        <figure className="mt-4 rounded-[var(--radius-md)] border border-border bg-surface px-4 py-3">
          <figcaption className="mb-2 text-[12px] text-muted-foreground">
            Last {counts.recentRuns.length} runs, oldest first. Bar height is employees fetched.
          </figcaption>
          <ol className="flex h-14 items-end gap-1" aria-label="Recent sync runs">
            {counts.recentRuns.map((run, i) => (
              <li
                key={i}
                title={`${run.status}: ${run.employeesFetched} fetched`}
                aria-label={`${run.status}, ${run.employeesFetched} employees fetched`}
                className={cn(
                  "min-h-1 flex-1 rounded-t-sm",
                  run.status === "succeeded" ? "bg-status-ready" : run.status === "rejected" ? "bg-status-attention" : run.status === "failed" ? "bg-status-failed" : "bg-status-processing",
                )}
                style={{ height: `${Math.max(6, Math.round((run.employeesFetched / maxFetched) * 100))}%` }}
              />
            ))}
          </ol>
        </figure>
      ) : null}
    </section>
  );
}
