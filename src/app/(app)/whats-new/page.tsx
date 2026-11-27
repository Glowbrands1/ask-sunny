import type { Metadata } from "next";

import { WHATS_NEW, whatsNewFor } from "@/config/whats-new";
import { WhatsNewScreen } from "@/features/whats-new/whats-new-screen";
import { ACTIVE_BRAND } from "@/lib/brand";
import { requirePagePermission } from "@/lib/auth/page";
import { activePermissionMatrix, hasPermission } from "@/lib/permissions";

export const metadata: Metadata = {
  title: "What's New",
};

export const dynamic = "force-dynamic";

/**
 * What's New (Pau, 26 Nov 2026): recent updates and new features, newest first, from `src/config/whats-new.ts`.
 * Gated as the Overview is (the managers' home, `view_overview`); an entry about a page is shown only to a role that may open that page, the same
 * entries `read_whats_new` gives the AI (CLAUDE.md §5).
 */
export default async function WhatsNewPage() {
  // The saved permission matrix is loaded by the gate, so the entries below are filtered on it.
  const identity = await requirePagePermission("view_overview");
  const matrix = activePermissionMatrix();
  const releases = whatsNewFor(identity?.role ?? null, (role, permission) => hasPermission(matrix, role, permission), WHATS_NEW);
  return <WhatsNewScreen releases={releases} appName={ACTIVE_BRAND.productName} />;
}
