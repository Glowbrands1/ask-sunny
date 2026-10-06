import Link from "next/link";
import { ShieldAlert, ShieldCheck } from "lucide-react";

import { Badge, type BadgeTone } from "@/components/ui/badge";
import { EmptyState, Notice } from "@/components/ui/feedback";
import { ScrollTable, SectionHeader } from "@/components/ui/layout";
import { GUARD_DESCRIPTIONS, type AccessGuardCode } from "@/lib/employees/woven/access/guards";
import { allowedManagedFlags, pendingLinkReviews } from "@/lib/employees/woven/access/link-review";
import { ACCESS_ACTIONS, isMutating, type AccessAction, type PlannedRow } from "@/lib/employees/woven/access/types";
import type { AccessPreviewRow } from "@/lib/employees/woven/view-types";
import { EligibilityCheck } from "./eligibility-check";
import { label } from "./format";
import { LinkReviewPanel, type LinkReviewItem } from "./link-review-panel";
import { ManagedFlagsPanel, type ManagedFlagItem } from "./managed-flags-panel";

/**
 * ============================================================================
 * ACCESS PREVIEW — what a Woven → Ask Sunny access sync WOULD do. Read-only.
 * ============================================================================
 *
 * Every row is the access planner's answer for one Woven employee, or for an
 * Ask Sunny account no employee explains. Nothing on this tab creates an
 * account, sends an invite, disables anyone, or changes a role or salon. The
 * guards say whether a run would even be allowed to apply its changes.
 */

export interface AccessPlanView {
  rows: PlannedRow[];
  counts: Record<AccessAction, number>;
  guard: { mutationsAllowed: boolean; codes: AccessGuardCode[]; details: Record<string, number | string | null> };
  policyVersion: string;
}

export type AccessPlanState = { state: "ready"; plan: AccessPlanView } | { state: "not_applied" } | { state: "unavailable"; code: string | null };

const ACTION_LABEL: Record<AccessAction, string> = {
  NO_CHANGE: "No change",
  CREATE_USER: "Create account",
  UPDATE_PRIMARY_LOCATION: "Update primary salon",
  UPDATE_ROLE: "Update role",
  DISABLE_TERMINATED: "Disable (terminated)",
  FLAG_LINK_REVIEW: "Review link",
  FLAG_DUPLICATE_EMAIL: "Duplicate email",
  FLAG_MISSING_EMAIL: "Missing email",
  FLAG_UNMAPPED_POSITION: "Unmapped position",
  FLAG_UNMAPPED_LOCATION: "Unmapped location",
  FLAG_UNKNOWN_STATUS: "Unknown status",
  FLAG_REHIRE_REVIEW: "Rehire review",
  FLAG_NOT_WOVEN_MANAGED: "Not Woven-managed",
  FLAG_EMAIL_CHANGE_REVIEW: "Email changed",
  FLAG_MISSING_FROM_WOVEN: "Missing from Woven",
  FLAG_ROLE_REVIEW: "Role review",
  FLAG_LOCATION_REVIEW: "Location review",
  FLAG_PROTECTED_ACCOUNT: "Protected account",
  FLAG_LINKED_EMPLOYEE_NOT_FOUND: "Linked employee not found",
  FLAG_STATUS_CONFLICT: "Status conflict",
};

function actionTone(action: AccessAction): BadgeTone {
  if (action === "DISABLE_TERMINATED") return "failed";
  if (isMutating(action)) return "primary";
  if (action === "NO_CHANGE") return "outline";
  if (action === "FLAG_NOT_WOVEN_MANAGED") return "neutral";
  return "attention";
}

/** Plain sentences for the planner's reason codes. Unknown codes fall back to the code itself. */
const REASON: Record<string, string> = {
  eligible_salon_manager_without_account:
    "Active Salon Director or Assistant Salon Director with a usable email and a mapped salon, and no Ask Sunny account.",
  position_not_auto_provisioned: "This Woven position does not get an Ask Sunny account automatically in this rollout.",
  woven_position_not_confirmed: "The Woven position has no approved mapping, so no role is assigned.",
  woven_position_missing: "Woven has no position for this employee.",
  primary_location_missing: "Woven has no primary location for this employee.",
  primary_location_unmapped: "The Woven primary location is not mapped to a salon.",
  primary_location_not_a_salon: "The Woven primary location is not a salon (e.g. Corporate).",
  woven_email_missing: "Woven has no email address for this employee.",
  woven_email_invalid: "Woven's email address is not usable.",
  email_shared_by_several_woven_employees: "Several Woven employees share this email; nothing is linked or created automatically.",
  email_shared_by_several_accounts: "Several Ask Sunny accounts share this email.",
  email_matches_account_linked_to_another_employee: "This email belongs to an account already linked to a different Woven employee.",
  email_matches_account_marked_not_woven_managed: "This email belongs to an account marked not managed by Woven.",
  exact_email_match_awaiting_confirmation:
    "One existing account has this exact email. A person must confirm the link before Woven manages it.",
  terminated_in_woven: "Woven's own status for this employee is Terminated.",
  terminated_in_woven_protected_account:
    "Terminated in Woven, but this is a protected or administrative account — never disabled automatically.",
  terminated_in_woven_status_not_woven_managed: "Terminated in Woven, but this account's status is not managed by Woven.",
  access_already_revoked: "Access has already been revoked.",
  terminated_no_account: "Terminated in Woven; there is no Ask Sunny account.",
  woven_status_unknown: "Woven's status for this employee is not Active or Terminated. Fails closed: nothing changes.",
  not_in_latest_woven_read: "Not in Woven's latest read. Absence is never treated as termination; review only.",
  active_in_woven_after_revocation:
    "Access was revoked after a Woven termination and Woven now shows Active. Reactivation needs approval.",
  disabled_in_ask_sunny_active_in_woven: "Disabled in Ask Sunny while Woven shows Active. Never re-enabled automatically.",
  woven_shows_past_termination_date: "Woven shows Active but with a past termination date.",
  woven_email_differs_from_login_email:
    "Woven's email differs from the sign-in email. The sign-in email is never changed automatically.",
  protected_account_not_managed_by_woven: "Protected account: Woven never changes its role, scope or salon.",
  scope_above_salon_level_not_managed_by_woven: "This account's scope is wider than one salon. Woven never narrows it.",
  woven_position_maps_to_a_different_role: "Woven's approved position mapping is a different role.",
  woven_position_changed_within_salon_tier: "Woven's position moved between Salon Director and Assistant Salon Director.",
  role_not_woven_managed: "Woven's mapped role differs, but this account's role is not managed by Woven.",
  woven_position_outside_automatic_tier:
    "Woven's mapped role is outside Salon Director / Assistant Salon Director, so it is review only.",
  woven_primary_location_changed: "Woven's mapped primary salon differs from the account's salon.",
  location_not_woven_managed: "Woven's primary salon differs, but this account's location is not managed by Woven.",
  in_sync_with_woven: "Matches Woven.",
  linked_employee_not_in_woven_directory: "Linked to a Woven employee who is not in the directory.",
  marked_not_woven_managed: "Marked not managed by Woven. Absence from Woven means nothing for it.",
  unclassified_no_woven_match: "No Woven employee matches this account. Not managed by Woven.",
};

export const reasonText = (code: string) => REASON[code] ?? label(code);

function scopeText(account: PlannedRow["account"]): string {
  if (!account) return "—";
  return account.scopeLevel === "global" ? "Global" : `${label(account.scopeLevel)} · ${account.primaryAreaId ?? "—"}`;
}

function AccountCell({ row }: { row: PlannedRow }) {
  if (!row.account) {
    return (
      <Badge tone="outline" size="sm">
        no account
      </Badge>
    );
  }
  const via =
    row.account.via === "link"
      ? "linked"
      : row.account.via === "email_candidate"
        ? "email match, unconfirmed"
        : row.account.management === "not_woven_managed"
          ? "not Woven-managed"
          : "unlinked";
  return (
    <>
      {row.account.status} <span className="text-muted-foreground">({via})</span>
    </>
  );
}

/** The planner's pending exact-email matches, as review cards. */
export function linkReviewItems(rows: readonly PlannedRow[]): LinkReviewItem[] {
  return pendingLinkReviews(rows).map((row) => ({
    externalEmployeeId: row.externalEmployeeId!,
    employeeName: row.employeeName,
    wovenEmail: row.emailAddress,
    wovenStatus: row.wovenStatus,
    wovenPosition: row.wovenPosition,
    wovenPrimaryLocation: row.wovenPrimaryLocation,
    account: {
      appUserId: row.account!.appUserId,
      email: row.account!.email,
      role: row.account!.role,
      status: row.account!.status,
      scope: scopeText(row.account),
    },
    allowed: allowedManagedFlags(row.account!, row.account!.isProtected),
  }));
}

/** Every account linked to a Woven EmployeeID, with what Woven may manage for it. */
export function managedFlagItems(rows: readonly PlannedRow[]): ManagedFlagItem[] {
  return rows
    .filter((row) => row.account?.via === "link" && row.account.management === "woven_linked")
    .map((row) => ({
      appUserId: row.account!.appUserId,
      email: row.account!.email,
      role: row.account!.role,
      scope: scopeText(row.account),
      status: row.account!.status,
      wovenPosition: row.wovenPosition,
      isProtected: row.account!.isProtected,
      extraSalonCount: row.account!.extraSalonCount,
      managed: row.account!.managed,
      allowed: allowedManagedFlags(row.account!, row.account!.isProtected),
    }))
    .sort((a, b) => a.role.localeCompare(b.role) || a.email.localeCompare(b.email));
}

/** Keyed by the saved flags, so the panel's draft resets whenever the server's state changes. */
function ManagedFlags({ rows, disabled }: { rows: readonly PlannedRow[]; disabled: boolean }) {
  const items = managedFlagItems(rows);
  const key = items.map((i) => `${i.appUserId}:${+i.managed.status}${+i.managed.location}${+i.managed.role}`).join("|");
  return <ManagedFlagsPanel key={key} items={items} disabled={disabled} />;
}

const hrefFor = (action: string | null) => (action ? `?action=${encodeURIComponent(action)}` : "?");
const chip = "rounded-full border border-border px-2.5 py-1 aria-[current=page]:bg-surface-muted aria-[current=page]:font-semibold";

export function AccessPreview({
  planState,
  accessMode,
  actionFilter,
  loginEmailDomains,
  sampleRows,
  actionsDisabled,
}: {
  planState: AccessPlanState;
  accessMode: "off" | "shadow";
  actionFilter: string | null;
  loginEmailDomains: string[];
  sampleRows: AccessPreviewRow[] | null;
  actionsDisabled: boolean;
}) {
  return (
    <section aria-label="Access Preview" className="flex flex-col gap-6">
      <Notice tone="primary" icon={<ShieldCheck />} title="What the access sync would do — read-only">
        Nothing on this tab creates an account, sends an invite, disables anyone, or changes a role or salon. Access mode:{" "}
        <strong>{accessMode === "shadow" ? "shadow (plans are recorded, never applied)" : "off (preview only)"}</strong>.
      </Notice>

      {planState.state === "not_applied" ? (
        <EmptyState
          title="The access-sync migration has not been applied"
          description="The account-link and planned-action tables are prepared and applied only with approval. Until then the plan cannot be calculated."
        />
      ) : planState.state === "unavailable" ? (
        <EmptyState title="The access plan could not be read" description={`The database did not answer${planState.code ? ` (${planState.code})` : ""}.`} />
      ) : (
        <>
          <LinkReviewPanel items={linkReviewItems(planState.plan.rows)} disabled={actionsDisabled} />
          <ManagedFlags rows={planState.plan.rows} disabled={actionsDisabled} />
          <Plan plan={planState.plan} actionFilter={actionFilter} />
        </>
      )}

      <div className="min-w-0">
        <SectionHeader
          title="Active employee check"
          description="Would the synced directory let this person have an account under the login-email-domain rule?"
        />
        <EligibilityCheck sampleRows={sampleRows} loginEmailDomains={loginEmailDomains} disabled={actionsDisabled} />
      </div>
    </section>
  );
}

function Plan({ plan, actionFilter }: { plan: AccessPlanView; actionFilter: string | null }) {
  const filter: AccessAction | "changes" | null = (ACCESS_ACTIONS as readonly string[]).includes(actionFilter ?? "")
    ? (actionFilter as AccessAction)
    : actionFilter === "changes"
      ? "changes"
      : null;
  const matches = (r: PlannedRow) => (filter === null ? true : filter === "changes" ? r.actions.some(isMutating) : r.actions.includes(filter));
  const rows = plan.rows.filter(matches);
  const changes = plan.rows.filter((r) => r.actions.some(isMutating)).length;

  return (
    <>
      {plan.guard.mutationsAllowed ? (
        <Notice tone="neutral" icon={<ShieldCheck />} title="Safety guards: clear">
          A run on today&apos;s data would be allowed to apply its changes — once applying is approved and built. Policy {plan.policyVersion}.
        </Notice>
      ) : (
        <Notice tone="attention" icon={<ShieldAlert />} title="Safety guards: a run on today's data would apply nothing">
          <ul className="list-disc pl-4">
            {plan.guard.codes.map((code) => (
              <li key={code}>{GUARD_DESCRIPTIONS[code] ?? label(code)}</li>
            ))}
          </ul>
        </Notice>
      )}

      <nav aria-label="Filter by proposed action" className="flex flex-wrap gap-2 text-[12px]">
        <Link href={hrefFor(null)} aria-current={filter === null ? "page" : undefined} className={chip}>
          All · {plan.rows.length}
        </Link>
        <Link href={hrefFor("changes")} aria-current={filter === "changes" ? "page" : undefined} className={chip}>
          Would change access · {changes}
        </Link>
        {ACCESS_ACTIONS.filter((a) => plan.counts[a] > 0).map((action) => (
          <Link key={action} href={hrefFor(action)} aria-current={filter === action ? "page" : undefined} className={chip}>
            {ACTION_LABEL[action]} · {plan.counts[action]}
          </Link>
        ))}
      </nav>

      {rows.length === 0 ? (
        <EmptyState title="Nothing matches this filter" description="Choose another action above." />
      ) : (
        <ScrollTable>
          <table className="w-full text-left text-[12.5px]">
            <thead className="bg-surface-muted text-[11px] tracking-wide text-muted-foreground uppercase">
              <tr>
                {[
                  "Employee",
                  "Woven ID",
                  "Email",
                  "Woven status",
                  "Woven position",
                  "Woven primary location",
                  "Ask Sunny account",
                  "Current role",
                  "Current scope / salon",
                  "Proposed role",
                  "Proposed salon",
                  "Proposed action",
                  "Reason",
                ].map((h) => (
                  <th key={h} scope="col" className="px-3 py-2 font-semibold whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((row) => (
                <tr key={row.key} className="align-top" data-actions={row.actions.join(" ")}>
                  <td className="px-3 py-2 font-semibold whitespace-nowrap text-foreground">{row.employeeName}</td>
                  <td className="px-3 py-2 font-mono text-[11px] text-muted-foreground">{row.externalEmployeeId ?? "—"}</td>
                  <td className="px-3 py-2">{row.emailAddress ?? "—"}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{row.wovenStatus ?? "—"}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{row.wovenPosition ?? "—"}</td>
                  <td className="px-3 py-2">
                    {row.wovenPrimaryLocation ?? "—"}
                    {row.wovenAdditionalLocations.length > 0 ? (
                      <span className="block text-[11px] text-muted-foreground">
                        + {row.wovenAdditionalLocations.join(", ")} (not used for access)
                      </span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <AccountCell row={row} />
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">{row.account ? label(row.account.role) : "—"}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{scopeText(row.account)}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{label(row.proposedRole)}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{row.proposedPrimaryAreaId ?? "—"}</td>
                  <td className="px-3 py-2">
                    <div className="flex min-w-36 flex-col items-start gap-1">
                      {row.actions.map((action) => (
                        <Badge key={action} tone={actionTone(action)} size="sm">
                          {ACTION_LABEL[action]}
                        </Badge>
                      ))}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <ul className="min-w-64 list-disc pl-4 whitespace-normal">
                      {row.reasons.map((code) => (
                        <li key={code}>{reasonText(code)}</li>
                      ))}
                    </ul>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollTable>
      )}
    </>
  );
}
