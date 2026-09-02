import { isDemoMode } from "@/lib/config/runtime";
import { DemoAuthProvider } from "./demo-provider";
import { UnconfiguredAuthProvider } from "./unconfigured-provider";
import type { AuthProvider } from "./types";

export * from "./types";
export { DemoAuthProvider } from "./demo-provider";
export { UnconfiguredAuthProvider } from "./unconfigured-provider";

/**
 * AUTH PROVIDER SELECTION — centralized, like the other three resolvers.
 *
 * demo -> DemoAuthProvider: the role switcher. Marked not production-grade, so
 *         server guards refuse it wherever authorization actually matters.
 *
 * live -> UnconfiguredAuthProvider: identifies nobody, so protected routes
 *         refuse. This is correct, not a gap to work around.
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
 * WHERE A REAL PROVIDER GOES
 * Implement `AuthProvider` in `src/lib/auth/<provider>-provider.ts` and add a
 * branch below. Nothing else moves: routes call `authorizeRequest()`, and the
 * UI calls `useSession()`.
 *
 * SUPABASE AUTH IS THE DEFAULT CHOICE for employee login unless another
 * provider is explicitly chosen. It is the default for concrete reasons rather
 * than by elimination: Supabase is already the database, so `auth.uid()` is the
 * subject the row level security policies in
 * `supabase/migrations/20260829000400_rls.sql` are written against, and it
 * needs no agreement from anyone outside this project to adopt.
 *   `identify()` reads the session from the request cookies with a server
 *   client built on the PUBLISHABLE key (never the secret key), and maps
 *   `auth.uid()` to a profile row. This is also the point at which
 *   `knowledge_documents.uploaded_by` starts being populated and those RLS
 *   policies begin doing real work.
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

export function getAuthProvider(): AuthProvider {
  cached ??= isDemoMode() ? new DemoAuthProvider() : new UnconfiguredAuthProvider();
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
      ? "Requests are authenticated against a real identity provider."
      : provider.kind === "demo"
        ? "The demo role switcher decides who you are. This is a presentation aid, not authentication, and it grants no server-side access."
        : "No identity provider is configured, so protected server functionality is refused.",
  };
}

/** Test seam — resets the singleton between cases. */
export function __resetAuthProvider(): void {
  cached = null;
}
