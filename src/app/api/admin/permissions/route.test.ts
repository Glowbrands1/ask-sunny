import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

/*
 * The saved permissions matrix (Pau, 23 Nov 2026). The route runs for real, over a fake database, with an auth stand-in
 * that does what `authorizeRequest` does: check the role against the ACTIVE matrix.
 */
let role: string | null = "admin";
vi.mock("@/lib/auth/server", async () => {
  const { AuthError } = await import("@/lib/auth/types");
  const permissions = await import("@/lib/permissions");
  const identity = () => ({ subject: "u-1", email: "pau@example.test", role });
  return {
    authenticateRequest: vi.fn(async () => {
      if (!role) throw new AuthError("unauthenticated", "You are not signed in.");
      return { identity: identity(), permission: "ask_questions", provider: "test" };
    }),
    authorizeRequest: vi.fn(async (_request: Request, permission: never) => {
      if (!role) throw new AuthError("unauthenticated", "You are not signed in.");
      if (!permissions.hasPermission(permissions.activePermissionMatrix(), role as never, permission)) {
        throw new AuthError("forbidden", "Your role does not have permission to do that.");
      }
      return { identity: identity(), permission, provider: "test" };
    }),
  };
});

import { __setSupabaseAdmin } from "@/lib/supabase/server";
import { __resetPermissionStore, ensurePermissionsLoaded } from "@/lib/permissions/store";
import { DEFAULT_PERMISSION_MATRIX, activePermissionMatrix, hasPermission } from "@/lib/permissions";
import { GET, PUT } from "./route";

type Row = Record<string, unknown>;
const tables: Record<string, Row[]> = { permission_overrides: [], permission_override_audit: [] };

function fakeDb() {
  return {
    from(table: string) {
      return {
        select: async () => ({ data: tables[table]!.map((row) => ({ ...row })), error: null }),
        upsert: async (rows: Row[]) => {
          for (const row of rows) {
            tables[table] = tables[table]!.filter((existing) => existing.role !== row.role);
            tables[table]!.push({ ...row });
          }
          return { error: null };
        },
        delete: () => ({
          in: async (_column: string, values: string[]) => {
            tables[table] = tables[table]!.filter((row) => !values.includes(row.role as string));
            return { error: null };
          },
        }),
        insert: async (rows: Row[]) => {
          tables[table]!.push(...rows);
          return { error: null };
        },
      };
    },
  } as never;
}

const put = (body: unknown) =>
  PUT(new Request("http://localhost/api/admin/permissions", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
const get = () => GET(new Request("http://localhost/api/admin/permissions"));

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "false");
  vi.stubEnv("SUPABASE_SECRET_KEY", "sb_secret_test");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.test");
  role = "admin";
  tables.permission_overrides = [];
  tables.permission_override_audit = [];
  __setSupabaseAdmin(fakeDb());
  __resetPermissionStore();
});
afterEach(() => {
  __setSupabaseAdmin(null);
  __resetPermissionStore();
  vi.unstubAllEnvs();
});

describe("GET /api/admin/permissions", () => {
  it("gives any signed-in role the matrix in force, and refuses nobody-signed-in", async () => {
    role = "employee";
    const response = await get();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.matrix.employee).toEqual(DEFAULT_PERMISSION_MATRIX.employee);
    expect(body.overrides).toEqual({});

    role = null;
    expect((await get()).status).toBe(401);
  });
});

describe("PUT /api/admin/permissions", () => {
  it("refuses a role that is not an administrator, and changes nothing", async () => {
    for (const refused of ["employee", "salon_director", "district_manager", "regional_manager"]) {
      role = refused;
      expect((await put({ overrides: { employee: [] } })).status).toBe(403);
    }
    expect(tables.permission_overrides).toEqual([]);
    expect(activePermissionMatrix()).toEqual(DEFAULT_PERMISSION_MATRIX);
  });

  it("refuses locked cells, administrator roles, unknown keys and a malformed body", async () => {
    expect((await put({ overrides: { district_manager: ["manage_users"] } })).status).toBe(400);
    expect((await put({ overrides: { salon_director: ["view_l10_meetings"] } })).status).toBe(400);
    expect((await put({ overrides: { salon_director: ["view_ai_usage"] } })).status).toBe(400);
    expect((await put({ overrides: { admin: [] } })).status).toBe(400);
    expect((await put({ overrides: { employee: ["fly_a_plane"] } })).status).toBe(400);
    expect((await put({ overrides: { nobody: [] } })).status).toBe(400);
    expect((await put({ overrides: { employee: "all" } })).status).toBe(400);
    expect((await put({})).status).toBe(400);
    expect(tables.permission_overrides).toEqual([]);
  });

  it("saves, returns the new matrix, enforces it at once and writes an audit row per changed cell", async () => {
    const response = await put({ overrides: { salon_director: ["ask_questions", "view_videos"] } });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.matrix.salon_director).toEqual(["ask_questions", "view_videos"]);
    expect(body.overrides).toEqual({ salon_director: ["ask_questions", "view_videos"] });

    expect(hasPermission(activePermissionMatrix(), "salon_director", "view_reports")).toBe(false);
    expect(tables.permission_overrides).toHaveLength(1);
    expect(tables.permission_overrides[0]).toMatchObject({ role: "salon_director", updated_by: "pau@example.test" });
    const removed = tables.permission_override_audit.filter((row) => row.granted === false);
    expect(removed.length).toBe(DEFAULT_PERMISSION_MATRIX.salon_director.length - 2);
    expect(tables.permission_override_audit.every((row) => row.changed_by === "pau@example.test")).toBe(true);
  });

  it("round-trips: a fresh server process reads back exactly what was saved", async () => {
    await put({ overrides: { employee: ["ask_questions", "view_google_reviews"], salon_director: ["ask_questions"] } });

    // A restart: nothing in memory, the database is all there is.
    __resetPermissionStore();
    expect(hasPermission(activePermissionMatrix(), "employee", "view_google_reviews")).toBe(false);
    await ensurePermissionsLoaded();

    role = "employee";
    const body = await (await get()).json();
    expect(body.matrix.employee).toEqual(["ask_questions", "view_google_reviews"]);
    expect(body.matrix.salon_director).toEqual(["ask_questions"]);
    expect(body.matrix.district_manager).toEqual(DEFAULT_PERMISSION_MATRIX.district_manager);
  });

  it("a role sent back at its defaults goes back to following the defaults", async () => {
    await put({ overrides: { employee: [] } });
    expect(tables.permission_overrides).toHaveLength(1);
    const editable = DEFAULT_PERMISSION_MATRIX.employee;
    const response = await put({ overrides: { employee: editable } });
    expect(response.status).toBe(200);
    expect(tables.permission_overrides).toEqual([]);
    expect((await response.json()).overrides).toEqual({});
  });

  it("a failed read keeps the matrix in force instead of opening anything", async () => {
    await put({ overrides: { employee: ["ask_questions"] } });
    __setSupabaseAdmin({
      from: () => ({ select: async () => ({ data: null, error: { message: "down" } }) }),
    } as never);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await ensurePermissionsLoaded(Date.now() + 60_000);
    expect(hasPermission(activePermissionMatrix(), "employee", "view_knowledge")).toBe(false);
  });
});
