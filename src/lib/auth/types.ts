import type { AccessScope, Permission, Role } from "@/types";

/**
 * AUTHENTICATION ABSTRACTION
 * ---------------------------------------------------------------------------
 * The seam a real identity provider slots into. Deliberately an interface and
 * two honest implementations — a demo provider that says it is not production,
 * and an unconfigured provider that refuses — with NO third implementation
 * pretending to be Microsoft Entra ID or Supabase Auth.
 *
 * Choosing the provider is a later decision. What this file fixes now is the
 * shape of the answer to "who is making this request, and may they do this?",
 * so that answering it for real later does not move any call site.
 *
 * The critical property: `isProductionGrade`. Server-side guards check it
 * rather than checking whether an identity was returned, because the demo
 * provider always returns an identity. A demo identity is a presentation aid,
 * not an authenticated subject, and the type system keeps them distinguishable.
 */

export type AuthProviderKind =
  /** Presenter's role switcher. Never a security boundary. */
  | "demo"
  /** No provider configured. Refuses everything in live mode. */
  | "none"
  /** Reserved. Not implemented — see `docs` in `index.ts`. */
  | "entra_id"
  /** Reserved. Not implemented. */
  | "supabase";

/**
 * Who the caller is.
 *
 * `verified` is false for anything the demo provider produces. Nothing that
 * grants access may treat an unverified identity as authenticated.
 */
export interface AuthenticatedIdentity {
  /** Stable subject id from the identity provider. */
  subject: string;
  email: string;
  displayName: string;
  role: Role;
  scope: AccessScope;
  /** True only when a real identity provider asserted this. */
  verified: boolean;
}

/**
 * What a provider needs from an incoming request to identify the caller.
 *
 * Headers only, deliberately: it keeps providers testable with a plain
 * `new Headers()` and independent of the web framework. A cookie-based provider
 * reads the `cookie` header like any other.
 */
export interface AuthRequestContext {
  headers: Headers;
}

export interface AuthProvider {
  readonly kind: AuthProviderKind;
  /** Human label for the admin surface. */
  readonly name: string;
  /**
   * True only for a real identity provider. The demo provider returns FALSE,
   * which is what stops it from ever being mistaken for production security.
   */
  readonly isProductionGrade: boolean;
  /**
   * Environment variable NAMES this provider needs but does not have. Empty
   * when fully configured. Never contains a value.
   */
  readonly missingConfiguration: string[];

  /**
   * Resolve the caller. Returns null when the request carries no usable
   * identity. Never throws for an ordinary "not signed in".
   */
  identify(context: AuthRequestContext): Promise<AuthenticatedIdentity | null>;
}

/* ------------------------------------------------------------------ errors */

export type AuthErrorCode =
  /** Live mode, but no production identity provider is configured. */
  | "no_provider"
  /** A provider exists but the request carried no valid identity. */
  | "unauthenticated"
  /** Identified, but this role lacks the permission. */
  | "forbidden";

export class AuthError extends Error {
  readonly code: AuthErrorCode;
  readonly status: number;
  /** Environment variable NAMES that are unset. Never values. */
  readonly missing: string[];

  constructor(code: AuthErrorCode, message: string, missing: string[] = []) {
    super(message);
    this.name = "AuthError";
    this.code = code;
    this.missing = missing;
    this.status =
      code === "no_provider" ? 501 : code === "unauthenticated" ? 401 : 403;
  }
}

/** What a passed authorization check hands back to a route handler. */
export interface AuthorizedContext {
  identity: AuthenticatedIdentity;
  permission: Permission;
  /** Which provider vouched for the identity. */
  provider: AuthProviderKind;
}
