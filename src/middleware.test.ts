import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { config } from "./middleware";

/**
 * ============================================================================
 * THE REPORTING PIPELINE MUST SURVIVE AUTHENTICATION.
 * ============================================================================
 *
 * `/api/reporting/inbound-email` is called by RESEND, not by a person. It
 * authenticates with a webhook signature and has no session, no cookie and
 * nobody signed in — a Sales Totals report arriving at 6am has no user
 * attached to it.
 *
 * Adding authentication to an application is exactly when that endpoint gets
 * broken, and it breaks SILENTLY: nobody notices until a report does not
 * arrive, and by then the cause is several days back. So the rule is asserted
 * here rather than remembered.
 *
 * The other half of the same rule is that the middleware does not authorize
 * anything at all. A matcher is a second description of who may see what, in a
 * different syntax, in a different file from the pages it protects — and when
 * the two disagree, the pattern list is the one that was forgotten. The guards
 * live next to the data.
 */

const MATCHER = config.matcher[0]!;
const pattern = new RegExp(`^${MATCHER}$`);

/** Does the middleware run for this path? */
function runsFor(path: string): boolean {
  return pattern.test(path);
}

describe("the middleware does not run for machine endpoints", () => {
  it("EXCLUDES the Resend inbound-email webhook", () => {
    // The one assertion this file exists for.
    expect(runsFor("/api/reporting/inbound-email")).toBe(false);
  });

  it("excludes every other API route too", () => {
    for (const path of [
      "/api/health",
      "/api/reporting/intake",
      "/api/chat",
      "/api/forms/draft",
      "/api/knowledge/upload",
      "/api/admin/users",
    ]) {
      expect(runsFor(path), path).toBe(false);
    }
  });

  it("excludes every API route that actually exists in the tree", () => {
    /*
     * Derived from the filesystem, so a route added later is covered without
     * anyone adding it to the list above. The list above stays because naming
     * the webhook explicitly is worth more than a sweep when somebody reads
     * this file wondering what it protects.
     */
    function apiRoutes(dir: string, prefix = "/api"): string[] {
      const found: string[] = [];
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          found.push(...apiRoutes(join(dir, entry.name), `${prefix}/${entry.name}`));
        } else if (entry.name === "route.ts") {
          found.push(prefix);
        }
      }
      return found;
    }

    const routes = apiRoutes("src/app/api");
    expect(routes.length).toBeGreaterThan(5);
    for (const route of routes) {
      expect(runsFor(route.replace(/\[[^\]]+\]/g, "x")), route).toBe(false);
    }
  });

  it("does run for the pages, which is where session refresh is needed", () => {
    for (const path of ["/", "/chat", "/knowledge", "/login", "/forms/monitoring"]) {
      expect(runsFor(path), path).toBe(true);
    }
  });

  it("does not run for static assets", () => {
    for (const path of [
      "/_next/static/chunk.js",
      "/_next/image",
      "/favicon.ico",
      "/logo.svg",
      "/photo.png",
      "/font.woff2",
    ]) {
      expect(runsFor(path), path).toBe(false);
    }
  });
});

describe("the middleware refreshes and nothing else", () => {
  const source = readFileSync("src/middleware.ts", "utf8");
  /** Comments stripped, since this file documents the rules it must not break. */
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

  it("never redirects, so authorization stays next to the data", () => {
    expect(code).not.toMatch(/NextResponse\.redirect/);
    expect(code).not.toMatch(/redirect\(/);
  });

  it("checks no permission and reads no role", () => {
    expect(code).not.toMatch(/hasPermission|PERMISSION_MATRIX|requirePagePermission/);
    expect(code).not.toMatch(/\brole\b/);
  });

  it("never touches the privileged key", () => {
    // A middleware holding the secret-key client would bypass row level
    // security on every request in the application.
    expect(code).not.toMatch(/getSupabaseAdmin|SUPABASE_SECRET_KEY|SERVICE_ROLE/);
  });

  it("validates the token rather than decoding it", () => {
    expect(code).toMatch(/auth\.getUser\(\)/);
    expect(code).not.toMatch(/auth\.getSession\(\)/);
  });

  it("logs nothing, since it runs on every request", () => {
    expect(code).not.toMatch(/console\.(log|info|warn|error|debug)/);
  });

  it("cannot fail a request", () => {
    // An expired session must produce a login redirect from a page guard, not a
    // 500 from here — including on the login screen somebody needs to get back.
    expect(code).toMatch(/try \{/);
    expect(code).toMatch(/catch/);
  });
});
