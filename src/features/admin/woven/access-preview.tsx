import { ShieldCheck } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { EmptyState, Notice } from "@/components/ui/feedback";
import { ScrollTable, SectionHeader } from "@/components/ui/layout";
import type { AccessPreviewRow } from "@/lib/employees/woven/view-types";
import { EligibilityCheck } from "./eligibility-check";
import { label } from "./format";

/**
 * ACCESS PREVIEW — what first-login provisioning, automatic deactivation and
 * role or salon-scope updates WOULD do with today's data. Read-only.
 *
 * Each later phase needs its own approval. This tab exists so its logic can
 * be checked against real people before any of it is switched on.
 */

function Would({ row }: { row: AccessPreviewRow }) {
  const items: string[] = [];
  if (row.wouldDeactivate) items.push("Phase 3: disable the login (Woven: terminated)");
  if (row.roleDiffers) items.push(`Phase 4: change role to ${label(row.effectiveRole)}`);
  if (row.primarySalonDiffers) items.push(`Phase 5: move salon scope to ${row.mappedPrimarySalonNumber}`);
  if (row.wouldProvision) items.push("Phase 2: create an account at first sign-in");
  return (
    <ul className="min-w-56 list-disc pl-4">
      {items.map((i) => (
        <li key={i}>{i}</li>
      ))}
    </ul>
  );
}

function Difference({ row }: { row: AccessPreviewRow }) {
  const parts: string[] = [];
  if (row.wouldDeactivate) parts.push(`Terminated in Woven; Ask Sunny login is ${row.appUserStatus}`);
  if (row.roleDiffers) parts.push(`Resolves to ${label(row.effectiveRole)} (${row.roleSource === "override" ? "protected override" : "Woven position"}); Ask Sunny role is ${label(row.appUserRole)}`);
  if (row.primarySalonDiffers) parts.push(`Woven primary salon is ${row.mappedPrimarySalonNumber}; Ask Sunny salon scope is ${row.appUserScopePrimaryAreaId}`);
  if (row.wouldProvision) parts.push("Active in Woven with a confirmed role and salon; no Ask Sunny login");
  return <span className="block min-w-64 whitespace-normal">{parts.join(". ")}</span>;
}

export function AccessPreview({
  rows,
  drift,
  loginEmailDomains,
  sampleRows,
  actionsDisabled,
}: {
  rows: AccessPreviewRow[];
  drift: AccessPreviewRow[];
  loginEmailDomains: string[];
  sampleRows: AccessPreviewRow[] | null;
  actionsDisabled: boolean;
}) {
  const counts = {
    provision: rows.filter((r) => r.wouldProvision).length,
    deactivate: rows.filter((r) => r.wouldDeactivate).length,
    role: rows.filter((r) => r.roleDiffers).length,
    salon: rows.filter((r) => r.primarySalonDiffers).length,
  };

  return (
    <section aria-label="Access Preview" className="flex flex-col gap-6">
      <Notice tone="primary" icon={<ShieldCheck />} title="What later phases would do — read-only">
        Nothing on this tab creates, disables or changes an Ask Sunny login, role, scope level or salon access. Each of those is a
        later phase that needs its own approval.
      </Notice>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="min-w-0">
          <SectionHeader title="Active employee check" description="Would the synced directory let this person have an account?" />
          <EligibilityCheck sampleRows={sampleRows} loginEmailDomains={loginEmailDomains} disabled={actionsDisabled} />
        </div>
        <div className="min-w-0">
          <SectionHeader title="If the later phases were on today" />
          <dl className="grid grid-cols-2 gap-3">
            {[
              ["Accounts created at first sign-in (phase 2)", counts.provision],
              ["Logins disabled (phase 3)", counts.deactivate],
              ["Roles changed (phase 4)", counts.role],
              ["Salon scopes moved (phase 5)", counts.salon],
            ].map(([k, v]) => (
              <div key={String(k)} className="rounded-[var(--radius-md)] border border-border bg-surface px-3 py-2.5">
                <dt className="text-[11px] text-muted-foreground">{k}</dt>
                <dd className="mt-1 text-[20px] leading-none font-semibold tabular-nums">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>

      <div>
        <SectionHeader title="Where Ask Sunny and Woven disagree" description="Existing logins compared with Woven by email, case-insensitively. Nothing is changed." />
        {drift.length === 0 ? (
          <EmptyState title="Nothing to act on" description="Every matched login agrees with Woven, or no employee is ready for an account." />
        ) : (
          <ScrollTable>
            <table className="w-full text-left text-[12.5px]">
              <thead className="bg-surface-muted text-[11px] tracking-wide text-muted-foreground uppercase">
                <tr>
                  {["Employee", "Email", "Ask Sunny login", "Difference", "A later phase would"].map((h) => (
                    <th key={h} scope="col" className="px-3 py-2 font-semibold whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {drift.map((row) => (
                  <tr key={row.employeeId} className="align-top">
                    <td className="px-3 py-2 whitespace-nowrap">
                      <span className="font-semibold text-foreground">{row.employeeName}</span>
                      <br />
                      <span className="font-mono text-[11px] text-muted-foreground">{row.externalEmployeeId}</span>
                    </td>
                    <td className="px-3 py-2">{row.emailAddress ?? "—"}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {row.hasLogin ? (
                        <>
                          {label(row.appUserRole)} · {row.appUserStatus}
                        </>
                      ) : (
                        <Badge tone="outline" size="sm">
                          no login
                        </Badge>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <Difference row={row} />
                    </td>
                    <td className="px-3 py-2">
                      <Would row={row} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollTable>
        )}
      </div>
    </section>
  );
}
