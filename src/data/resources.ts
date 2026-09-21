import type { ExternalResource } from "@/types";

/**
 * ============================================================================
 * MANAGER RESOURCES THAT ACTUALLY EXIST — PRODUCTION CONFIGURATION
 * ============================================================================
 *
 * Everything in this list is a link a manager can click on a real deployment
 * and arrive somewhere. It is currently EMPTY, and that is a statement rather
 * than an oversight.
 *
 * WHAT THIS REPLACES. `data/demo/resources.ts` holds ten tiles and eight of
 * them point at `https://example.com/...` — Power BI, Woven, Company
 * Policies, Training Portal, HR Resources, IT Support, Scheduling. They
 * rendered on every live deployment to every Salon Director, Assistant,
 * District and Regional Manager, with no label saying they were placeholders
 * and an `availability: "available"` badge saying the opposite. A manager who
 * clicked "Company Policies" got example.com.
 *
 * ============================================================================
 * WHY L10 MEETINGS IS NOT HERE EITHER
 * ============================================================================
 *
 * It was the one candidate. `data/demo/resources.ts` says of itself that "L10
 * Meetings points at the live app; the remaining URLs are placeholders", and
 * the app shell's quick-actions row has linked to the same URL from every
 * page for as long as that row has existed.
 *
 * But the URL is `https://preview--leadership-sync-tool.lovable.app/` — a
 * Lovable PREVIEW host, not a production domain — and it could not be
 * reached to confirm it resolves. The standard for this file is a link
 * somebody has verified, and an in-repo comment plus an existing link
 * elsewhere in the app is not verification. An honest empty page beats a tile
 * that might 404, so it waits here until the real production URL is
 * confirmed.
 *
 * ADDING IT BACK IS ONE ENTRY. Confirm the destination, paste it in, done —
 * and `production-demo-data.test.ts` will hold the new URL to the same bar
 * (no `example.com`, no `localhost`, no preview host).
 *
 * The demo catalogue is unchanged and still renders in demo mode.
 */
export const PRODUCTION_RESOURCES: ExternalResource[] = [];
