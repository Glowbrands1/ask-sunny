import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  ADMIN_CONSOLE_ROLES,
  DEFAULT_PERMISSION_MATRIX,
  PERMISSIONS,
  ROLE_LABEL,
  ROLES,
  canAccessAdminConsole,
  hasPermission,
} from "./index";
import type { Permission, Role } from "@/types";

/**
 * ============================================================================
 * THE TWO NEW ROLES, AND THE CONTRACT EACH ONE CARRIES.
 * ============================================================================
 *
 * `employee` is the only role in this application defined by a CLOSED LIST, and
 * these tests are what keep it closed. The important assertion is not the list
 * of things Employee cannot do — it is that a permission added to the app in
 * future is denied to Employee AUTOMATICALLY, because nobody has to remember to
 * exclude it. That is the test that will still be doing work in a year.
 *
 * `admin` is the client administrator: full access, and distinct from
 * `developer`, which stays for internal build and support work.
 *
 * The existing manager roles are asserted to have KEPT what they had. This
 * milestone adds page-level gates to four screens that previously had none, and
 * a gate added without a matching grant silently takes working functionality
 * away from every manager — a regression wearing a security fix's clothes.
 */

/** Exactly what the brief specifies an Employee may do. Nothing else. */
const EMPLOYEE_ALLOWED: Permission[] = ["ask_questions", "view_knowledge", "view_videos"];

describe("the Employee role", () => {
  it("holds exactly the three capabilities it is specified to hold", () => {
    expect([...DEFAULT_PERMISSION_MATRIX.employee].sort()).toEqual([...EMPLOYEE_ALLOWED].sort());
  });

  it("can ask Sunny, read knowledge and watch videos", () => {
    for (const permission of EMPLOYEE_ALLOWED) {
      expect(hasPermission(DEFAULT_PERMISSION_MATRIX, "employee", permission), permission).toBe(
        true,
      );
    }
  });

  it("is denied every other permission in the application", () => {
    /*
     * THE LOAD-BEARING TEST. Derived from PERMISSIONS rather than written as a
     * list of denials, so a permission added next month is covered the day it
     * is added. A hand-written deny list would pass forever while quietly
     * failing to mention the new one.
     */
    const denied = PERMISSIONS.filter((permission) => !EMPLOYEE_ALLOWED.includes(permission));
    expect(denied.length).toBeGreaterThan(10);
    for (const permission of denied) {
      expect(hasPermission(DEFAULT_PERMISSION_MATRIX, "employee", permission), permission).toBe(
        false,
      );
    }
  });

  it("is denied each capability the brief names explicitly", () => {
    // Stated again by name. If the derivation above were ever weakened, these
    // are the specific refusals the client asked for.
    const named: Permission[] = [
      "view_overview",
      "view_daily_stats",
      "view_reports",
      "view_google_reviews",
      "create_coaching",
      "create_coaching_form",
      "create_corrective_action",
      "create_epp",
      "create_policy_review",
      "view_form_monitoring",
      "manage_form_templates",
      "manage_form_records",
      "view_forms_workspace",
      "view_manager_resources",
      "manage_knowledge",
      "manage_videos",
      "view_ai_usage",
      "manage_users",
      "manage_integrations",
    ];
    for (const permission of named) {
      expect(hasPermission(DEFAULT_PERMISSION_MATRIX, "employee", permission), permission).toBe(
        false,
      );
    }
  });

  it("cannot reach the admin console", () => {
    expect(canAccessAdminConsole("employee")).toBe(false);
  });

  it("can read the knowledge base without being able to change it", () => {
    // The split these two permissions exist for.
    expect(hasPermission(DEFAULT_PERMISSION_MATRIX, "employee", "view_knowledge")).toBe(true);
    expect(hasPermission(DEFAULT_PERMISSION_MATRIX, "employee", "manage_knowledge")).toBe(false);
    expect(hasPermission(DEFAULT_PERMISSION_MATRIX, "employee", "view_videos")).toBe(true);
    expect(hasPermission(DEFAULT_PERMISSION_MATRIX, "employee", "manage_videos")).toBe(false);
  });
});

describe("the Admin role", () => {
  it("holds every permission in the application", () => {
    for (const permission of PERMISSIONS) {
      expect(hasPermission(DEFAULT_PERMISSION_MATRIX, "admin", permission), permission).toBe(true);
    }
  });

  it("reaches the admin console, and is not the developer role", () => {
    expect(canAccessAdminConsole("admin")).toBe(true);
    expect(ADMIN_CONSOLE_ROLES).toContain("admin");
    // Two distinct roles that happen to share a permission set today.
    expect(ROLE_LABEL.admin).toBe("Admin");
    expect(ROLE_LABEL.developer).toBe("Developer");
    expect(ROLE_LABEL.developer).not.toContain("Admin");
  });

  it("has the same reach as owner and developer", () => {
    for (const permission of PERMISSIONS) {
      expect(hasPermission(DEFAULT_PERMISSION_MATRIX, "admin", permission)).toBe(
        hasPermission(DEFAULT_PERMISSION_MATRIX, "owner", permission),
      );
    }
  });
});

describe("the existing manager roles keep what they had", () => {
  /*
   * Four screens gained a permission check in this milestone: the Overview, the
   * knowledge base, the Forms workspace and Manager Resources. All four were
   * previously reachable by every role, so every manager role must now hold the
   * matching permission or this milestone has removed functionality.
   */
  const PREVIOUSLY_UNGATED: Permission[] = [
    "view_overview",
    "view_knowledge",
    "view_manager_resources",
  ];
  const MANAGERS: Role[] = [
    "assistant_salon_director",
    "salon_director",
    "district_manager",
    "regional_manager",
  ];

  it("still lets every manager role open the screens that had no gate", () => {
    for (const role of MANAGERS) {
      for (const permission of PREVIOUSLY_UNGATED) {
        expect(hasPermission(DEFAULT_PERMISSION_MATRIX, role, permission), `${role}/${permission}`).toBe(
          true,
        );
      }
    }
  });

  it("gives the Forms workspace to the roles that can create a form", () => {
    /*
     * `/forms/create` was ungated. The page gate must not be stricter than the
     * per-form permissions behind it: a role that may create a coaching form
     * must be able to open the workspace where forms are created.
     */
    const formCreators: Permission[] = [
      "create_coaching_form",
      "create_corrective_action",
      "create_epp",
      "create_policy_review",
    ];
    for (const role of ROLES) {
      const canCreateSomething = formCreators.some((permission) =>
        hasPermission(DEFAULT_PERMISSION_MATRIX, role, permission),
      );
      if (canCreateSomething) {
        expect(
          hasPermission(DEFAULT_PERMISSION_MATRIX, role, "view_forms_workspace"),
          role,
        ).toBe(true);
      }
    }
  });

  it("does not quietly widen any manager role's administration access", () => {
    for (const role of MANAGERS) {
      expect(hasPermission(DEFAULT_PERMISSION_MATRIX, role, "manage_users"), role).toBe(false);
      expect(hasPermission(DEFAULT_PERMISSION_MATRIX, role, "manage_integrations"), role).toBe(
        false,
      );
      expect(canAccessAdminConsole(role), role).toBe(false);
    }
  });
});

describe("the matrix is exhaustive and consistent", () => {
  it("defines a permission set for every role", () => {
    for (const role of ROLES) {
      expect(DEFAULT_PERMISSION_MATRIX[role], role).toBeDefined();
    }
    expect(Object.keys(DEFAULT_PERMISSION_MATRIX).sort()).toEqual([...ROLES].sort());
  });

  it("grants nothing that is not a declared permission", () => {
    // A typo in a matrix entry would otherwise be a permission that silently
    // never matches anything.
    for (const role of ROLES) {
      for (const permission of DEFAULT_PERMISSION_MATRIX[role] ?? []) {
        expect(PERMISSIONS, `${role}/${permission}`).toContain(permission);
      }
    }
  });

  it("labels and describes every role", () => {
    for (const role of ROLES) {
      expect(ROLE_LABEL[role], role).toBeTruthy();
    }
  });
});

describe("the database agrees with the application about roles", () => {
  const migration = readFileSync(
    "supabase/migrations/20260904006000_app_users.sql",
    "utf8",
  );

  it("declares the same role values as the Role type", () => {
    /*
     * The enum is what makes a bad role a rejected write rather than a user
     * whose every permission lookup denies. If the two lists drift, a role the
     * application can express becomes unstorable — or worse, a role stored in
     * the database stops being recognised by the matrix and silently denies
     * everything.
     */
    const enumBlock = migration.slice(
      migration.indexOf("create type public.app_user_role"),
      migration.indexOf("end;", migration.indexOf("create type public.app_user_role")),
    );
    for (const role of ROLES) {
      expect(enumBlock, role).toContain(`'${role}'`);
    }
  });

  it("protects the same roles the application calls administrative", () => {
    /*
     * THE LAST-ADMIN TRIGGER counts these three as administrative. If
     * ADMIN_CONSOLE_ROLES gained a role the trigger did not know about, the app
     * could be left with only that role active and the trigger would happily
     * allow it to be demoted — locking everybody out of User Management with no
     * way back.
     */
    const guard = migration.slice(migration.indexOf("app_users_guard_last_admin"));
    for (const role of ADMIN_CONSOLE_ROLES) {
      expect(guard, role).toContain(`'${role}'`);
    }
    // And nothing else is treated as administrative by the trigger.
    const treated = [...guard.matchAll(/role in \(([^)]*)\)/g)]
      .flatMap((match) => match[1].split(",").map((entry) => entry.trim().replace(/'/g, "")))
      .filter((entry) => entry.length > 0);
    expect([...new Set(treated)].sort()).toEqual([...ADMIN_CONSOLE_ROLES].sort());
  });

  it("keys the profile to auth.users and cascades when the credential goes", () => {
    expect(migration).toMatch(
      /id uuid primary key references auth\.users \(id\) on delete cascade/,
    );
  });

  it("enables AND forces row level security, with no write policy for a browser role", () => {
    expect(migration).toMatch(/alter table public\.app_users enable row level security/);
    expect(migration).toMatch(/alter table public\.app_users force row level security/);
    // One policy, select, own row only.
    expect(migration).toMatch(/for select to authenticated\s*\n\s*using \(id = auth\.uid\(\)\)/);
    expect(migration).not.toMatch(/for (insert|update|delete) to (authenticated|anon)/);
  });

  it("takes the trigger functions off the exposed RPC surface via PUBLIC", () => {
    /*
     * THE MISTAKE THIS PINS, made once already.
     *
     * Both guard functions are `security definer`, and PostgREST publishes
     * every function in `public` as an RPC endpoint. The first attempt to close
     * that revoked EXECUTE from `anon, authenticated` and changed NOTHING:
     * Postgres grants EXECUTE to PUBLIC on every new function, so both roles
     * kept the privilege by inheritance and the linter kept flagging it. Only
     * `from public` actually removes it.
     *
     * Asserted for each function by name so that adding a third guard without
     * the PUBLIC revoke fails here rather than in an advisor report weeks later.
     */
    for (const guard of ["app_users_guard_self_elevation", "app_users_guard_last_admin"]) {
      expect(migration, guard).toContain(
        `revoke execute on function public.${guard}() from public;`,
      );
    }
  });

  it("refuses self-elevation in the database as well as in the routes", () => {
    const guard = migration.slice(migration.indexOf("app_users_guard_self_elevation"));
    expect(guard).toContain("A user cannot change their own role.");
    expect(guard).toContain("A user cannot change their own status.");
    expect(guard).toMatch(/auth\.uid\(\) = new\.id/);
  });
});
