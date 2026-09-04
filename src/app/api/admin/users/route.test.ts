import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * ============================================================================
 * THE ADMIN USER ROUTES.
 * ============================================================================
 *
 * These three routes hand a request to a module that holds the privileged
 * Supabase client and the Auth Admin API. What has to be true of every one of
 * them is an ORDERING and a SOURCE:
 *
 *   `authorizeRequest(request, "manage_users")` runs before anything reaches
 *   the directory. A guard placed after the work has not guarded it.
 *
 *   The ACTOR comes from that authorization result and never from the body. A
 *   body-supplied actor would let a caller attribute a change to somebody else
 *   and would defeat the self-change refusal, which compares the target to the
 *   actor.
 *
 * Asserted against the source rather than by calling the handlers, because what
 * matters is a property of every route in the directory — including the one
 * somebody adds next month — and a behavioural test only covers the routes it
 * was written for.
 */

/*
 * The USER routes, not everything under /api/admin.
 *
 * `admin/reporting/ingest` also lives there and is a MACHINE endpoint holding
 * its own credential — it has no user, so requiring `manage_users` of it would
 * be wrong. Scoping to this directory keeps the sweep meaningful: every route
 * under it administers people, and every one of them must be authorized the
 * same way.
 */
const ROUTE_DIR = "src/app/api/admin/users";

function adminRoutes(dir = ROUTE_DIR): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...adminRoutes(path));
    else if (entry.name === "route.ts") found.push(path);
  }
  return found.sort();
}

const ROUTES = adminRoutes();

describe("every admin route", () => {
  it("exists, so an empty sweep cannot pass", () => {
    expect(ROUTES.length).toBeGreaterThanOrEqual(3);
  });

  it.each(ROUTES)("%s requires manage_users", (route) => {
    const source = readFileSync(route, "utf8");
    expect(source).toContain('authorizeRequest(request, "manage_users")');
  });

  it.each(ROUTES)("%s authorizes BEFORE it touches the directory", (route) => {
    /*
     * The guard has to be the first await in each handler. Anything awaited
     * first has already run for a caller who may have no business here.
     */
    const source = readFileSync(route, "utf8");
    const handlers = [
      ...source.matchAll(/export async function (?:GET|POST|PATCH|DELETE)\([\s\S]*?\n}/g),
    ].map((match) => match[0]);

    expect(handlers.length, `${route} exports no handler`).toBeGreaterThan(0);

    for (const body of handlers) {
      const authorize = body.indexOf("await authorizeRequest");
      const firstAwait = body.indexOf("await ");
      expect(authorize, route).toBeGreaterThan(-1);
      expect(authorize, route).toBe(firstAwait);
    }
  });

  it.each(ROUTES)("%s takes the actor from the identity, never the body", (route) => {
    const source = readFileSync(route, "utf8");
    if (!source.includes("actor") && !source.includes("identity")) return;
    // Where an actor is built, every field comes from `context.identity`.
    expect(source).toMatch(/context\.identity\.subject/);
    expect(source).not.toMatch(/input\.actor|body\.actor|input\.actorId/);
  });

  it.each(ROUTES)("%s never returns a password, token or link", (route) => {
    const source = readFileSync(route, "utf8");
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

    expect(code).not.toMatch(/password\s*[:=]/i);
    expect(code).not.toMatch(/action_link|actionLink|generateLink/);
    expect(code).not.toMatch(/access_token|refresh_token/);
    expect(code).not.toMatch(/console\.(log|info|warn|error|debug)/);
  });

  it.each(ROUTES)("%s runs on Node and never prerenders", (route) => {
    const source = readFileSync(route, "utf8");
    expect(source).toContain('export const dynamic = "force-dynamic"');
    expect(source).toContain('export const runtime = "nodejs"');
  });
});

describe("what the routes refuse to accept from a caller", () => {
  it("does not let the body choose where an invitation link points", () => {
    /*
     * A body-supplied `redirectTo` would be an OPEN REDIRECT DELIVERED BY
     * EMAIL — worse than one delivered by a link, because the message arrives
     * from a real Supabase sender on behalf of a real invitation.
     */
    const source = readFileSync("src/app/api/admin/users/route.ts", "utf8");
    expect(source).toContain("recoveryRedirectTarget(request)");
    expect(source).not.toMatch(/input\.redirectTo|body\.redirectTo/);
  });

  it("does not let the body change an email address", () => {
    /*
     * The address IS the credential's identity. Changing it in the profile
     * alone would leave somebody signing in with one address and appearing in
     * the directory as another — which reads as an application bug rather than
     * an edit. So PATCH forwards four named fields and does not spread.
     */
    const source = readFileSync("src/app/api/admin/users/[id]/route.ts", "utf8");
    expect(source).not.toMatch(/email:\s*input\.email/);
    expect(source).not.toMatch(/\.\.\.input\b/);
    for (const field of ["displayName", "role", "status", "scope"]) {
      expect(source, field).toContain(`input.${field} !== undefined`);
    }
  });
});
