"use client";

import { createContext, useContext, type ReactNode } from "react";

/**
 * WHETHER THIS PERSON SEES WHAT'S NEW (the sidebar entry and search). Decided on the server by the `(app)` layout
 * (`whatsNewVisibleFor`, from the verified session) and handed down as one yes/no; WHATS_NEW_USERS itself never reaches
 * the browser. With no provider (a test, a page outside the layout) it is hidden.
 */
const WhatsNewAccessContext = createContext<boolean>(false);

export function WhatsNewAccessProvider({ visible, children }: { visible: boolean; children: ReactNode }) {
  return <WhatsNewAccessContext.Provider value={visible}>{children}</WhatsNewAccessContext.Provider>;
}

export function useWhatsNewVisible(): boolean {
  return useContext(WhatsNewAccessContext);
}
