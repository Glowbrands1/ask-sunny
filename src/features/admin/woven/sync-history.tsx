import { Badge, StatusDot, type BadgeTone } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/feedback";
import { ScrollTable } from "@/components/ui/layout";
import type { RunRow } from "@/lib/employees/woven/view-types";
import { label, when } from "./format";

/**
 * SYNC HISTORY — one row per run, counts and codes only.
 *
 * A refused run ("rejected") read Woven but could not trust the read as the
 * whole estate, so it saved nothing; a failed run stopped on an error. Both
 * leave the directory exactly as the last good run left it. The source says
 * who started it: the schedule, an administrator, or — reserved, unused — a
 * webhook.
 */

const TONE: Record<RunRow["status"], BadgeTone> = {
  succeeded: "ready",
  running: "processing",
  rejected: "attention",
  failed: "failed",
};

const STATUS_LABEL: Record<RunRow["status"], string> = {
  succeeded: "Succeeded",
  running: "Running",
  rejected: "Refused",
  failed: "Failed",
};

const SOURCE_LABEL: Record<RunRow["sourceMode"], string> = {
  scheduled_poll: "polling · scheduled",
  manual_poll: "polling · manual",
  webhook: "webhook",
};

export function SyncHistory({ runs }: { runs: RunRow[] }) {
  if (runs.length === 0) {
    return <EmptyState title="No sync has run yet" description="Runs appear here once the migration is applied and a sync is started." />;
  }
  const num = (n: number) => <td className="px-3 py-2 text-right tabular-nums">{n}</td>;
  return (
    <section aria-label="Sync History">
      <ScrollTable>
        <table className="w-full text-left text-[12.5px]">
          <thead className="bg-surface-muted text-[11px] tracking-wide text-muted-foreground uppercase">
            <tr>
              {[
                "Started",
                "Completed",
                "Status",
                "Source",
                "Fetched",
                "Added",
                "Updated",
                "New hires",
                "Terminations",
                "Position changes",
                "Transfers",
                "Location access",
                "Errors",
                "Error summary",
              ].map((h) => (
                <th key={h} scope="col" className="px-3 py-2 font-semibold whitespace-nowrap">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {runs.map((run) => (
              <tr key={run.id} className="align-top whitespace-nowrap">
                <td className="px-3 py-2 tabular-nums">{when(run.startedAt)}</td>
                <td className="px-3 py-2 text-muted-foreground tabular-nums">{when(run.finishedAt)}</td>
                <td className="px-3 py-2">
                  <Badge tone={TONE[run.status]} size="sm">
                    <StatusDot />
                    {STATUS_LABEL[run.status]}
                  </Badge>
                </td>
                <td className="px-3 py-2 text-muted-foreground">{SOURCE_LABEL[run.sourceMode]}</td>
                {num(run.employeesFetched)}
                {num(run.employeesAdded)}
                {num(run.employeesUpdated)}
                {num(run.newHires)}
                {num(run.terminations)}
                <td className="px-3 py-2 text-right tabular-nums">
                  {run.positionChanges}
                  {run.confirmedPromotionsDemotions > 0 ? (
                    <span className="text-muted-foreground"> ({run.confirmedPromotionsDemotions} confirmed)</span>
                  ) : null}
                </td>
                {num(run.transfers)}
                {num(run.locationAccessChanges)}
                {num(run.errorCount)}
                <td className="min-w-64 px-3 py-2 whitespace-normal">
                  {run.errorCode ? (
                    <>
                      <span className="font-mono text-[11.5px]">{run.errorCode}</span>
                      {run.errorDetail ? <span className="text-muted-foreground"> — {run.errorDetail}</span> : null}
                    </>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollTable>
      <p className="mt-3 text-[12px] text-muted-foreground">
        Updated counts only employees whose details changed. A {label("rejected")} run saved nothing but its own row.
      </p>
    </section>
  );
}
