"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";

import { useWhatsNewVisible } from "@/features/whats-new/whats-new-access";
import { useSession } from "@/lib/session/session-context";

import { pageLinksFor, type MeetingTab, type PageLink } from "./page-links";

/** The person's meeting tabs (decided on the server by the (app) layout), for answers that name the L10. */
const MeetingTabsContext = createContext<readonly MeetingTab[]>([]);

export function MeetingTabsProvider({ tabs, children }: { tabs: readonly MeetingTab[]; children: ReactNode }) {
  return <MeetingTabsContext.Provider value={tabs}>{children}</MeetingTabsContext.Provider>;
}

function useOptionalSession(): ReturnType<typeof useSession> | null {
  /*
   * An answer rendered outside the signed-in shell (a test, a preview) has no session: it links nothing. The hook
   * inside `useSession` (useContext) runs on every render either way, so the hook order never changes.
   */
  try {
    return useSession();
  } catch {
    return null;
  }
}

/** The pages this person's answers link to (`page-links.ts`): their sidebar's, and nothing else. */
export function usePageLinks(): readonly PageLink[] {
  const session = useOptionalSession();
  const whatsNewVisible = useWhatsNewVisible();
  const meetingTabs = useContext(MeetingTabsContext);
  const can = session?.can;
  const isAdmin = session?.isAdmin === true;
  const demoMode = session?.demoMode === true;
  return useMemo(
    () => (typeof can === "function" ? pageLinksFor({ can, isAdmin, demoMode, whatsNewVisible }, meetingTabs) : []),
    [can, isAdmin, demoMode, whatsNewVisible, meetingTabs],
  );
}
