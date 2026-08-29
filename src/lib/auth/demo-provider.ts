import { userForRole } from "@/data/demo/users";
import type { Role } from "@/types";
import type {
  AuthenticatedIdentity,
  AuthProvider,
  AuthRequestContext,
} from "./types";

/**
 * DemoAuthProvider — the presenter's role switcher, described honestly.
 *
 * It returns a fully-formed identity for whichever demo role is active, which
 * is exactly what the prototype needs and exactly what production must never
 * accept. Two properties keep that line visible:
 *
 *   isProductionGrade = false      -> server guards refuse it in live mode
 *   identity.verified  = false     -> nothing can mistake it for an assertion
 *
 * It performs no credential handling of any kind: no password is read, stored,
 * compared or hashed, and no token is issued or validated.
 */

const DEMO_ROLE_HEADER = "x-ask-sunny-demo-role";

export class DemoAuthProvider implements AuthProvider {
  readonly kind = "demo" as const;
  readonly name = "Demo role switcher (not authentication)";
  readonly isProductionGrade = false;
  readonly missingConfiguration: string[] = [];

  private readonly defaultRole: Role;

  constructor(defaultRole: Role = "salon_director") {
    this.defaultRole = defaultRole;
  }

  async identify(context: AuthRequestContext): Promise<AuthenticatedIdentity> {
    // The header is a convenience for exercising roles in the demo, and is
    // trusted precisely because nothing it unlocks is protected: this provider
    // is refused outright wherever authorization actually matters.
    const requested = context.headers.get(DEMO_ROLE_HEADER);
    const role = isRole(requested) ? requested : this.defaultRole;
    const user = userForRole(role);

    return {
      subject: `demo:${user.id}`,
      email: user.email,
      displayName: user.name,
      role: user.role,
      scope: user.scope,
      // Never true. A demo identity is not an assertion about a real person.
      verified: false,
    };
  }
}

const ROLES: Role[] = [
  "assistant_salon_director",
  "salon_director",
  "district_manager",
  "regional_manager",
  "owner",
  "developer",
];

function isRole(value: string | null): value is Role {
  return typeof value === "string" && (ROLES as string[]).includes(value);
}
