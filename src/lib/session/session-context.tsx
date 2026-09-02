"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  type ReactNode,
} from "react";

import { DEMO_LOCATIONS, areaLabel } from "@/data/demo/locations";
import { userForRole } from "@/data/demo/users";
import { isDemoMode } from "@/lib/config/runtime";
import { ACTIVE_BRAND } from "@/lib/brand";
import { canAccessAdminConsole, hasPermission, ROLES } from "@/lib/permissions";
import { useAppStore } from "@/lib/store/app-store";
import { useHydrated, usePreference, writePreference } from "@/lib/utils/client-store";
import type { BrandConfig, Permission, Role, User } from "@/types";

/**
 * SESSION
 * ---------------------------------------------------------------------------
 * Authentication is deliberately abstracted and deliberately not implemented.
 * This provider holds "who is using the app right now" and nothing else — no
 * password handling, no credential storage, no homemade hashing.
 *
 * The only thing persisted is the presenter's demo session (signed-in flag and
 * chosen role) in sessionStorage, so a refresh mid-presentation does not drop
 * them back to the login screen. Nothing sensitive is stored anywhere.
 *
 * PRODUCTION: replace `signInAsDemo` with a real identity provider — Supabase
 * Auth unless another is explicitly chosen, and no particular provider is
 * assumed to be available. The User object below is profile data and stays
 * separate from the auth mechanism, which is what makes the provider an
 * adapter: swapping it must not touch profiles, roles or scopes.
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
  /** True once the client has read any stored demo session. */
  hydrated: boolean;
  demoMode: boolean;
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

export function SessionProvider({ children }: { children: ReactNode }) {
  const { permissionMatrix } = useAppStore();
  const hydrated = useHydrated();

  const signedInRaw = usePreference("session", SIGNED_IN_KEY, "0");
  const roleRaw = usePreference("session", ROLE_KEY, DEFAULT_ROLE);

  const signedIn = signedInRaw === "1";
  const role: Role = isRole(roleRaw) ? roleRaw : DEFAULT_ROLE;

  const signInAsDemo = useCallback((nextRole?: Role) => {
    if (nextRole) writePreference("session", ROLE_KEY, nextRole);
    writePreference("session", SIGNED_IN_KEY, "1");
  }, []);

  const signOut = useCallback(() => {
    writePreference("session", SIGNED_IN_KEY, "0");
  }, []);

  const setDemoRole = useCallback((nextRole: Role) => {
    writePreference("session", ROLE_KEY, nextRole);
  }, []);

  const user = useMemo(() => userForRole(role), [role]);

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

  const can = useCallback(
    (permission: Permission) => hasPermission(permissionMatrix, role, permission),
    [permissionMatrix, role],
  );

  const value = useMemo<SessionValue>(
    () => ({
      hydrated,
      demoMode: DEMO_MODE,
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
