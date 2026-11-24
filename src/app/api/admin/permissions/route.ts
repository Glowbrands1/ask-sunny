import { NextResponse } from "next/server";

import { assertLiveMode, assertNoConfigurationProblems, errorResponse } from "@/lib/api/respond";
import { authenticateRequest, authorizeRequest } from "@/lib/auth/server";
import { AuthError } from "@/lib/auth/types";
import {
  DEFAULT_PERMISSION_MATRIX,
  PERMISSION_LABEL,
  PERMISSIONS,
  ROLES,
  ROLE_LABEL,
  activePermissionMatrix,
  activePermissionOverrides,
  canAccessAdminConsole,
  effectiveMatrix,
  isPermissionEditableFor,
  overridesFromMatrix,
} from "@/lib/permissions";
import { savePermissionOverrides } from "@/lib/permissions/store";
import type { Permission, Role } from "@/types";

/**
 * ============================================================================
 * GET /api/admin/permissions — the matrix in force (any signed-in person)
 * PUT /api/admin/permissions — save changes (administrator console roles only)
 * ============================================================================
 *
 * GET is open to every signed-in role because the browser needs the matrix to
 * decide what navigation to draw for itself; it reveals which roles hold which
 * permission, nothing about anybody's data. It is `authenticateRequest`, not a
 * permission, so an administrator who removes a role's own permissions cannot
 * make this fail for them.
 *
 * PUT is `authorizeRequest(…, "manage_users")` AND an admin-console role. The
 * body is `{ overrides: { <role>: Permission[] } }` — the whole set: a role
 * absent from it goes back to the built-in defaults. Anything the screen can
 * never offer is REFUSED with 400, not quietly dropped: an unknown role or key,
 * an administrator role, a locked cell.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function payload() {
  return {
    matrix: activePermissionMatrix(),
    overrides: activePermissionOverrides(),
    defaults: DEFAULT_PERMISSION_MATRIX,
  };
}

function refuse(message: string) {
  return NextResponse.json({ error: message, code: "invalid_input" }, { status: 400 });
}

export async function GET(request: Request) {
  try {
    await authenticateRequest(request);
    return NextResponse.json(payload(), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error, "GET /api/admin/permissions");
  }
}

export async function PUT(request: Request) {
  try {
    assertLiveMode();
    assertNoConfigurationProblems();
    const context = await authorizeRequest(request, "manage_users");
    if (!canAccessAdminConsole(context.identity.role)) {
      throw new AuthError("forbidden", "Changing permissions is limited to administrators.");
    }

    const body: unknown = await request.json().catch(() => null);
    const raw = body && typeof body === "object" ? (body as Record<string, unknown>).overrides : null;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return refuse("Send the permissions to save as { overrides: { <role>: [permission, …] } }.");
    }

    const overrides: Partial<Record<Role, Permission[]>> = {};
    for (const [role, list] of Object.entries(raw as Record<string, unknown>)) {
      if (!(ROLES as string[]).includes(role)) return refuse(`"${role}" is not a role.`);
      const r = role as Role;
      if (canAccessAdminConsole(r)) {
        return refuse(`${ROLE_LABEL[r]} always has full access and cannot be changed.`);
      }
      if (!Array.isArray(list)) return refuse(`Send a list of permissions for ${ROLE_LABEL[r]}.`);
      const chosen = new Set<Permission>();
      for (const entry of list) {
        if (typeof entry !== "string" || !(PERMISSIONS as string[]).includes(entry)) {
          return refuse(`"${String(entry)}" is not a permission.`);
        }
        const permission = entry as Permission;
        if (!isPermissionEditableFor(r, permission)) {
          return refuse(`"${PERMISSION_LABEL[permission]}" cannot be granted to ${ROLE_LABEL[r]}.`);
        }
        chosen.add(permission);
      }
      overrides[r] = PERMISSIONS.filter((permission) => chosen.has(permission));
    }

    // A role ticked back to its defaults goes back to FOLLOWING the defaults, so the build flags still shape it.
    await savePermissionOverrides(overridesFromMatrix(effectiveMatrix(overrides)), {
      id: context.identity.subject,
      email: context.identity.email,
    });
    return NextResponse.json(payload(), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error, "PUT /api/admin/permissions");
  }
}
