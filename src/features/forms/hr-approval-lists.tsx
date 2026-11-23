import Link from "next/link";
import { ChevronRight, ExternalLink } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { formatBusinessTime } from "@/lib/business-date";

/**
 * HR APPROVAL ON FORM MONITORING (FORMS_HR_APPROVAL_ENABLED). Server-rendered
 * from rows the page read for this reader only:
 *
 *   HrApprovalTabs  "All forms" and "Pending HR approval (N)", shown to HR only
 *   HrQueueList     HR's tab: waiting forms oldest first (overdue marked), then
 *                   the ones they sent back or rejected
 *   MyFormsWithHr   the manager's own forms that HR has not approved yet
 */

export interface HrQueueListRow {
  id: string;
  line: string;
  createdByName: string;
  state: "pending" | "changes_requested" | "rejected" | "approved";
  requestedAt: string | null;
  waiting: string;
  overdue: boolean;
}

export interface MyHrFormListRow {
  id: string;
  line: string;
  label: string;
  state: "pending" | "changes_requested" | "rejected" | "approved";
}

const STATE_WORDS: Record<HrQueueListRow["state"], string> = {
  pending: "Waiting for you",
  changes_requested: "Sent back for changes",
  rejected: "Rejected",
  approved: "Approved",
};

function hrHref(id: string): string {
  return `/forms/hr-approval/${id}`;
}

export function HrApprovalTabs({ active, pending, overdue }: { active: "all" | "hr"; pending: number; overdue: number }) {
  const tab = (selected: boolean) =>
    `inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs ${
      selected ? "border-foreground bg-foreground text-background" : "border-border text-muted-foreground hover:text-foreground"
    }`;
  return (
    <nav aria-label="Form Monitoring views" className="mb-4 flex flex-wrap gap-2">
      <Link href="/forms/monitoring" className={tab(active === "all")} aria-current={active === "all" ? "page" : undefined}>
        All forms
      </Link>
      <Link href="/forms/monitoring?view=hr" className={tab(active === "hr")} aria-current={active === "hr" ? "page" : undefined}>
        Pending HR approval ({pending})
        {overdue > 0 ? <span className="font-semibold text-status-attention">· {overdue} overdue</span> : null}
      </Link>
    </nav>
  );
}

/**
 * ONE SUB-TAB PER APP on HR's tab (owner, 23 Nov 2026: "1 tab for sunny 1 tab for bubbles"). The sibling's name is the
 * one its own server answered with, never spelled here; while it cannot be read the tab says "Other app".
 */
export function HrAppTabs({
  active,
  thisApp,
  sibling,
}: {
  active: "this" | "sibling";
  thisApp: { name: string; pending: number };
  sibling: { name: string | null; pending: number | null };
}) {
  const tab = (selected: boolean) =>
    `inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border-b-2 px-2 pb-1.5 text-sm ${
      selected ? "border-foreground font-semibold text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
    }`;
  return (
    <nav aria-label="HR approval by app" className="mb-3 flex flex-wrap gap-4 border-b border-border" data-testid="hr-app-tabs">
      <Link href="/forms/monitoring?view=hr" className={tab(active === "this")} aria-current={active === "this" ? "page" : undefined}>
        {thisApp.name} ({thisApp.pending})
      </Link>
      <Link
        href="/forms/monitoring?view=hr&app=sibling"
        className={tab(active === "sibling")}
        aria-current={active === "sibling" ? "page" : undefined}
      >
        {sibling.name ?? "Other app"}
        {sibling.pending === null ? "" : ` (${sibling.pending})`}
      </Link>
    </nav>
  );
}

export interface SiblingHrQueueListRow {
  line: string;
  from: string;
  state: HrQueueListRow["state"];
  requestedAt: string | null;
  waiting: string;
  overdue: boolean;
  href: string;
}

/**
 * THE SIBLING APP'S FORMS WAITING FOR THIS APPROVER. Each opens the form's review page IN THE SIBLING APP, where its own
 * sign-in applies and where Approve / Send back / Reject happen: nothing is decided from here.
 */
export function SiblingHrQueueList({
  queue,
}: {
  queue: { status: "error" } | { status: "ok"; app: string; approver: boolean; forms: SiblingHrQueueListRow[] };
}) {
  if (queue.status === "error") {
    return (
      <p className="text-sm text-muted-foreground" data-testid="sibling-hr-queue-error">
        The other app&apos;s forms could not be read just now. Try again in a minute, or open the other app from the app switcher.
      </p>
    );
  }
  if (!queue.approver) {
    return (
      <p className="text-sm text-muted-foreground" data-testid="sibling-hr-queue-not-approver">
        Your account is not set up as the HR approver in {queue.app}, so it has no forms waiting for you there.
      </p>
    );
  }
  if (queue.forms.length === 0) {
    return <p className="text-sm text-muted-foreground">No forms are waiting for your approval in {queue.app}.</p>;
  }
  return (
    <div data-testid="sibling-hr-queue">
      <p className="mb-2 text-xs text-subtle-foreground">
        Each form opens in {queue.app}, where you approve, send back or reject it. Sign in there if it asks.
      </p>
      <ul className="divide-y divide-border rounded-[var(--radius-md)] border border-border">
        {queue.forms.map((row) => (
          <li key={row.href}>
            <a href={row.href} className="flex items-center gap-3 px-3 py-2.5 hover:bg-surface-muted">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">{row.line}</p>
                <p className="text-xs text-subtle-foreground">
                  From {row.from}
                  {formatBusinessTime(row.requestedAt) ? ` · sent ${formatBusinessTime(row.requestedAt)}` : ""}
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
                <Badge tone={row.state === "pending" ? "accent" : "outline"} size="sm">
                  {STATE_WORDS[row.state]}
                </Badge>
                {row.state === "pending" ? <span className="text-xs text-subtle-foreground">{row.waiting}</span> : null}
                {row.overdue ? (
                  <Badge tone="attention" size="sm">
                    Overdue
                  </Badge>
                ) : null}
              </div>
              <ExternalLink className="size-4 shrink-0 text-subtle-foreground" aria-hidden />
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function HrQueueList({ rows }: { rows: HrQueueListRow[] }) {
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">No forms are waiting for your approval.</p>;
  }
  return (
    <ul className="divide-y divide-border rounded-[var(--radius-md)] border border-border" data-testid="hr-queue">
      {rows.map((row) => (
        <li key={row.id}>
          <Link href={hrHref(row.id)} className="flex items-center gap-3 px-3 py-2.5 hover:bg-surface-muted">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-foreground">{row.line}</p>
              <p className="text-xs text-subtle-foreground">
                From {row.createdByName}
                {formatBusinessTime(row.requestedAt) ? ` · sent ${formatBusinessTime(row.requestedAt)}` : ""}
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
              <Badge tone={row.state === "pending" ? "accent" : "outline"} size="sm">
                {STATE_WORDS[row.state]}
              </Badge>
              {row.state === "pending" ? <span className="text-xs text-subtle-foreground">{row.waiting}</span> : null}
              {row.overdue ? (
                <Badge tone="attention" size="sm">
                  Overdue
                </Badge>
              ) : null}
            </div>
            <ChevronRight className="size-4 shrink-0 text-subtle-foreground" aria-hidden />
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function MyFormsWithHr({ rows }: { rows: MyHrFormListRow[] }) {
  if (rows.length === 0) return null;
  return (
    <section aria-label="Your forms with HR" className="mb-4" data-testid="my-forms-with-hr">
      <h2 className="mb-2 text-sm font-semibold text-foreground">Your forms with HR</h2>
      <ul className="divide-y divide-border rounded-[var(--radius-md)] border border-border">
        {rows.map((row) => (
          <li key={row.id}>
            <Link href={hrHref(row.id)} className="flex items-center gap-3 px-3 py-2 hover:bg-surface-muted">
              <p className="min-w-0 flex-1 truncate text-sm text-foreground">{row.line}</p>
              <Badge tone={row.state === "pending" ? "accent" : "outline"} size="sm">
                {row.label}
              </Badge>
              <ChevronRight className="size-4 shrink-0 text-subtle-foreground" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** HR's Overview card: how many forms wait for them and how many are overdue, linking to their tab. */
export function HrOverviewCard({ pending, overdue }: { pending: number; overdue: number }) {
  return (
    <Link
      href="/forms/monitoring?view=hr"
      data-testid="hr-overview-card"
      className="mb-5 flex items-center gap-3 rounded-[var(--radius-md)] border border-border bg-surface px-4 py-3 hover:bg-surface-muted"
    >
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-foreground">
          {pending === 0
            ? "No forms are waiting for your approval"
            : `${pending} form${pending === 1 ? " is" : "s are"} waiting for your approval`}
        </p>
        <p className="text-xs text-subtle-foreground">Pending HR approval, in Form Monitoring</p>
      </div>
      {overdue > 0 ? (
        <Badge tone="attention" size="sm">
          {overdue} overdue
        </Badge>
      ) : null}
      <ChevronRight className="size-4 shrink-0 text-subtle-foreground" aria-hidden />
    </Link>
  );
}
