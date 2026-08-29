"use client";

import type { ReactNode } from "react";

import { TooltipProvider } from "@/components/ui/overlays";
import { SessionProvider } from "@/lib/session/session-context";
import { AppStoreProvider } from "@/lib/store/app-store";

/**
 * Client provider composition.
 *
 * AppStoreProvider wraps SessionProvider because the session's permission
 * checks read the (editable, persisted) permission matrix from the store.
 */
export function Providers({ children }: { children: ReactNode }) {
  return (
    <AppStoreProvider>
      <SessionProvider>
        <TooltipProvider delayDuration={220} skipDelayDuration={400}>
          {children}
        </TooltipProvider>
      </SessionProvider>
    </AppStoreProvider>
  );
}
