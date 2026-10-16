import type { OverviewRun } from "@/lib/reviews/gbp/overview-types";
import type { RunSummary } from "@/lib/reviews/gbp/summary";

/** Short, human wording for the outcome codes the integration stores. Never a secret. */
export const ERROR_COPY: Record<string, string> = {
  auth_revoked: "Google access was revoked. Reconnect Google.",
  auth_expired: "Google access expired. Reconnect Google.",
  quota_exceeded: "Google's quota was reached. It will retry on the next run.",
  not_configured: "Google isn't fully configured in this deployment.",
};

export function describeError(code: string | null | undefined): string {
  if (!code) return "";
  return ERROR_COPY[code] ?? `Google returned: ${code}`;
}

export function formatWhen(iso: string | null | undefined): string {
  if (!iso) return "never";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "unknown";
  return d.toLocaleString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

export function runLabel(run: OverviewRun): string {
  const kind = run.mode === "live" ? "Sync" : "Dry run";
  return `${kind}${run.scope === "backfill" ? " (backfill)" : ""}`;
}

export function summaryTotals(summary: RunSummary) {
  let fetched = 0, missing = 0, needsReview = 0, failed = 0;
  for (const l of summary.locations) {
    fetched += l.fetched;
    missing += l.newReviews + l.deferredNewReviews;
    needsReview += l.needsReview;
    if (l.status === "failed") failed += 1;
  }
  return { listings: summary.locations.length, fetched, missing, needsReview, failed };
}
