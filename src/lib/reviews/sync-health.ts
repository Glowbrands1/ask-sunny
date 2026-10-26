import { envFlag } from "@/lib/config/chat-quality-flags";

import { formatReviewsInstant } from "./display-time";

/**
 * WHETHER THE GOOGLE REVIEWS PAGE IS SHOWING CURRENT FIGURES.
 *
 * Behind GOOGLE_REVIEWS_STALE_BANNER_ENABLED (default off), the same flag
 * name as the sibling app's. QA, 25 Oct 2026: a review sync that stops
 * leaves /reviews showing old figures as if they were today's, with only
 * the small "Last sync" line to say otherwise. With the flag on, a sync
 * older than two days gets this notice above the page, and an administrator
 * is pointed to the integration screen. Drawing it on the page is a UI edit
 * that waits on the owner's flags-off-parity approval.
 *
 * LAST SYNC is the page's own `snapshot.lastSyncAt`: the newest accepted sync
 * request (`google_review_sync_runs.started_at`). No new read.
 *
 * Client-safe: no database client and no `server-only` import.
 */

/** Off unless explicitly on. */
export function staleBannerEnabled(): boolean {
  return envFlag("GOOGLE_REVIEWS_STALE_BANNER_ENABLED");
}

/** Older than this, the figures are called out as not current. */
export const STALE_AFTER_MS = 2 * 24 * 60 * 60 * 1000;

export const INTEGRATION_PATH = "/admin/integrations/google-reviews";

export interface SyncNotice {
  readonly title: string;
  readonly body: string;
  /** The integration screen, for somebody who can act on it. */
  readonly href: string | null;
}

/** The notice, or null when a sync was accepted within the last two days. */
export function syncNotice(input: {
  readonly lastSyncAt: string | null;
  readonly now: Date;
  readonly canManage: boolean;
}): SyncNotice | null {
  const shown = formatReviewsInstant(input.lastSyncAt);
  const at = input.lastSyncAt ? new Date(input.lastSyncAt) : null;
  if (shown && at && input.now.getTime() - at.getTime() <= STALE_AFTER_MS) return null;

  const since = shown
    ? `Google reviews have not synced since ${shown} (Central time). The figures below are as of then.`
    : "No Google review sync has been recorded yet.";
  const next = input.canManage
    ? " Check the Google Reviews integration screen."
    : " An administrator needs to check the Google review sync.";
  return { title: "Google reviews are not up to date", body: `${since}${next}`, href: input.canManage ? INTEGRATION_PATH : null };
}
