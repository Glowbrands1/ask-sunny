import type {
  AuthenticatedIdentity,
  AuthProvider,
  AuthRequestContext,
} from "./types";

/**
 * UnconfiguredAuthProvider — live mode with no identity provider chosen.
 *
 * This is the honest state of the project today: no provider has been
 * connected, so there is nothing to authenticate against. Supabase Auth is the
 * default choice when one is; every provider is an adapter behind
 * `AuthProvider` and none is a foundational dependency.
 *
 * Note what this state does NOT close. Reporting, the salon dashboard, report
 * ingestion and knowledge/RAG all work with this provider in place, because
 * none of them identifies a person: reporting reads run server-side and
 * ingestion holds its own machine credential. What stays closed is
 * per-person functionality, which is the correct thing to close.
 *
 * It identifies nobody. Every server-side guard therefore refuses, which is the
 * intended behaviour — protected functionality stays closed until a real
 * provider exists, rather than falling open. It is NOT a stub that pretends to
 * work, and it is not a way to disable authentication.
 */
export class UnconfiguredAuthProvider implements AuthProvider {
  readonly kind = "none" as const;
  readonly name = "No authentication provider configured";
  readonly isProductionGrade = false;
  /**
   * Empty rather than a guessed variable name: no provider has been selected,
   * so no set of variables is the right one yet. The guard's message says that
   * plainly instead of implying a key is missing.
   */
  readonly missingConfiguration: string[] = [];

  async identify(_context: AuthRequestContext): Promise<AuthenticatedIdentity | null> {
    void _context;
    return null;
  }
}
