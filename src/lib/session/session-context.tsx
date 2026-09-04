"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";

import { DEMO_LOCATIONS, areaLabel } from "@/data/demo/locations";
import { userForRole } from "@/data/demo/users";
import { isDemoMode } from "@/lib/config/runtime";
import { ACTIVE_BRAND } from "@/lib/brand";
import {
  DEFAULT_PERMISSION_MATRIX,
  canAccessAdminConsole,
  hasPermission,
  ROLES,
} from "@/lib/permissions";
import { useAppStore } from "@/lib/store/app-store";
import { useHydrated, usePreference, writePreference } from "@/lib/utils/client-store";
import type { BrandConfig, Permission, Role, User } from "@/types";
import { userFromSession, type AuthenticatedSession } from "./authenticated-user";

/**
 * SESSION
 * ---------------------------------------------------------------------------
 * "Who is using the app right now", and nothing else. No password is handled,
 * stored, compared or hashed here or anywhere else in Ask Sunny — Supabase Auth
 * owns credentials, and duplicating that would mean owning a credential store
 * we have no business owning.
 *
 * ===========================================================================
 * TWO MODES, AND THE REAL ONE IS NOT A VARIATION ON THE DEMO ONE.
 * ===========================================================================
 *
 * REAL MODE. The server resolved the identity before this component existed
 * and passed it down as a prop. `signedIn`, `role`, `user` and `scope` all come
 * from that, which means:
 *
 *   - There is nothing to hydrate. `hydrated` is true on the first render, so
 *     the loading splash the demo needs is gone and no screen flashes.
 *   - `signInAsDemo` and `setDemoRole` THROW. Not no-ops: a stray call is a bug
 *     that would otherwise silently do nothing, and the only reason to call
 *     either is to change who you are, which real mode must refuse loudly.
 *   - `can()` reads DEFAULT_PERMISSION_MATRIX, never the store's editable copy.
 *     A person who edited their local matrix must not see admin navigation
 *     appear, even though the server would still refuse them.
 *
 * DEMO MODE is unchanged: sessionStorage holds a signed-in flag and a chosen
 * role, so a refresh mid-presentation does not drop the presenter back to the
 * login screen. Nothing sensitive is stored anywhere, and no password is
 * handled, hashed or compared in either mode.
 */

/**
 * Read through the shared helper, never from the variable directly.
 *
 * This module used to test `=== "true"`, which disagreed with `isDemoMode()`
 * on the unset case: the data layer ran seeded while this one rendered a login
 * screen with no way past it. `NEXT_PUBLIC_` variables are inlined at build
 * time, so the helper works in the browser bundle exactly as it does on the
 * server.
 */
const DEMO_MODE = isDemoMode();
const SIGNED_IN_KEY = "ask-sunny:demo-signed-in";
const ROLE_KEY = "ask-sunny:demo-role";
const DEFAULT_ROLE: Role = "salon_director";

interface SessionValue {
  /**
   * True once the client has read any stored demo session.
   *
   * ALWAYS TRUE IN REAL MODE. The server already knew who was asking, so there
   * is nothing to wait for and nothing to flash.
   */
  hydrated: boolean;
  demoMode: boolean;
  /**
   * True when a real identity provider vouched for this session.
   *
   * Distinct from `!demoMode`: live mode with no provider configured is neither
   * demo nor authenticated, and a screen that needs to know which of the three
   * it is in should ask this rather than infer it.
   */
  authenticated: boolean;
  signedIn: boolean;
  user: User;
  role: Role;
  brand: BrandConfig;
  /** The salon/district/region label shown in the UI for this user. */
  scopeLabel: string;
  /** Location used to pre-fill generated forms. */
  primaryLocationName: string;
  /**
   * Name written into the "Manager" field of a generated form. Salon accounts
   * are shared per salon, so their role title reads correctly on a form where
   * the bare account name ("Riverbend Commons") would not.
   */
  managerDisplayName: string;
  can: (permission: Permission) => boolean;
  isAdmin: boolean;
  signInAsDemo: (role?: Role) => void;
  signOut: () => void;
  setDemoRole: (role: Role) => void;
}

const SessionContext = createContext<SessionValue | null>(null);

function isRole(value: string): value is Role {
  return (ROLES as string[]).includes(value);
}

export function SessionProvider({
  children,
  /**
   * The identity the SERVER resolved, or null.
   *
   * Present only when a production-grade provider is configured. Passing it in
   * rather than fetching it here is what makes the first render correct: a
   * client that had to go and ask would render a signed-out shell first.
   */
  session = null,
  /**
   * Whether real authentication is in play at all.
   *
   * Separate from `session` being null, because "no provider configured" and
   * "provider configured, nobody signed in" need different behaviour and look
   * identical if you only check the identity.
   */
  productionAuth = false,
}: {
  children: ReactNode;
  session?: AuthenticatedSession | null;
  productionAuth?: boolean;
}) {
  const { permissionMatrix } = useAppStore();
  const hydratedFromClient = useHydrated();
  const router = useRouter();

  const signedInRaw = usePreference("session", SIGNED_IN_KEY, "0");
  const roleRaw = usePreference("session", ROLE_KEY, DEFAULT_ROLE);

  const authenticated = productionAuth && session !== null;

  // Nothing to wait for when the server already answered.
  const hydrated = productionAuth ? true : hydratedFromClient;
  const signedIn = productionAuth ? session !== null : signedInRaw === "1";
  const demoRole: Role = isRole(roleRaw) ? roleRaw : DEFAULT_ROLE;
  const role: Role = session ? session.role : demoRole;

  /*
   * BOTH THROW IN REAL MODE, and deliberately rather than returning quietly.
   * Their only purpose is to change who you are; a call reaching here with a
   * real session is either dead demo code or something worse, and a silent
   * no-op would hide both.
   */
  const signInAsDemo = useCallback(
    (nextRole?: Role) => {
      if (productionAuth) {
        throw new Error(
          "signInAsDemo is not available when real authentication is configured. Sign in through the login form.",
        );
      }
      if (nextRole) writePreference("session", ROLE_KEY, nextRole);
      writePreference("session", SIGNED_IN_KEY, "1");
    },
    [productionAuth],
  );

  const setDemoRole = useCallback(
    (nextRole: Role) => {
      if (productionAuth) {
        throw new Error(
          "setDemoRole is not available when real authentication is configured. A role comes from the app_users profile and is changed in User Management.",
        );
      }
      writePreference("session", ROLE_KEY, nextRole);
    },
    [productionAuth],
  );

  /*
   * SIGN OUT IS THE ONE ACTION THAT IS REAL IN BOTH MODES.
   *
   * In real mode it ends the Supabase session, which clears the cookie
   * server-side so the next request identifies nobody.
   *
   * Then `replace` and `refresh`, and both are needed. `replace` rather than
   * `push` so the back button cannot return to the app shell. `refresh`
   * because it invalidates the router cache — without it, Next may still hold
   * rendered payloads for pages the previous person visited, and on a shared
   * salon computer that is somebody else's data on screen.
   *
   * The Supabase client is imported lazily so the module, and the publishable
   * key it reads, are only pulled into the bundle where they are used.
   */
  const signOut = useCallback(() => {
    if (!productionAuth) {
      writePreference("session", SIGNED_IN_KEY, "0");
      return;
    }
    void (async () => {
      try {
        const { getSupabaseBrowserClient } = await import(
          "@/lib/supabase/browser-client"
        );
        await getSupabaseBrowserClient().auth.signOut();
      } catch {
        /*
         * Sign out must not be blockable. If ending the server session failed,
         * leaving somebody on a signed-in screen is the worse outcome — the
         * navigation below sends them to the login screen either way, and the
         * page guards refuse anything the cookie no longer proves.
         */
      }
      router.replace("/login");
      router.refresh();
    })();
  }, [productionAuth, router]);

  const user = useMemo(
    () => (session ? userFromSession(session) : userForRole(role)),
    [session, role],
  );

  const scopeLabel = useMemo(() => {
    if (user.scope.level === "global") return "All salons";
    const primary = areaLabel(user.scope.primaryAreaId);
    if (user.scope.alsoCoversAreaIds.length === 0) return primary;
    return `${primary} · also covers ${user.scope.alsoCoversAreaIds
      .map((id) => areaLabel(id))
      .join(", ")}`;
  }, [user]);

  const primaryLocationName = useMemo(() => {
    if (user.scope.level === "salon" && user.scope.primaryAreaId) {
      return (
        DEMO_LOCATIONS.find((location) => location.id === user.scope.primaryAreaId)
          ?.name ?? "All salons"
      );
    }
    return areaLabel(user.scope.primaryAreaId);
  }, [user]);

  const managerDisplayName = user.isSalonAccount ? user.title : user.name;

  /*
   * THE MATRIX THE BROWSER MAY NOT EDIT.
   *
   * `permissionMatrix` comes from the app store, which persists to IndexedDB
   * and is editable in demo mode — that is the whole point of it there. In real
   * mode it must not decide anything: somebody who edited their local copy
   * would see admin navigation appear, and although the server would still
   * refuse them, a rail full of links that all bounce is a bug report.
   */
  const can = useCallback(
    (permission: Permission) =>
      hasPermission(
        productionAuth ? DEFAULT_PERMISSION_MATRIX : permissionMatrix,
        role,
        permission,
      ),
    [productionAuth, permissionMatrix, role],
  );

  const value = useMemo<SessionValue>(
    () => ({
      hydrated,
      demoMode: DEMO_MODE,
      authenticated,
      signedIn,
      user,
      role,
      brand: ACTIVE_BRAND,
      scopeLabel,
      primaryLocationName,
      managerDisplayName,
      can,
      isAdmin: canAccessAdminConsole(role),
      signInAsDemo,
      signOut,
      setDemoRole,
    }),
    [
      hydrated,
      authenticated,
      signedIn,
      user,
      role,
      scopeLabel,
      primaryLocationName,
      managerDisplayName,
      can,
      signInAsDemo,
      signOut,
      setDemoRole,
    ],
  );

  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  );
}

export function useSession(): SessionValue {
  const context = useContext(SessionContext);
  if (!context) {
    throw new Error("useSession must be used inside SessionProvider");
  }
  return context;
}
