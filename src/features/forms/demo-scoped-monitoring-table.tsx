"use client";

import { attentionSummary, type FollowUpFacts, type FollowUpFilter } from "@/lib/forms/follow-up";
import { demoSalonScope } from "@/lib/demo/demo-scope";
import { useSession } from "@/lib/session/session-context";

import { MonitoringTable, type MonitoredForm, type MonitoringView } from "./monitoring-table";

/**
 * FORM MONITORING IN A DEMO DEPLOYMENT, narrowed to the previewed role.
 *
 * The server sends every seeded form; this keeps the ones the role being
 * previewed would read (its salon, or its district's salons) and recounts the
 * follow-up banner from the same narrowed set. The live screen is drawn
 * unchanged. See `lib/demo/demo-scope.ts`.
 */
export function DemoScopedMonitoringTable({
  rows,
  outstanding,
  view,
  followUp,
  today,
  notice,
}: {
  rows: { form: MonitoredForm; locationId: string | null }[];
  outstanding: (FollowUpFacts & { locationId: string | null })[];
  view: MonitoringView;
  followUp: FollowUpFilter;
  today: string;
  notice: string | null;
}) {
  const { user } = useSession();
  const salons = demoSalonScope(user.scope);
  const inScope = (locationId: string | null) =>
    salons === null || (locationId !== null && salons.includes(locationId));

  return (
    <MonitoringTable
      forms={rows.filter((row) => inScope(row.locationId)).map((row) => row.form)}
      notice={notice}
      view={view}
      followUp={followUp}
      today={today}
      attention={attentionSummary(
        outstanding.filter((row) => inScope(row.locationId)),
        today,
      )}
      demo={{ deletable: 0, protected: 0 }}
    />
  );
}
