import type { ReactNode } from "react";

import { AppShell } from "@/components/shell/app-shell";
import { businessToday } from "@/lib/business-date";
import { pageShowsAppSwitcher, pageShowsLeadershipHub } from "@/lib/auth/app-switcher";
import { pageCan, pageIdentity } from "@/lib/auth/page";
import { readFollowUpQueue } from "@/lib/forms/follow-up-queue";
import { pageFormsAccess } from "@/lib/forms/page-scope";
import { l10TabsForLayout } from "@/features/l10/data.server";
import { bellFor } from "@/lib/notifications/bell-for";
import type { BellData } from "@/lib/notifications/types";
import { hrQueueSummary } from "@/lib/forms/hr-approval";
import { siblingHrWaiting } from "@/lib/partner/sibling-hr-waiting";

/**
 * COUNTS, NOT HUES — the rail's overdue badge.
 *
 * The direction adds a count to Form Monitoring in the left rail: the same
 * overdue follow-ups the band and the Overview report, in a third place, in the
 * same coral. Its point is that the rail should carry INFORMATION rather than a
 * colour per section.
 *
 * IT IS READ HERE, ON THE SERVER, THROUGH THE SAME MODULE the Overview and Form
 * Monitoring use. That is the whole reason it is in the layout and not in the
 * sidebar component: a browser-side recount is exactly how the Overview and
 * Form Monitoring came to state different numbers about the same salon, and a
 * badge that disagrees with the page it links to is worse than no badge.
 *
 * The rail is on every screen, so this is one Forms read per navigation. The
 * whole `(app)` group is already server-rendered per request, so it adds a
 * query rather than a rendering mode — and a failure returns zero and hides the
 * badge instead of taking down every page in the group.
 */
async function overdueCount(): Promise<number> {
  try {
    const today = businessToday();
    // The badge counts only forms this reader may open; see `withoutUnreadable`.
    const readsExit = await pageCan("create_exit_form");
    const access = await pageFormsAccess(await pageIdentity());
    // THE ONE QUEUE (QA, 24 Nov 2026): the same forms, uncapped, the Overview, the banner and the pills count.
    return (await readFollowUpQueue(access, { readsExit, today })).attention.overdue;
  } catch {
    return 0;
  }
}

/** THE BELL: everyone signed in has one (`bellFor`); an HR approver's also counts the forms still waiting for them. */
async function bellForLayout(): Promise<BellData | null> {
  const identity = await pageIdentity();
  return bellFor(
    identity,
    () => waitingForHr(identity),
    () => waitingForHrInSibling(identity),
  );
}

/**
 * THE SIBLING APP'S WAITING FORMS (Pau, 24 Nov 2026: "fix", of the bar counting only this app's forms): for a verified
 * HR approver here, the count on the sibling's approvals tab, asked with their verified email exactly as that tab asks
 * (`siblingHrWaiting`, kept a minute). Null for anybody else, or when the sibling is off or does not answer.
 */
async function waitingForHrInSibling(identity: Awaited<ReturnType<typeof pageIdentity>>): Promise<{ app: string; count: number } | null> {
  if (!identity?.verified || !identity.email) return null;
  try {
    const { actor } = await pageFormsAccess(identity);
    if (actor.hrApprover !== true || !actor.verified) return null;
    return await siblingHrWaiting(identity.email);
  } catch {
    return null;
  }
}

/**
 * HR APPROVAL, STILL WAITING (Pau, 24 Nov 2026: "can u please not remove the notification in the bar on the left side
 * if there are still pending inside"). The same count as Form Monitoring's "Pending HR approval (n)" tab, read through
 * the same `hrQueueSummary`, so the bar and the tab cannot disagree. Null: not a verified HR approver (or the read
 * failed, which only drops the count, never the bell).
 */
async function waitingForHr(identity: Awaited<ReturnType<typeof pageIdentity>>): Promise<number | null> {
  if (!identity?.verified) return null;
  try {
    const { actor } = await pageFormsAccess(identity);
    if (actor.hrApprover !== true) return null;
    return (await hrQueueSummary(actor))?.pending ?? 0;
  } catch {
    return null;
  }
}

export default async function AppLayout({ children }: { children: ReactNode }) {
  const [overdueFollowUps, showAppSwitcherBase, showLeadershipHub, meetingTabs, bell] = await Promise.all([
    overdueCount(),
    pageShowsAppSwitcher(),
    pageShowsLeadershipHub(),
    // The DM L10 tab: only for people the Leadership Hub lists as attendees (see features/l10).
    l10TabsForLayout(),
    bellForLayout(),
  ]);
  // A listed leader needs the menu to reach the tab, so the menu opens for them too.
  const showAppSwitcher = showAppSwitcherBase || showLeadershipHub;
  return (
    <AppShell
      overdueFollowUps={overdueFollowUps}
      showAppSwitcher={showAppSwitcher}
      showLeadershipHub={showLeadershipHub}
      meetingTabs={meetingTabs.map(({ href, label }) => ({ href, label }))}
      bell={bell}
    >
      {children}
    </AppShell>
  );
}
