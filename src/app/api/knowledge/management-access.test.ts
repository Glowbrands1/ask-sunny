import { readFileSync } from "node:fs";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ADMIN_CONSOLE_ROLES, ROLES } from "@/lib/permissions";
import type { Role } from "@/types";

/**
 * ============================================================================
 * MANAGING THE KNOWLEDGE BASE vs USING IT
 * ============================================================================
 *
 * THE REPORT: the Knowledge Base management area was visible to every manager.
 * A Regional Manager — and, through `view_knowledge`, an Employee — could open
 * the screen and read the whole document inventory: what the company holds, how
 * much of it, what had failed to process.
 *
 * Hiding the sidebar entry would not have fixed it. `GET /api/knowledge/documents`
 * returns that entire inventory in one call, so the library stayed one
 * address-bar request away from anybody holding `view_knowledge`.
 *
 * THE LINE THIS FILE DEFENDS, and it cuts between two things that look alike:
 *
 *   MANAGING — the inventory, upload, delete, re-index. Administration of the
 *   corpus. `ADMIN_CONSOLE_ROLES`, via `authorizeAdminConsoleRequest`.
 *
 *   USING — asking Sunny, being given an answer grounded in these documents,
 *   and opening the ONE document a citation names. `ask_questions` and
 *   `view_knowledge`, exactly as before.
 *
 * The second half matters as much as the first. A fix that locked retrieval or
 * broke citations would have taken the product away from the roles it is for,
 * so the routes that must NOT have moved are asserted here alongside the ones
 * that must have.
 */

const ORIGINAL = { ...process.env };

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  process.env = { ...ORIGINAL };
});

/** A route's source with comments stripped, so prose cannot satisfy a match. */
function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const MANAGEMENT = {
  "the document inventory": "src/app/api/knowledge/documents/route.ts",
  upload: "src/app/api/knowledge/upload/route.ts",
  delete: "src/app/api/knowledge/documents/[id]/route.ts",
  "re-index / retry": "src/app/api/knowledge/documents/[id]/reindex/route.ts",
} as const;

const USE = {
  "chat retrieval": "src/app/api/knowledge/search/route.ts",
  "the cited document": "src/app/api/knowledge/documents/[id]/route.ts",
  "the cited document's file": "src/app/api/knowledge/documents/[id]/file/route.ts",
} as const;

describe("the knowledge-base MANAGEMENT routes", () => {
  it.each(Object.entries(MANAGEMENT))(
    "%s is behind the admin console",
    (_label, path) => {
      expect(code(path)).toContain("authorizeAdminConsoleRequest(request,");
    },
  );

  it("does not let the inventory be read with view_knowledge alone", () => {
    /*
     * The specific regression. `view_knowledge` is held by every role including
     * Employee — it is what lets Sunny cite a policy at somebody — so it can
     * never again be the only thing standing in front of the listing.
     */
    const listing = code(MANAGEMENT["the document inventory"]);
    expect(listing).not.toMatch(/\bauthorizeRequest\(request,\s*"view_knowledge"\)/);
    expect(listing).toContain('authorizeAdminConsoleRequest(request, "view_knowledge")');
  });
});

describe("the routes Ask Sunny needs, which did NOT move", () => {
  it("leaves chat retrieval on ask_questions", () => {
    // The answer path. If this ever needs the admin console, every role below
    // Admin has silently lost the product.
    expect(code(USE["chat retrieval"])).toContain(
      'authorizeRequest(request, "ask_questions")',
    );
    expect(code(USE["chat retrieval"])).not.toContain("authorizeAdminConsoleRequest");
  });

  it("leaves the cited document's own file on view_knowledge", () => {
    expect(code(USE["the cited document's file"])).toContain(
      'authorizeRequest(request, "view_knowledge")',
    );
    expect(code(USE["the cited document's file"])).not.toContain(
      "authorizeAdminConsoleRequest",
    );
  });

  it("reads ONE document at view_knowledge while deleting it needs the console", () => {
    /*
     * The two verbs share a file, and the asymmetry is the design: reading the
     * document you were just cited is use, destroying it is administration.
     */
    const source = code(USE["the cited document"]);
    expect(source).toContain('authorizeRequest(request, "view_knowledge")');
    expect(source).toContain('authorizeAdminConsoleRequest(request, "manage_knowledge")');
  });

  it("reaches no listing from the single-document route", () => {
    // What stops the citation route being walked into an inventory: it has no
    // call that returns more than the one document it was asked for.
    expect(code(USE["the cited document"])).not.toContain("listDocuments");
  });
});

/* ===================================================== the guard itself == */

/**
 * Demo mode, because it is the one mode with a usable identity per role and no
 * external provider. The demo role switcher does not offer every role, so the
 * cases below are the ones it can actually produce — Employee's side of this is
 * asserted against the permission matrix and the rail, and behaviourally in
 * `corpus-authority.test.ts` where the guard is driven directly.
 */
async function authorizeAs(role: Role, permission: "view_knowledge" | "manage_knowledge") {
  process.env.NEXT_PUBLIC_DEMO_MODE = "true";
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  const { authorizeAdminConsoleRequest } = await import("@/lib/auth/server");
  return authorizeAdminConsoleRequest(
    new Request("https://app.test/api/knowledge/documents", {
      headers: { "x-ask-sunny-demo-role": role },
    }),
    permission,
  );
}

describe("authorizeAdminConsoleRequest", () => {
  it("refuses a Regional Manager, who holds manage_knowledge", async () => {
    /*
     * THE CASE THE REQUEST NAMED, and the reason this is a console check rather
     * than a permission check: a Regional Manager DOES hold `manage_knowledge`
     * in the matrix, so gating on the permission alone would have let them
     * straight through. What they do not hold is administration of the platform.
     */
    await expect(authorizeAs("regional_manager", "manage_knowledge")).rejects.toMatchObject(
      { code: "forbidden", status: 403 },
    );
  });

  it("refuses every non-console role that the demo switcher can produce", async () => {
    for (const role of ["salon_director", "district_manager", "regional_manager"] as Role[]) {
      await expect(authorizeAs(role, "view_knowledge"), role).rejects.toMatchObject({
        code: "forbidden",
      });
    }
  });

  it("admits the roles that administer the platform", async () => {
    for (const role of ["owner", "developer"] as Role[]) {
      const context = await authorizeAs(role, "manage_knowledge");
      expect(context.identity.role, role).toBe(role);
    }
  });

  it("checks the PERMISSION first, so the two refusals stay distinct", async () => {
    /*
     * An Assistant Salon Director holds neither. The refusal must be the
     * permission's, not the console's, or an administrator debugging access
     * reads the wrong cause.
     */
    await expect(
      authorizeAs("assistant_salon_director", "manage_knowledge"),
    ).rejects.toMatchObject({
      message: "Your role does not have permission to do that.",
    });
  });

  it("admits exactly the admin-console roles and no others", () => {
    // Pinned against the shared list rather than a copy of it, so a role added
    // to ADMIN_CONSOLE_ROLES does not need this file edited to stay true.
    expect(ADMIN_CONSOLE_ROLES.every((role) => ROLES.includes(role))).toBe(true);
    expect([...ADMIN_CONSOLE_ROLES].sort()).toEqual(["admin", "developer", "owner"]);
  });
});
