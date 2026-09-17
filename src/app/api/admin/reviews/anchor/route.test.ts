import { readFileSync } from "node:fs";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_PERMISSION_MATRIX, hasPermission, ROLES } from "@/lib/permissions";

/**
 * ============================================================================
 * WHO MAY MOVE THE LINE THE BUSINESS COUNTS FROM
 * ============================================================================
 *
 * The baseline setup screen exists so nobody has to hold a Google review id or
 * a terminal. That convenience is only safe if the route behind it is exactly
 * as strict as the terminal was, so this file drives the ROUTE rather than the
 * screen:
 *
 *   A ROLE WITHOUT `manage_integrations` IS REFUSED, and refused before any
 *   store code is read. A District Manager can read every review on the
 *   dashboard; moving an anchor changes what the weekly number means, and that
 *   is Administration's.
 *
 *   THE DECISION IS NOT DUPLICATED HERE. The route hands the request to
 *   `applyAnchors`, which both doors share — so the refusal to replace an
 *   existing anchor and the promotion rule are stated once.
 *
 *   THE AUDIT LABEL COMES FROM THE SESSION. There is no field in the body that
 *   can put somebody else's name on a change.
 *
 * Every identity, salon and review id below is invented. The store codes are
 * real because they are printed on the storefronts.
 */

const ROUTE = "src/app/api/admin/reviews/anchor/route.ts";
const ORIGINAL = { ...process.env };

interface Applied {
  requests: { storeCode: string; externalReviewId?: string | null; fromNewestHeld?: boolean; replace?: boolean }[];
  credentialId: string | null;
}

async function load(role: string) {
  process.env.NEXT_PUBLIC_DEMO_MODE = "false";
  vi.resetModules();

  const applied: Applied[] = [];

  vi.doMock("@/lib/auth/server", async () => {
    const { AuthError } = await import("@/lib/auth/types");
    return {
      /*
       * THE REAL MATRIX, applied the way `authorizeRequest` applies it. A mock
       * that handed back an identity whatever the permission would make every
       * assertion below vacuous.
       */
      authorizeRequest: async (_request: Request, permission: string) => {
        if (!hasPermission(DEFAULT_PERMISSION_MATRIX, role as never, permission as never)) {
          throw new AuthError("forbidden", "Your role does not have permission to do that.");
        }
        return {
          identity: {
            subject: "user-fixture-1",
            email: "qa.admin@example.test",
            displayName: "QA Admin",
            role,
            scope: { level: "global", primaryAreaId: null, alsoCoversAreaIds: [] },
            verified: true,
          },
          permission,
          provider: "supabase",
        };
      },
    };
  });

  /*
   * The environment guards are stubbed, not removed: the SOURCE tests below
   * assert they are called and in what order. Running them for real here would
   * only mean asserting that this test file configured Supabase.
   */
  vi.doMock("@/lib/api/respond", async (importActual) => ({
    ...(await importActual<typeof import("@/lib/api/respond")>()),
    assertLiveMode: () => {},
    assertNoConfigurationProblems: () => {},
    assertWithinRateLimit: () => {},
  }));

  vi.doMock("@/lib/reviews/anchors", async (importActual) => ({
    /* `normaliseAnchorRequests` stays REAL — its refusals are the route's. */
    ...(await importActual<typeof import("@/lib/reviews/anchors")>()),
    applyAnchors: async (requests: Applied["requests"], options: { credentialId: string | null }) => {
      applied.push({ requests, credentialId: options.credentialId });
      return requests.map((request) => ({
        storeCode: request.storeCode,
        status: request.fromNewestHeld ? "baseline_set" : "anchor_set",
        assignedAbove: 0,
      }));
    },
  }));

  const route = await import("./route");
  return { route, applied };
}

function post(body: unknown): Request {
  return new Request("https://app.test/api/admin/reviews/anchor", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  process.env = { ...ORIGINAL };
  vi.doUnmock("@/lib/auth/server");
  vi.doUnmock("@/lib/api/respond");
  vi.doUnmock("@/lib/reviews/anchors");
});

describe("POST /api/admin/reviews/anchor", () => {
  it("lets an administrator baseline a listing", async () => {
    /*
     * THE GUARD ON THE GUARD. If this fixture could not set an anchor at all,
     * every refusal below would pass for the wrong reason.
     */
    const { route, applied } = await load("admin");

    const response = await route.POST(post({ anchors: [{ storeCode: "306", fromNewestHeld: true }] }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ status: "ok" });
    expect(applied).toHaveLength(1);
    expect(applied[0].requests[0]).toMatchObject({ storeCode: "306", fromNewestHeld: true });
  });

  it("refuses every role that does not hold manage_integrations, and writes nothing", async () => {
    const refused = ROLES.filter(
      (role) => !hasPermission(DEFAULT_PERMISSION_MATRIX, role, "manage_integrations"),
    );
    /* A sweep over an empty list is not a test. */
    expect(refused.length).toBeGreaterThan(0);
    expect(refused).toContain("district_manager");
    expect(refused).toContain("salon_director");

    for (const role of refused) {
      const { route, applied } = await load(role);
      const response = await route.POST(
        post({ anchors: [{ storeCode: "306", fromNewestHeld: true }] }),
      );

      expect(response.status, role).toBe(403);
      /* Not "refused after the fact" — `applyAnchors` was never reached. */
      expect(applied, role).toHaveLength(0);
    }
  });

  it("refuses a reader of the dashboard who is not an administrator", async () => {
    /*
     * Named separately because it is the exact confusion this route exists to
     * prevent: `view_google_reviews` is held broadly and `manage_integrations`
     * is not, and seeing that a salon is counting nothing is not permission to
     * decide where it starts counting.
     */
    const reader = ROLES.find(
      (role) =>
        hasPermission(DEFAULT_PERMISSION_MATRIX, role, "view_google_reviews") &&
        !hasPermission(DEFAULT_PERMISSION_MATRIX, role, "manage_integrations"),
    );
    expect(reader, "no role reads reviews without managing integrations").toBeDefined();

    const { route, applied } = await load(reader as string);
    const response = await route.POST(
      post({ anchors: [{ storeCode: "306", externalReviewId: "FIXTURE-ANCHOR-0001" }] }),
    );

    expect(response.status).toBe(403);
    expect(applied).toHaveLength(0);
  });

  it("stamps the signed-in person, and offers no way to name somebody else", async () => {
    const { route, applied } = await load("admin");

    await route.POST(
      post({
        anchors: [{ storeCode: "306", fromNewestHeld: true }],
        /* Ignored. There is no path from the body to the audit label. */
        credentialId: "somebody-else",
        setBy: "somebody-else",
      }),
    );

    expect(applied[0].credentialId).toBe("admin:qa.admin@example.test");
  });

  it("passes `replace` through only when the caller sent it", async () => {
    const { route, applied } = await load("admin");

    await route.POST(
      post({
        anchors: [
          { storeCode: "306", fromNewestHeld: true },
          { storeCode: "143", externalReviewId: "FIXTURE-CHOSEN-0009", replace: true },
        ],
      }),
    );

    expect(applied[0].requests[0].replace).toBe(false);
    expect(applied[0].requests[1].replace).toBe(true);
  });

  it("refuses a store code that is not one of the fifteen", async () => {
    const { route, applied } = await load("admin");

    const response = await route.POST(
      post({ anchors: [{ storeCode: "881", fromNewestHeld: true }] }),
    );

    expect(response.status).toBe(400);
    expect(applied).toHaveLength(0);
  });
});

describe("the anchor route's source", () => {
  const source = readFileSync(ROUTE, "utf8");

  it("authorizes before it does anything else", () => {
    /*
     * The privileged Supabase client inside `applyAnchors` bypasses row level
     * security. Nothing may reach it that has not been authorized first, and a
     * guard placed after the work has not guarded it.
     */
    const body = source.slice(source.indexOf("export async function POST"));
    const authorize = body.indexOf("await authorizeRequest");
    expect(authorize).toBeGreaterThan(-1);
    expect(authorize).toBeLessThan(body.indexOf("applyAnchors("));
    expect(body.indexOf("assertLiveMode()")).toBeLessThan(authorize);
  });

  it("gates on manage_integrations and on nothing weaker", () => {
    expect(source).toContain('authorizeRequest(request, "manage_integrations")');
    /* One gate, and it is that one. Not a second, weaker call beside it. */
    expect(source.match(/authorizeRequest\(/g)).toHaveLength(1);
    expect(source).not.toMatch(/authorizeRequest\(request, "(?!manage_integrations)/);
  });

  it("takes the audit label from the identity and never from the body", () => {
    expect(source).toMatch(/context\.identity\.(email|subject)/);
    expect(source).not.toMatch(/body\.credentialId|body\.setBy|body\.actor/);
  });

  it("does not restate the reporting rule", () => {
    /*
     * NO SECOND OPINION ABOUT WHAT COUNTS. The route reads a body and calls
     * `applyAnchors`; anything here that decided a period, a feed position or a
     * star threshold would be a rule with two definitions.
     */
    expect(source).toContain("applyAnchors");
    for (const smell of [
      "reporting_period_id",
      "feed_position",
      "eligible_for_weekly_count",
      "planPeriodAssignment",
      "google_review_set_anchor",
    ]) {
      expect(source, smell).not.toContain(smell);
    }
  });
});
