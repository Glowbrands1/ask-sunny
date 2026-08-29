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
 * WHERE A REAL PROVIDER GOES
 * ---------------------------------------------------------------------------
 * Implement `AuthProvider` in `src/lib/auth/<provider>-provider.ts` and add a
 * branch below. Nothing else moves: routes call `authorizeRequest()`, and the
 * UI calls `useSession()`.
 *
 * Microsoft Entra ID
 *   `identify()` validates the bearer token on the request against the tenant's
 *   JWKS, then maps the `oid` claim to a profile row. Registration, tenant id
 *   and client id are server-side environment variables; profile, role and
 *   scope stay in this app's own tables, so the identity provider never owns
 *   the org chart.
 *
 * Supabase Auth
 *   `identify()` reads the session from the request cookies with a server
 *   client built on the PUBLISHABLE key (never the secret key), and maps
 *   `auth.uid()` to the same profile row. This is also the point at which
 *   `knowledge_documents.uploaded_by` starts being populated and the RLS
 *   policies written in `supabase/migrations/20260829000400_rls.sql` begin
 *   doing real work.
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
