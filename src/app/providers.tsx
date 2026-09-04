"use client";

import type { ReactNode } from "react";

import { TooltipProvider } from "@/components/ui/overlays";
import type { AuthenticatedSession } from "@/lib/session/authenticated-user";
import { SessionProvider } from "@/lib/session/session-context";
import { AppStoreProvider } from "@/lib/store/app-store";

/**
 * Client provider composition.
 *
 * AppStoreProvider wraps SessionProvider because the session's permission
 * checks read the (editable, persisted) permission matrix from the store.
 *
 * THE IDENTITY ARRIVES AS A PROP, resolved by the root layout on the server
 * before any of this rendered. That is what makes the first paint correct: a
 * client that had to go and ask who it was would render a signed-out shell,
 * then a signed-in one, and the flash between them is visible on every page
 * load. Nothing here fetches an identity, and nothing here can change one.
 */
export function Providers({
  children,
  session = null,
  productionAuth = false,
}: {
  children: ReactNode;
  session?: AuthenticatedSession | null;
  productionAuth?: boolean;
}) {
  return (
    <AppStoreProvider>
      <SessionProvider session={session} productionAuth={productionAuth}>
        <TooltipProvider delayDuration={220} skipDelayDuration={400}>
          {children}
        </TooltipProvider>
      </SessionProvider>
    </AppStoreProvider>
  );
}
