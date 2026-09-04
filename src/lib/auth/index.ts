import "server-only";

import { isDemoMode, supabasePublicConfigured } from "@/lib/config/runtime";
import { DemoAuthProvider } from "./demo-provider";
import { SupabaseAuthProvider } from "./supabase-provider";
import { UnconfiguredAuthProvider } from "./unconfigured-provider";
import type { AuthProvider } from "./types";

export * from "./types";
export { DemoAuthProvider } from "./demo-provider";
export { SupabaseAuthProvider } from "./supabase-provider";
export { UnconfiguredAuthProvider } from "./unconfigured-provider";

/*
 * `server-only` because provider SELECTION is a server decision: it reads the
 * environment and constructs something that validates session cookies. Client
 * code that wants the auth TYPES imports `./types`, which stays framework- and
 * server-free precisely so this line can exist.
 */

/**
 * AUTH PROVIDER SELECTION — centralized, like the other three resolvers.
 *
 * live + configured -> SupabaseAuthProvider: the real one. Validates the
 *         session cookie with Supabase Auth and reads the role from
 *         `public.app_users`. Production-grade.
 *
 * live + unconfigured -> UnconfiguredAuthProvider: identifies nobody, so
 *         protected routes refuse. This is correct, not a gap to work around.
 *
 * demo -> DemoAuthProvider: the role switcher. Marked not production-grade, so
 *         server guards refuse it wherever authorization actually matters.
 *
 * AUTHENTICATION IS PROVIDER-AGNOSTIC, AND THAT IS AN ARCHITECTURAL
 * CONSTRAINT RATHER THAN A PREFERENCE.
 * ---------------------------------------------------------------------------
 * No part of Ask Sunny may require a particular identity provider in order to
 * function. Reporting, the dashboard, report ingestion, knowledge/RAG and
 * automation all work with NO provider configured at all — ingestion holds its
 * own machine credential (`lib/reporting/ingest-credential.ts`), and the
 * reporting reads run server-side. What a provider adds is per-person login
 * and per-person scope; what it must never be is a precondition for the system
 * running.
 *
 * THE SEAM HELD. Adding the real provider moved no call site: routes still
 * call `authorizeRequest()` and the UI still calls `useSession()`. That is the
 * evidence the abstraction was worth having, and the reason the next provider
 * is also just one more file plus a branch here.
 *
 * SUPABASE AUTH IS THE IMPLEMENTED PROVIDER for employee login, chosen for
 * concrete reasons rather than by elimination: Supabase is already the
 * database, so `auth.uid()` is the subject the row level security policies in
 * `supabase/migrations/20260829000400_rls.sql` are already written against, and
 * it needs no agreement from anyone outside this project to adopt.
 *   `identify()` reads the session from the request cookies with a server
 *   client built on the PUBLISHABLE key (never the secret key), validates it
 *   with `getUser()` rather than merely decoding it, and maps `auth.uid()` to a
 *   row in `public.app_users`.
 *
 * ANY OTHER PROVIDER IS AN OPTIONAL ADAPTER — one more implementation of this
 * interface, added if it is available and wanted, and removable without
 * touching anything else. Microsoft Entra ID is one such candidate and is
 * explicitly NOT assumed to be available, now or ever: nothing in this codebase
 * is designed around it and no roadmap step depends on it. If it does arrive,
 * `identify()` would validate the request's bearer token against the tenant's
 * JWKS and map the `oid` claim to the same profile row — profile, role and
 * scope stay in this app's own tables either way, so no provider ever owns the
 * org chart.
 *
 * Whichever is chosen, `isProductionGrade` must be true and
 * `identity.verified` must be true only for a validated assertion.
 */
let cached: AuthProvider | null = null;

/**
 * PROVIDER PRECEDENCE, and why it is in this order.
 *
 *   1. LIVE + Supabase public values present -> SupabaseAuthProvider.
 *   2. LIVE + not configured                 -> UnconfiguredAuthProvider (refuses).
 *   3. DEMO                                  -> DemoAuthProvider (role switcher).
 *
 * The live branches are tested FIRST, and that ordering is the safety property.
 * `isDemoMode()` treats an UNSET variable as demo, which is right for a
 * prototype that must start with no configuration — but it would be badly
 * wrong for the variable to go missing on a real deployment and quietly
 * downgrade a live tenant to the role switcher. Reading the live case first
 * means demo mode is only ever reached when demo mode was actually selected.
 *
 * `NEXT_PUBLIC_DEMO_MODE=false` with no Supabase values still refuses rather
 * than falling back, which is the existing rule this keeps: live mode never
 * silently substitutes something weaker.
 */
export function getAuthProvider(): AuthProvider {
  if (cached) return cached;

  if (!isDemoMode()) {
    cached = supabasePublicConfigured()
      ? new SupabaseAuthProvider()
      : new UnconfiguredAuthProvider();
  } else {
    cached = new DemoAuthProvider();
  }

  return cached;
}

/** Honest label for the admin surface. Never overstates what is in place. */
export function authProviderStatus() {
  const provider = getAuthProvider();
  return {
    kind: provider.kind,
    name: provider.name,
    productionGrade: provider.isProductionGrade,
    missingConfiguration: provider.missingConfiguration,
    detail: provider.isProductionGrade
      ? "Requests are authenticated by Supabase Auth, and every role is read from the app_users profile table on the server."
      : provider.kind === "demo"
        ? "The demo role switcher decides who you are. This is a presentation aid, not authentication, and it grants no server-side access."
        : "No identity provider is configured, so protected server functionality is refused.",
  };
}

/** Test seam — resets the singleton between cases. */
export function __resetAuthProvider(): void {
  cached = null;
}
