import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * ============================================================================
 * PATCH /api/admin/feedback/[id] — MODERATION IS ADMINISTRATION
 * ============================================================================
 *
 * The gate is `view_analytics`, which `admin`, `owner` and `developer` hold and
 * nobody else does. It is the same permission the analytics screen is gated by,
 * deliberately: the queue and the page that shows it are one capability, and
 * splitting them would create a role that can see complaints and not act on
 * them, or act on them without seeing them.
 *
 * WHAT THESE PIN, beyond the permission:
 *
 *   The administrator is the SESSION's, never the body's. Otherwise "resolved
 *   by" is worth nothing.
 *
 *   Closing stamps a hand and a time; REOPENING CLEARS THEM. A stale "resolved
 *   by Paulyne, 3 September" sitting on an open item is a lie about who is
 *   holding it.
 *
 *   Hiding is a soft delete and there is no hard one. There is no DELETE verb
 *   on this route, which is the point: an administrator can take an abusive
 *   comment off the dashboard and cannot make it as though nobody complained.
 */

const ORIGINAL = { ...process.env };

interface Seen {
  updates: { patch: Record<string, unknown>; id: string }[];
  deletes: { table: string; id: string }[];
}

async function load(role: string) {
  vi.resetModules();
  const seen: Seen = { updates: [], deletes: [] };

  vi.doMock("@/lib/auth/server", () => ({
    authorizeRequest: async (_request: Request, permission: string) => {
      /*
       * THE REAL MATRIX DECIDES, not a flag in this test. Importing it means a
       * change that granted `view_analytics` to a Salon Director would fail
       * here rather than passing a test that had hard-coded the old answer.
       */
      const { DEFAULT_PERMISSION_MATRIX } = await import("@/lib/permissions");
      const held =
        DEFAULT_PERMISSION_MATRIX[role as keyof typeof DEFAULT_PERMISSION_MATRIX] ?? [];
      if (!held.includes(permission as never)) {
        const { AuthError } = await import("@/lib/auth/types");
        throw new AuthError("forbidden", "You do not have access to that.");
      }
      return {
        identity: {
          subject: "admin-1",
          email: "admin@example.com",
          displayName: "Admin",
          role,
          scope: { level: "global", primaryAreaId: null, alsoCoversAreaIds: [] },
          verified: true,
        },
        permission,
        provider: "supabase",
      };
    },
  }));

  vi.doMock("@/lib/supabase/server", () => ({
    getSupabaseAdmin: () => ({
      from: (table: string) => ({
        update: (patch: Record<string, unknown>) => ({
          eq: async (_column: string, id: string) => {
            seen.updates.push({ patch, id });
            return { error: null };
          },
        }),
        delete: () => ({
          eq: async (_column: string, id: string) => {
            /* The TABLE is recorded, so "it deleted the turn" is catchable. */
            seen.deletes.push({ table, id });
            return { error: null };
          },
        }),
      }),
    }),
  }));

  const route = await import("./[id]/route");
  return { route, seen };
}

const ID = "55555555-5555-4555-8555-555555555555";

function patch(body: Record<string, unknown>, id = ID): Request {
  return new Request(`https://app.test/api/admin/feedback/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function del(id = ID): Request {
  return new Request(`https://app.test/api/admin/feedback/${id}`, { method: "DELETE" });
}

function params(id = ID) {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  vi.resetModules();
  process.env.NEXT_PUBLIC_DEMO_MODE = "false";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test";
  process.env.SUPABASE_SECRET_KEY = ["sb", "secret", "TESTFIXTURE"].join("_");
  process.env.ANTHROPIC_API_KEY = "test";
});

afterEach(() => {
  process.env = { ...ORIGINAL };
  vi.doUnmock("@/lib/auth/server");
  vi.doUnmock("@/lib/supabase/server");
  vi.resetModules();
});

/* ------------------------------------------------------------ the gate --- */

describe("only an administrator may moderate", () => {
  it.each(["admin", "owner", "developer"])("admits %s", async (role) => {
    const { route, seen } = await load(role);
    const response = await route.PATCH(patch({ status: "resolved" }), params());

    expect(response.status).toBe(200);
    expect(seen.updates).toHaveLength(1);
  });

  it.each([
    "employee",
    "assistant_salon_director",
    "salon_director",
    "district_manager",
    "regional_manager",
  ])("refuses %s, and writes nothing", async (role) => {
    /*
     * A REGIONAL MANAGER IS IN THIS LIST DELIBERATELY. They hold `view_ai_usage`
     * — the closest neighbouring administrative permission — and still do not
     * hold `view_analytics`. If somebody ever widens one by widening the other,
     * this is where it shows up.
     */
    const { route, seen } = await load(role);
    const response = await route.PATCH(patch({ status: "resolved" }), params());

    expect(response.status).toBe(403);
    expect(seen.updates).toHaveLength(0);
  });
});

/* ------------------------------------------------------- the transitions -- */

describe("the moderation workflow", () => {
  it("stamps who closed it and when, on resolve and on dismiss", async () => {
    for (const status of ["resolved", "dismissed"] as const) {
      const { route, seen } = await load("admin");
      await route.PATCH(patch({ status }), params());

      expect(seen.updates[0].patch.status).toBe(status);
      expect(seen.updates[0].patch.resolved_by).toBe("admin-1");
      expect(seen.updates[0].patch.resolved_at).toEqual(expect.any(String));
    }
  });

  it("clears the hand and the time when an item is reopened", async () => {
    /*
     * A stale "resolved by" on an open item is a lie about who is holding it.
     */
    for (const status of ["pending", "in_review"] as const) {
      const { route, seen } = await load("admin");
      await route.PATCH(patch({ status }), params());

      expect(seen.updates[0].patch.status).toBe(status);
      expect(seen.updates[0].patch.resolved_by).toBeNull();
      expect(seen.updates[0].patch.resolved_at).toBeNull();
    }
  });

  it("takes the administrator from the session, never from the body", async () => {
    const { route, seen } = await load("admin");
    await route.PATCH(
      patch({ status: "resolved", resolvedBy: "someone-else", adminUserId: "x" }),
      params(),
    );

    expect(seen.updates[0].patch.resolved_by).toBe("admin-1");
  });

  it("hides and restores without touching the status", async () => {
    /*
     * They answer different questions — "has anybody dealt with this" and "may
     * this text appear" — and an abusive comment about a real bug is hidden AND
     * pending. Collapsing the two would force a choice between showing the
     * abuse and losing the bug.
     */
    const hide = await load("admin");
    await hide.route.PATCH(patch({ hidden: true }), params());
    expect(hide.seen.updates[0].patch.hidden_at).toEqual(expect.any(String));
    expect(hide.seen.updates[0].patch.hidden_by).toBe("admin-1");
    expect(hide.seen.updates[0].patch.status).toBeUndefined();

    const restore = await load("admin");
    await restore.route.PATCH(patch({ hidden: false }), params());
    expect(restore.seen.updates[0].patch.hidden_at).toBeNull();
    expect(restore.seen.updates[0].patch.hidden_by).toBeNull();
  });

  it("clears a note set to empty rather than storing an empty string", async () => {
    const { route, seen } = await load("admin");
    await route.PATCH(patch({ resolutionNote: "   " }), params());

    expect(seen.updates[0].patch.resolution_note).toBeNull();
  });

  it("leaves a field alone when the body omits it", async () => {
    /*
     * PATCH, not PUT, so two administrators working the queue cannot clobber
     * each other by sending back a whole object.
     */
    const { route, seen } = await load("admin");
    await route.PATCH(patch({ status: "in_review" }), params());

    expect(seen.updates[0].patch.resolution_note).toBeUndefined();
    expect(seen.updates[0].patch.hidden_at).toBeUndefined();
  });

  it("refuses a body that would change nothing", async () => {
    /*
     * An empty patch would fire the touch trigger and move `updated_at`, making
     * an item look edited because somebody opened it.
     */
    const { route, seen } = await load("admin");
    const response = await route.PATCH(patch({}), params());

    expect(response.status).toBe(400);
    expect(seen.updates).toHaveLength(0);
  });

  it("refuses a status outside the workflow", async () => {
    const { route, seen } = await load("admin");
    const response = await route.PATCH(patch({ status: "escalated" }), params());

    expect(response.status).toBe(400);
    expect(seen.updates).toHaveLength(0);
  });

  it("refuses an id that is not a uuid before it reaches a query", async () => {
    /*
     * An unparsed string passed to Postgres as a uuid is an error page rather
     * than a 400, and the caller learns more from the former than they should.
     */
    const { route, seen } = await load("admin");
    const response = await route.PATCH(
      patch({ status: "resolved" }, "not-an-id"),
      params("not-an-id"),
    );

    expect(response.status).toBe(400);
    expect(seen.updates).toHaveLength(0);
  });

  it("refuses a resolution note longer than the column allows", async () => {
    const { route, seen } = await load("admin");
    const response = await route.PATCH(
      patch({ resolutionNote: "x".repeat(2001) }),
      params(),
    );

    expect(response.status).toBe(400);
    expect(seen.updates).toHaveLength(0);
  });
});

/* ------------------------------------------------------- no hard delete --- */

describe("permanent delete is a separate, administration-only verb", () => {
  it.each(["admin", "owner", "developer"])("admits %s", async (role) => {
    const { route, seen } = await load(role);
    const response = await route.DELETE(del(), params());

    expect(response.status).toBe(200);
    expect(seen.deletes).toHaveLength(1);
    expect(seen.deletes[0].id).toBe(ID);
  });

  it.each([
    "employee",
    "assistant_salon_director",
    "salon_director",
    "district_manager",
    "regional_manager",
  ])("refuses %s, and deletes nothing", async (role) => {
    const { route, seen } = await load(role);
    const response = await route.DELETE(del(), params());

    expect(response.status).toBe(403);
    expect(seen.deletes).toHaveLength(0);
  });

  it("deletes the feedback row and never the turn", async () => {
    /*
     * THE PROPERTY THAT KEEPS THE USAGE FIGURES HONEST. A QA rating being
     * removed must not remove the record that a question was asked and
     * answered, because it was. The foreign key cascades FROM the event TO the
     * feedback and never the other way, and this asserts the route agrees.
     */
    const { route, seen } = await load("admin");
    await route.DELETE(del(), params());

    expect(seen.deletes.map((entry) => entry.table)).toEqual(["ask_sunny_feedback"]);
    expect(seen.deletes.map((entry) => entry.table)).not.toContain("activity_events");
  });

  it("refuses an id that is not a uuid before it reaches a query", async () => {
    const { route, seen } = await load("admin");
    const response = await route.DELETE(del("not-an-id"), params("not-an-id"));

    expect(response.status).toBe(400);
    expect(seen.deletes).toHaveLength(0);
  });

  it("takes no body, so nothing about it can be asserted by a caller", async () => {
    /*
     * A destructive route with no input but the path and the session. There is
     * no field a caller could add to widen what it removes.
     */
    const source = readFileSync(
      join(process.cwd(), "src/app/api/admin/feedback/[id]/route.ts"),
      "utf8",
    );
    const body = source.split("export async function DELETE")[1] ?? "";
    expect(body.length).toBeGreaterThan(0);
    expect(body).not.toContain("parseJsonBody");
  });

  it("authorizes before the privileged client is touched", () => {
    const source = readFileSync(
      join(process.cwd(), "src/app/api/admin/feedback/[id]/route.ts"),
      "utf8",
    );
    const body = source.split("export async function DELETE")[1] ?? "";
    expect(body.indexOf("authorizeRequest")).toBeLessThan(body.indexOf("deleteFeedback"));
    expect(body).toContain('authorizeRequest(request, "view_analytics")');
  });
});

describe("hide is still not delete", () => {
  it("hiding updates the row rather than removing it", async () => {
    /*
     * THE DISTINCTION THE WHOLE MODERATION MODEL RESTS ON, re-asserted now that
     * a delete verb exists next to it. Hiding must never become a delete by
     * accident: it takes a comment off the dashboard and leaves the record that
     * somebody complained, which is what makes "we had no complaints" checkable.
     */
    const { route, seen } = await load("admin");
    await route.PATCH(patch({ hidden: true }), params());

    expect(seen.updates).toHaveLength(1);
    expect(seen.updates[0].patch.hidden_at).toEqual(expect.any(String));
    expect(seen.deletes).toHaveLength(0);
  });

  it("no moderation field can trigger a delete", async () => {
    /* A PATCH body naming a delete changes nothing, because nothing reads it. */
    const { route, seen } = await load("admin");
    await route.PATCH(
      patch({ status: "dismissed", delete: true, deleted: true, remove: true }),
      params(),
    );

    expect(seen.deletes).toHaveLength(0);
    expect(seen.updates).toHaveLength(1);
  });

  it("the store's delete names the feedback table and nothing else", () => {
    const store = readFileSync(join(process.cwd(), "src/lib/feedback/store.ts"), "utf8");
    const fn = store.split("export async function deleteFeedback")[1] ?? "";
    expect(fn.length).toBeGreaterThan(0);
    expect(fn).toContain('.from("ask_sunny_feedback")');
    expect(fn).not.toContain("activity_events");
  });
});
